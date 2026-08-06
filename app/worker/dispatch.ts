/**
 * Despacho dos lembretes vencidos.
 *
 * Este arquivo é a orquestração pura do ciclo: recebe uma fila já reservada,
 * decide o que fazer com cada job e devolve o resumo. Ele não conhece Supabase,
 * não abre conexão e não olha o relógio — `agora` vem de fora. Todo o I/O mora
 * atrás de `Deps`, e é por isso que cada regra abaixo tem teste offline.
 *
 * Três garantias sustentam o arquivo, em ordem de importância:
 *
 *   1. **Nenhuma mensagem sai duas vezes.** É o pior erro que este sistema pode
 *      cometer — a paciente recebendo "sua consulta é amanhã" em dobro erode a
 *      confiança na clínica inteira. A exclusão mútua entre instâncias do worker
 *      é resolvida antes daqui, na reserva atômica de `worker/fila.ts`; o que
 *      este arquivo garante é o resto: envio que deu certo nunca volta para a
 *      fila, nem quando a gravação do resultado falha (ver `marcarEnviado`
 *      abaixo).
 *   2. **Nenhuma mensagem sai de madrugada.** `aplicarJanelaDeSilencio` roda
 *      aqui, no despacho, e não no planejamento: entre planejar e enviar cabe
 *      atraso de worker, e quem decide se é hora decente de tocar o celular de
 *      alguém é o relógio do envio.
 *   3. **Um job podre não leva a fila junto.** Cada job tem seu próprio
 *      `try/catch`, e as gravações de resultado também. Uma paciente com
 *      telefone inválido não pode fazer as outras trinta ficarem sem aviso.
 */

import { aplicarJanelaDeSilencio } from '@/domain/reminders/quiet-hours'
import { ErroDeEnvio } from '@/integrations/envio'
import type { Canal, ReminderKind } from '@/domain/reminders/plan-reminders'

/**
 * Quantas vezes um mesmo job pode ser tentado antes de o worker desistir.
 *
 * Três, contando a primeira. O que se tenta recuperar aqui é a falha passageira
 * — deploy do provedor, pico de latência, limite de requisições —, e essas
 * passam em minutos. Erro que sobrevive a três tentativas espaçadas não é
 * soluço de rede: é problema que precisa de gente olhando, e continuar
 * insistindo só empurraria a linha para o fim da fila todo ciclo, escondendo-a
 * de quem poderia consertar.
 *
 * O teto é também um limite de dano: `pos_procedimento` fala de cuidados nas
 * primeiras 24 horas, e uma mensagem que ficasse retentando por dias chegaria
 * depois de já não servir para nada.
 */
export const MAX_TENTATIVAS = 3

/**
 * Recuo da primeira retentativa. Cinco minutos, igual ao período do loop — abaixo
 * disso o recuo seria decorativo, porque o worker só volta a olhar a fila daqui
 * a cinco minutos de qualquer jeito.
 */
export const RECUO_BASE_MS = 5 * 60 * 1000

/**
 * Teto do recuo. Existe para o caso de `MAX_TENTATIVAS` crescer um dia: sem ele,
 * a duplicação exponencial levaria uma mensagem de véspera a ser reagendada para
 * depois da consulta que ela anuncia.
 */
export const RECUO_MAXIMO_MS = 30 * 60 * 1000

/**
 * Recuo antes da próxima tentativa, dobrando a cada tentativa já gasta.
 *
 * Sem jitter aleatório, de propósito. Jitter existe para dispersar uma frota de
 * clientes que falharam juntos; aqui há um worker só, o lote é de dezenas de
 * mensagens e a dispersão que importa — entre duas instâncias durante um deploy
 * — já é resolvida pela reserva atômica, não pelo relógio. Recuo determinístico
 * é mais fácil de testar e de explicar quando alguém pergunta por que a
 * mensagem saiu às 14h10 e não às 14h05.
 */
export function recuoDaProximaTentativa(tentativasFeitas: number): number {
  const recuo = RECUO_BASE_MS * 2 ** Math.max(0, tentativasFeitas - 1)
  return Math.min(recuo, RECUO_MAXIMO_MS)
}

/** Uma linha da fila, já com o texto renderizado e o destinatário resolvido. */
export type JobPendente = {
  id: string
  kind: ReminderKind
  channel: Canal
  telefone: string | null
  email: string | null
  /** Só o e-mail tem assunto; no WhatsApp é sempre nulo. */
  assunto: string | null
  corpo: string
  /** Quantas tentativas já foram gastas neste job antes deste ciclo. */
  tentativas: number
}

