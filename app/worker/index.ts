/**
 * Ponto de entrada do worker.
 *
 * Processo separado do Next, com ciclo de cinco minutos. Só fiação: quem faz o
 * trabalho é `worker/dispatch.ts` (a decisão), `worker/fila.ts` (o banco) e
 * `worker/loop.ts` (o laço e o encerramento). Este arquivo existe para juntá-los
 * e para não ter lógica nenhuma que precise de teste.
 *
 * ---------------------------------------------------------------------------
 * Duas filas, um processo
 * ---------------------------------------------------------------------------
 * O mesmo ciclo despacha os lembretes (`reminder_jobs`) e as conversões da Meta
 * (`meta_conversion_jobs`). Um segundo processo seria mais um container para o
 * Coolify subir, mais um encerramento limpo para acertar e mais um lugar de onde
 * um `SIGKILL` deixaria reservas presas — tudo isso para rodar, dezenas de vezes
 * por mês, um POST que não fala com paciente nenhuma.
 *
 * As duas são independentes de propósito: o `try/catch` de cada uma vive dentro
 * de `rodarCiclo`, então a Meta fora do ar não pode fazer a paciente ficar sem o
 * lembrete da consulta de amanhã. E a de conversões nasce DESLIGADA — sem
 * `META_DATASET_ID` e `META_CAPI_TOKEN` ela nem consulta o banco.
 *
 * Em produção:
 *
 *     pnpm worker:build      # esbuild → dist/worker.js, um arquivo só
 *     node dist/worker.js    # não precisa de node_modules nem de tsx
 *
 * Em desenvolvimento: `pnpm worker` (tsx, lendo `.env.local`).
 *
 * Roda com o client `service_role`, que ignora RLS. Nada daqui pode ser
 * importado por código de browser — `serverEnv()` e `garantirServidor()` fazem
 * essa barreira valer no primeiro `import`.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { criarEmailClient } from '@/integrations/email/resend'
import { criarEvolutionClient } from '@/integrations/evolution/client'
import { criarMetaCapiClient } from '@/integrations/meta/capi'
import { despacharPendentes } from './dispatch'
import { despacharConversoes } from './despacho-conversoes'
import { criarFilaSupabase } from './fila'
import { criarFilaDeConversoes } from './fila-conversoes'
import { criarLoop, instalarEncerramento } from './loop'

/**
 * Período do ciclo.
 *
 * Cinco minutos é o atraso máximo aceitável para um lembrete: o mais apertado
 * dos cinco gatilhos é `vespera_curta`, três horas antes da consulta, e cinco
 * minutos de folga ali não mudam nada para a paciente. Ciclos mais curtos só
 * multiplicariam consultas a uma fila que passa a maior parte do dia vazia.
 */
const INTERVALO_MS = 5 * 60 * 1000

