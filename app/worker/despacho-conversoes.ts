/**
 * Despacho da fila de conversões para a Meta.
 *
 * Gêmeo de `worker/dispatch.ts` na forma — orquestração pura, todo o I/O atrás
 * de `Deps`, `agora` injetado — e diferente dele em três pontos, que são
 * justamente os que precisam de teste:
 *
 *   1. **O envio pode estar desligado.** Sem dataset e sem token de CAPI,
 *      `deps.meta` é `null` e o ciclo termina sem tocar o banco. Não é falha, não
 *      vira log, não conta tentativa — é o estado normal de hoje, e vai continuar
 *      sendo até a Dra. criar o dataset. Isto é a primeira linha da função de
 *      propósito: nem a consulta à fila acontece.
 *   2. **Não há janela de silêncio.** Do outro lado não tem ninguém dormindo: é
 *      um servidor da Meta. Mandar `Schedule` às 3h da manhã não incomoda
 *      paciente nenhuma.
 *   3. **O evento tem prazo de validade.** A Meta recusa `event_time` com mais de
 *      sete dias. Um job represado além disso nunca mais vai ser aceito, e
 *      insistir só o mantém na frente da fila (ela é ordenada por `ocorrido_em`,
 *      do mais antigo para o mais novo) escondendo os eventos novos atrás dele.
 *
 * O que se repete de `dispatch.ts` é reaproveitado de lá — `MAX_TENTATIVAS` e a
 * classificação `ErroDeEnvio.permanente`. "O que é transitório" tem uma definição
 * só neste projeto.
 *
 * Não há recuo calculado aqui, e a ausência é deliberada: `meta_conversion_jobs`
 * não tem coluna de agendamento, ao contrário de `reminder_jobs`. Devolver o job
 * a `pendente` já o adia até o próximo ciclo, que é de cinco minutos — o mesmo
 * `RECUO_BASE_MS` da fila de lembretes, só que vindo do relógio do worker em vez
 * de uma coluna.
 */

import { ErroDeEnvio } from '@/integrations/envio'
import { JANELA_DE_EVENTO_DIAS, type EventoDeConversao } from '@/integrations/meta/capi'
import { MAX_TENTATIVAS } from './dispatch'

export { MAX_TENTATIVAS } from './dispatch'

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * Margem de segurança sobre a janela de sete dias.
 *
 * O corte é feito uma hora ANTES do limite da Meta. Um job avaliado às 6 dias,
 * 23 horas e 59 minutos passaria por aqui, esperaria a vez no lote e chegaria à
 * Meta já vencido — recusado com um erro de payload que não explica nada a quem
 * for ler a coluna `erro`. Melhor desistir com a mensagem certa.
 */
const MARGEM_DA_JANELA_MS = 60 * 60 * 1000

/** Uma linha da fila, com o evento já descongelado. */
export type ConversaoPendente = {
  id: string
  /** Quantas tentativas já foram gastas neste job antes deste ciclo. */
  tentativas: number
  /**
   * `null` quando `payload` não passou pelo schema de
   * `@/integrations/meta/payload` — dado corrompido ou gravado por uma versão
   * anterior. Tratado como falha permanente: retentar um JSON quebrado produz o
   * mesmo JSON quebrado.
   */
  evento: EventoDeConversao | null
}

export type DesfechoDaConversao = {
  /** Mensagem já sanitizada pelo adaptador. Vai para `meta_conversion_jobs.erro`. */
  erro: string
  /** true = desistir (`falhou`). false = devolver para a fila (`pendente`). */
  definitiva: boolean
  /** Valor com que `tentativas` fica depois desta falha. */
  tentativas: number
}

export type DepsDeConversoes = {
  /**
   * Reserva e devolve os jobs deste ciclo.
   *
   * "Reserva" e não "busca", pelo mesmo motivo da fila de lembretes: dois
   * workers no ar durante um deploy leriam as mesmas linhas. A diferença é o
   * dano — aqui não é a paciente recebendo mensagem em dobro, é o Gerenciador
   * contando duas conversões para o mesmo agendamento e inflando o desempenho do
   * anúncio. O `event_id` estável faz a Meta deduplicar do lado dela, mas isso é
   * a rede embaixo, não o plano.
   */
  reservarPendentes(): Promise<ConversaoPendente[]>
  marcarEnviado(id: string): Promise<void>
  marcarFalha(id: string, desfecho: DesfechoDaConversao): Promise<void>
  /** `null` quando não há credencial de CAPI. Ver o item 1 do cabeçalho. */
  meta: { enviarConversao(evento: EventoDeConversao): Promise<{ eventosRecebidos: number }> } | null
}

export type ResumoDeConversoes = {
  enviados: number
  /** Jobs que não saíram neste ciclo, definitivos ou não. */
  falhas: number
  /** Subconjunto de `falhas`: os que o worker parou de tentar. */
  desistidos: number
}

function descrever(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa)
}

/** Quanto tempo passou desde o evento, em relação à janela que a Meta aceita. */
export function eventoVencido(ocorridoEm: Date, agora: Date): boolean {
  const limite = JANELA_DE_EVENTO_DIAS * DIA_MS - MARGEM_DA_JANELA_MS
  return agora.getTime() - ocorridoEm.getTime() > limite
}