/**
 * O que gravar quando um envio não deu certo.
 *
 * Um objeto e não três posicionais porque `definitiva` e `proximaTentativa` são
 * a mesma decisão vista de dois ângulos, e trocá-los de lugar numa chamada
 * posicional produziria um bug silencioso: o job voltaria para a fila com um
 * horário nulo, seria lido de novo no ciclo seguinte e nunca sairia dali.
 */
export type ResultadoDaFalha = {
  /** Mensagem já sanitizada pelo adaptador. Vai direto para `reminder_jobs.erro`. */
  erro: string
  /** true = desistir (status `falhou`). false = devolver para a fila. */
  definitiva: boolean
  /** Quando tentar de novo. Nulo quando a falha é definitiva. */
  proximaTentativa: Date | null
  /**
   * Valor com que `reminder_jobs.tentativas` fica depois desta falha.
   *
   * Vai calculado daqui em vez de a fila reler a linha para somar um: o job já
   * está reservado por esta instância, então ninguém mais o toca, e o número
   * exato que o worker usou para decidir desistir é o mesmo que fica gravado —
   * sem uma segunda ida ao banco entre a decisão e o registro.
   */
  tentativas: number
}

export type Deps = {
  /**
   * Reserva e devolve os jobs deste ciclo.
   *
   * "Reserva" e não "busca": a implementação tem de tirar as linhas do estado
   * `pendente` atomicamente, senão duas instâncias do worker leem a mesma fila e
   * a paciente recebe tudo em dobro. Ver `worker/fila.ts`.
   */
  reservarPendentes(agora: Date): Promise<JobPendente[]>
  marcarEnviado(id: string, providerMessageId: string): Promise<void>
  marcarFalha(id: string, desfecho: ResultadoDaFalha): Promise<void>
  /** Devolve o job à fila para um instante futuro, sem contar tentativa. */
  reagendar(id: string, novoMomento: Date): Promise<void>
  whatsapp: {
    enviarTexto(a: { telefone: string; texto: string }): Promise<{ providerMessageId: string }>
  }
  email: {
    enviar(a: { para: string; assunto: string; html: string }): Promise<{
      providerMessageId: string
    }>
  }
}

export type Resumo = {
  enviados: number
  /** Jobs que não saíram neste ciclo, definitivos ou não. */
  falhas: number
  /** Subconjunto de `falhas`: os que o worker parou de tentar. */
  desistidos: number
  /** Empurrados para fora da janela de silêncio. */
  reagendados: number
}

/** Assunto usado quando o template de e-mail veio sem um. */
const ASSUNTO_PADRAO = 'Clínica Dra. Izadora Barros'

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Texto puro → HTML de e-mail.
 *
 * Escapa antes de trocar as quebras de linha por `<br>`, e a ordem é o ponto:
 * invertida, os `<br>` recém-criados seriam escapados junto e a paciente
 * receberia `&lt;br&gt;` no meio da frase.
 *
 * O escape não é paranoia com o template — quem o escreve é a Dra. O risco real
 * é o campo do cadastro que entra nele por substituição: um nome digitado como
 * `Maria <clinica>` viraria marcação quebrada, e um `<img onerror=...>` viraria
 * conteúdo ativo no cliente de e-mail de outra pessoa.
 */
function paraHtml(texto: string): string {
  return `<p>${texto.replace(/[&<>"']/g, (c) => ESCAPES[c]).replace(/\n/g, '<br>')}</p>`
}

/** Entrega o job pelo canal dele e devolve o id da mensagem no provedor. */
async function entregar(deps: Deps, job: JobPendente): Promise<string> {
  // Corpo vazio significa template ausente ou desligado em `message_templates`.
  // Os adaptadores também barram isso, mas com uma mensagem que fala de string
  // vazia; aqui dá para nomear a causa real, que é o que a equipe vai ler na
  // coluna `erro` quando perguntarem por que o lembrete não saiu.
  if (job.corpo.trim().length === 0) {
    throw new ErroDeEnvio(
      `Sem texto para enviar: o template de ${job.kind}/${job.channel} está ausente ou desligado`,
      'requisicao',
    )
  }

  if (job.channel === 'whatsapp') {
    // Paciente sem destino não é falha de envio: é cadastro incompleto, e
    // repetir não conserta. `destinatario` é permanente em `ErroDeEnvio`.
    if (!job.telefone?.trim()) {
      throw new ErroDeEnvio('Paciente sem telefone cadastrado', 'destinatario')
    }
    const { providerMessageId } = await deps.whatsapp.enviarTexto({
      telefone: job.telefone,
      texto: job.corpo,
    })
    return providerMessageId
  }

  if (!job.email?.trim()) {
    throw new ErroDeEnvio('Paciente sem e-mail cadastrado', 'destinatario')
  }
  const { providerMessageId } = await deps.email.enviar({
    para: job.email,
    assunto: job.assunto?.trim() || ASSUNTO_PADRAO,
    html: paraHtml(job.corpo),
  })
  return providerMessageId
}