async function principal(): Promise<void> {
  // Montado dentro de `principal` e não no topo do módulo: `serverEnv()` lança
  // quando falta variável, e no topo essa exceção escaparia como erro de
  // carregamento de módulo — despejando um stack trace do bundle em vez da linha
  // que diz qual variável está faltando.
  const supabase = createAdminClient()

  const fila = criarFilaSupabase(supabase)
  const deps = {
    ...fila,
    whatsapp: criarEvolutionClient(),
    email: criarEmailClient(),
  }

  const filaDeConversoes = criarFilaDeConversoes(supabase)
  // `null` quando não há dataset nem token — o estado de hoje. O despacho trata
  // isso como caminho normal e devolve um resumo zerado sem tocar no banco.
  const meta = criarMetaCapiClient()
  const depsDeConversoes = { ...filaDeConversoes, meta }

  async function rodarCiclo(): Promise<void> {
    const agora = new Date()

    const resumo = await despacharPendentes(deps, agora)
    // Ciclo sem nada a fazer não vira linha de log: são 288 ciclos por dia, e um
    // log por ciclo esconderia justamente o que interessa ler.
    if (resumo.enviados || resumo.falhas || resumo.reagendados) {
      console.log('[lembretes]', JSON.stringify(resumo))
    }

    // Depois dos lembretes, e com try próprio. A ordem é a prioridade: lembrete
    // fala com paciente, conversão fala com o Gerenciador de Anúncios. O `catch`
    // garante o resto — sem ele, uma falha de marketing subiria para `criarLoop`
    // e o ciclo INTEIRO contaria como falho, incluindo os lembretes que já
    // tinham saído.
    //
    // O caminho contrário — lembretes falharem e as conversões nem rodarem — só
    // acontece se `despacharPendentes` lançar, o que quer dizer banco fora do
    // ar. Nesse cenário a fila de conversões estaria igualmente inacessível.
    try {
      const conversoes = await despacharConversoes(depsDeConversoes, agora)
      if (conversoes.enviados || conversoes.falhas) {
        console.log('[conversões]', JSON.stringify(conversoes))
      }
    } catch (causa) {
      console.error('[conversões] ciclo falhou:', causa)
    }
  }

  const loop = criarLoop({
    intervaloMs: INTERVALO_MS,
    ciclo: rodarCiclo,
    // Falha de ciclo inteiro é banco fora do ar ou env quebrada: registra e
    // segue. O ciclo seguinte tenta de novo daqui a cinco minutos, e derrubar o
    // processo aqui só entregaria o problema ao orquestrador em forma de
    // reinício em laço.
    aoFalhar: (causa) => console.error('[lembretes] ciclo falhou:', causa),
  })

  // Antes de qualquer I/O. Um SIGTERM que chegue enquanto o worker ainda está
  // subindo — deploy cancelado, reinício em sequência — cairia no tratamento
  // padrão do Node e mataria o processo sem passar pelo encerramento limpo.
  // Encerrar um loop que ainda não começou resolve na hora.
  instalarEncerramento(loop)

  console.log(`[lembretes] worker iniciado — ciclo a cada ${INTERVALO_MS / 60_000} minutos`)

  // UMA linha, no boot, e nunca mais. O estado desligado é o normal enquanto a
  // Dra. não criar o dataset, e repetir isso a cada ciclo seriam 288 avisos por
  // dia sobre um recurso que ninguém pediu para ligar — que é exatamente o ruído
  // que faz a equipe parar de ler o log.
  console.log(
    meta
      ? '[conversões] envio para a Meta ligado'
      : '[conversões] envio para a Meta desligado (sem META_DATASET_ID/META_CAPI_TOKEN)',
  )

  loop.iniciar()

  // Reservas presas são o rastro de um `SIGKILL` — o encerramento limpo não
  // deixa nenhuma. Avisar no boot é o momento certo: é exatamente quando elas
  // acabaram de ser criadas, e alguém precisa decidir, com a conversa do
  // WhatsApp à vista, se aquela mensagem saiu ou não.
  //
  // Sem `await`: é diagnóstico, e o cliente do Supabase gasta vários segundos
  // repetindo quando a rede está fora. Segurar o primeiro ciclo por causa de uma
  // contagem atrasaria os lembretes por um aviso.
  void fila
    .contarReservasPresas()
    .then((presas) => {
      if (presas) {
        console.warn(
          `[lembretes] ${presas} lembrete(s) presos em 'enviando' de uma execução anterior. ` +
            'Eles NÃO serão reenviados automaticamente — confira antes de liberar.',
        )
      }
    })
    // Sem `catch`, uma rejeição inesperada nesta promessa solta viraria
    // `unhandledRejection` e derrubaria o processo por causa de um aviso.
    .catch((causa) => console.error('[lembretes] não deu para contar as reservas presas:', causa))

  // O mesmo aviso para a outra fila, e só quando ela está ligada: com o envio
  // desligado a tabela nem é consultada, e uma contagem aqui seria a única
  // consulta que o modo desligado faria.
  if (meta) {
    void filaDeConversoes
      .contarReservasPresas()
      .then((presas) => {
        if (presas) {
          console.warn(
            `[conversões] ${presas} evento(s) presos em 'enviando' de uma execução anterior. ` +
              'Confira no Teste de Eventos do Gerenciador antes de liberar — reenviar conta a conversão duas vezes.',
          )
        }
      })
      .catch((causa) => console.error('[conversões] não deu para contar as reservas presas:', causa))
  }
}

void principal().catch((causa) => {
  // Só chega aqui o que impede o worker de existir: env inválida, URL do
  // Supabase errada. Sair com 1 é o certo — o orquestrador reinicia, e se a
  // causa persistir o container entra em CrashLoop, que é visível, em vez de
  // ficar de pé sem nunca enviar nada.
  console.error('[lembretes] o worker não conseguiu iniciar:', causa)
  process.exit(1)
})