/**
 * Traduz a exceção do envio na decisão de gravar.
 *
 * Mesma lógica de `classificarFalha` em `dispatch.ts`, e a semelhança é
 * proposital: `ErroDeEnvio.permanente` já sabe que um 401 não melhora com
 * insistência, e o teto de tentativas cuida do resto. Exceção que não é
 * `ErroDeEnvio` conta como transitória — bug ou `fetch` que escapou da
 * classificação —, e `MAX_TENTATIVAS` limita o estrago.
 */
function classificarFalha(causa: unknown, job: ConversaoPendente): DesfechoDaConversao {
  const erro = descrever(causa)
  const permanente = causa instanceof ErroDeEnvio && causa.permanente
  const tentativasFeitas = job.tentativas + 1

  if (permanente) {
    return { erro, definitiva: true, tentativas: tentativasFeitas }
  }

  if (tentativasFeitas >= MAX_TENTATIVAS) {
    return {
      erro: `Desistindo após ${MAX_TENTATIVAS} tentativas. Última falha: ${erro}`,
      definitiva: true,
      tentativas: tentativasFeitas,
    }
  }

  return { erro, definitiva: false, tentativas: tentativasFeitas }
}

/**
 * Roda um ciclo de despacho de conversões.
 *
 * `agora` é injetado para que o teste consiga posicionar um job dentro e fora da
 * janela de sete dias sem mexer no relógio do processo.
 */
export async function despacharConversoes(
  deps: DepsDeConversoes,
  agora: Date,
): Promise<ResumoDeConversoes> {
  const resumo: ResumoDeConversoes = { enviados: 0, falhas: 0, desistidos: 0 }

  // Desligado: nem a fila é consultada. Uma consulta por ciclo a uma tabela que
  // nunca vai ser despachada seriam 288 idas ao banco por dia para nada — e a
  // primeira delas a falhar viraria um log de erro sobre um recurso que a clínica
  // não ligou.
  const meta = deps.meta
  if (!meta) return resumo

  const pendentes = await deps.reservarPendentes()
  if (pendentes.length === 0) return resumo

  for (const job of pendentes) {
    const desfecho = await despacharUm(deps, meta, job, agora)
    if (desfecho === null) {
      resumo.enviados += 1
      continue
    }

    resumo.falhas += 1
    if (desfecho.definitiva) resumo.desistidos += 1

    try {
      await deps.marcarFalha(job.id, desfecho)
    } catch (falhaAoGravar) {
      // Banco fora do ar no meio do ciclo. O job fica reservado em `enviando` em
      // vez de voltar a `pendente`: atrasa a retentativa, e nunca duplica envio.
      console.error(
        `[conversões] falha ao gravar o erro de ${job.id}:`,
        descrever(falhaAoGravar),
      )
    }
  }

  return resumo
}

/**
 * Um job. Devolve `null` quando deu certo, ou o desfecho da falha.
 *
 * Separado do laço para que cada job tenha o próprio `try/catch` sem aninhar
 * três níveis: uma linha com payload podre não pode levar as outras junto.
 */
async function despacharUm(
  deps: DepsDeConversoes,
  meta: NonNullable<DepsDeConversoes['meta']>,
  job: ConversaoPendente,
  agora: Date,
): Promise<DesfechoDaConversao | null> {
  const tentativasFeitas = job.tentativas + 1

  if (!job.evento) {
    return {
      erro: 'Payload do evento ilegível — a linha foi gravada em formato inesperado',
      definitiva: true,
      tentativas: tentativasFeitas,
    }
  }

  if (eventoVencido(job.evento.ocorridoEm, agora)) {
    return {
      erro:
        `Evento de ${job.evento.ocorridoEm.toISOString()} passou da janela de ` +
        `${JANELA_DE_EVENTO_DIAS} dias da Meta e não será mais aceito`,
      definitiva: true,
      tentativas: tentativasFeitas,
    }
  }

  try {
    await meta.enviarConversao(job.evento)
  } catch (causa) {
    return classificarFalha(causa, job)
  }

  try {
    await deps.marcarEnviado(job.id)
    return null
  } catch (causa) {
    // O evento JÁ CHEGOU na Meta e a gravação falhou. A falha é registrada como
    // DEFINITIVA, e é o único ponto do arquivo em que "definitiva" não quer dizer
    // "deu errado": devolver o job à fila o reenviaria, e apoiar-se apenas na
    // deduplicação por `event_id` do lado da Meta para não contar duas vezes é
    // garantia que não está sob nosso controle.
    //
    // Se a própria gravação da falha também não passar — banco fora do ar, que é
    // a causa provável de estarmos aqui —, a linha fica em `enviando` e aparece
    // na contagem de reservas presas do próximo boot, que é o desfecho seguro.
    console.error(
      `[conversões] evento enviado mas não registrado — job ${job.id}:`,
      descrever(causa),
    )
    return {
      erro: 'Evento enviado à Meta, mas o registro do envio falhou — NÃO reenviar',
      definitiva: true,
      tentativas: tentativasFeitas,
    }
  }
}