function descrever(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa)
}

/**
 * Traduz a exceção do envio na decisão de gravar.
 *
 * Duas perguntas, nesta ordem. A primeira é do adaptador: `ErroDeEnvio.permanente`
 * já sabe que um 401 não melhora com insistência e um 502 melhora. A segunda é
 * do worker: mesmo o erro que melhoraria tem hora de parar.
 *
 * Exceção que não é `ErroDeEnvio` conta como transitória. É o caso de um erro
 * de programação ou de um `fetch` que escapou da classificação, e a escolha
 * conservadora aqui é tentar de novo: `MAX_TENTATIVAS` limita o estrago, e
 * marcar como definitiva faria uma paciente perder o aviso da consulta por causa
 * de um bug que seria corrigido no deploy da tarde.
 */
function classificarFalha(causa: unknown, job: JobPendente, agora: Date): ResultadoDaFalha {
  const erro = descrever(causa)
  const permanente = causa instanceof ErroDeEnvio && causa.permanente
  const tentativasFeitas = job.tentativas + 1

  if (permanente) {
    return { erro, definitiva: true, proximaTentativa: null, tentativas: tentativasFeitas }
  }

  if (tentativasFeitas >= MAX_TENTATIVAS) {
    return {
      erro: `Desistindo após ${MAX_TENTATIVAS} tentativas. Última falha: ${erro}`,
      definitiva: true,
      proximaTentativa: null,
      tentativas: tentativasFeitas,
    }
  }

  return {
    erro,
    definitiva: false,
    proximaTentativa: new Date(agora.getTime() + recuoDaProximaTentativa(tentativasFeitas)),
    tentativas: tentativasFeitas,
  }
}

/**
 * Roda um ciclo de despacho.
 *
 * `agora` é injetado e não lido de `new Date()` para que o teste consiga
 * posicionar o ciclo dentro e fora da janela de silêncio sem mexer no relógio do
 * processo — e para que a mesma referência de tempo valha para a janela, para o
 * recuo e para o corte da fila, em vez de três instantes ligeiramente diferentes.
 */
export async function despacharPendentes(deps: Deps, agora: Date): Promise<Resumo> {
  const resumo: Resumo = { enviados: 0, falhas: 0, desistidos: 0, reagendados: 0 }

  const pendentes = await deps.reservarPendentes(agora)
  if (pendentes.length === 0) return resumo

  // A janela é avaliada uma vez por ciclo, contra o mesmo `agora` da reserva. Um
  // ciclo dura segundos: reavaliar job a job só criaria a chance de o lote ser
  // partido ao meio pelas 21:00 em ponto, com metade saindo e metade não.
  const permitido = aplicarJanelaDeSilencio(agora)
  const emSilencio = permitido.getTime() !== agora.getTime()

  for (const job of pendentes) {
    if (emSilencio) {
      try {
        await deps.reagendar(job.id, permitido)
        resumo.reagendados += 1
      } catch (causa) {
        // O job continua reservado. Não sai mensagem nenhuma — que é o desfecho
        // seguro — e o ciclo seguinte tenta de novo assim que ele for liberado.
        console.error(`[lembretes] falha ao reagendar ${job.id}:`, descrever(causa))
        resumo.falhas += 1
      }
      continue
    }

    let providerMessageId: string | null = null
    try {
      providerMessageId = await entregar(deps, job)
    } catch (causa) {
      resumo.falhas += 1
      const desfecho = classificarFalha(causa, job, agora)
      if (desfecho.definitiva) resumo.desistidos += 1
      try {
        await deps.marcarFalha(job.id, desfecho)
      } catch (falhaAoGravar) {
        // Banco fora do ar no meio do ciclo. O job fica reservado em vez de
        // pendente, o que atrasa a retentativa mas nunca duplica envio.
        console.error(`[lembretes] falha ao gravar o erro de ${job.id}:`, descrever(falhaAoGravar))
      }
      continue
    }

    try {
      await deps.marcarEnviado(job.id, providerMessageId)
      resumo.enviados += 1
    } catch (causa) {
      // A mensagem JÁ SAIU e a gravação falhou. Este é o único ponto do sistema
      // em que devolver o job para a fila causaria envio duplicado, então ele
      // não é devolvido: fica reservado, aparece no aviso de reservas presas do
      // próximo boot e alguém decide o que fazer. Contabilizado como falha
      // porque, do ponto de vista do registro, o envio não se completou.
      console.error(
        `[lembretes] mensagem enviada mas não registrada — job ${job.id}, ` +
          `provider_message_id ${providerMessageId || '(vazio)'}:`,
        descrever(causa),
      )
      resumo.falhas += 1
    }
  }

  return resumo
}
