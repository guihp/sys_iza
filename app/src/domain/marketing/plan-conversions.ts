/**
 * Quais eventos de conversão a Meta deve receber quando o funil anda.
 *
 * Módulo puro: sem I/O, sem Supabase, sem React, sem Next. Recebe o estágio de
 * antes, o de agora, o consentimento e a atribuição; devolve a lista do que
 * enfileirar em `meta_conversion_jobs`. Quem grava é a Server Action; quem
 * decide o que existe é este arquivo — e é por isso que as duas travas da LGPD
 * são testadas aqui, sem banco e sem mock.
 *
 * ---------------------------------------------------------------------------
 * As duas travas, antes de qualquer outra coisa
 * ---------------------------------------------------------------------------
 * 1. SEM `consentimento_lgpd_em`, NENHUM EVENTO SAI. Dado de saúde é dado
 *    sensível (LGPD art. 11) e o consentimento precisa ser específico e
 *    destacado. Não há caso de borda, não há "mas só o Lead": a lista volta
 *    vazia.
 *
 * 2. SEM `ctwa_clid`, NENHUM EVENTO SAI. Aqui o argumento não é legal, é de
 *    minimização: sem a chave de atribuição a Meta não consegue casar o evento
 *    com anúncio nenhum. O evento não otimiza nada, não aparece em relatório
 *    nenhum, e ainda assim teria mandado para um terceiro o hash do telefone de
 *    uma paciente. Dado exposto por nada é dado exposto à toa.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo NÃO faz
 * ---------------------------------------------------------------------------
 * Ele não monta o corpo da requisição da CAPI. O formato exato — `action_source`,
 * os campos que identificam o canal WhatsApp, o aninhamento de `user_data` —
 * muda com a versão da API e precisa ser conferido contra a documentação vigente
 * na hora de implementar o adaptador. Este arquivo devolve uma descrição neutra
 * do evento; traduzi-la é trabalho de `src/integrations/meta/capi.ts`.
 *
 * A consequência boa dessa fronteira é a garantia de vazamento: `EntradaDoFunil`
 * não tem campo para nome de procedimento, para observação clínica nem para
 * nada de prontuário. Não é uma regra que alguém precisa lembrar de seguir — é
 * uma coisa que o tipo não deixa entrar.
 */

import { hashTelefone, sha256 } from './hash'
import { arredondarValorParaCentena } from './valor'

/** Os estágios de `public.patient_stage`, na ordem do enum. */
export type EstagioFunil =
  | 'lead'
  | 'contato'
  | 'agendado'
  | 'compareceu'
  | 'paciente'
  | 'retorno'
  | 'descartado'

/** Os eventos padrão da Meta que este sistema envia. */
export type EventoMeta = 'Lead' | 'Contact' | 'Schedule' | 'CompleteRegistration' | 'Purchase'

/**
 * A escada do funil, na ordem em que se sobe.
 *
 * `descartado` e `retorno` ficam de fora porque não são degraus — ver
 * `posicaoNaEscada`.
 */
const ESCADA: readonly EstagioFunil[] = ['lead', 'contato', 'agendado', 'compareceu', 'paciente']

/**
 * Estágio → evento. É o mapa do plano, e as ausências são tão deliberadas quanto
 * as presenças:
 *
 *   - `descartado` não gera evento: é o oposto de uma conversão.
 *   - `retorno` também não, e essa não estava no mapa do plano. Retorno é a
 *     paciente que já é paciente voltando — retenção, não aquisição. O anúncio
 *     já foi creditado com o `Purchase` dela; mandar um segundo contaria a mesma
 *     pessoa duas vezes na receita atribuída e faria o ROI do anúncio crescer
 *     sozinho a cada consulta de acompanhamento.
 */
const EVENTO_DO_ESTAGIO: Partial<Record<EstagioFunil, EventoMeta>> = {
  lead: 'Lead',
  contato: 'Contact',
  agendado: 'Schedule',
  compareceu: 'CompleteRegistration',
  paciente: 'Purchase',
}

/** A moeda da clínica. Constante porque não há outra. */
export const MOEDA = 'BRL'

export type EntradaDoFunil = {
  patientId: string

  /**
   * Onde a paciente estava. `null` quando ela acabou de ser cadastrada e não
   * havia "antes" — tratado como abaixo do primeiro degrau, para que o cadastro
   * direto em 'agendado' gere a escada inteira.
   */
  estagioAnterior: EstagioFunil | null

  estagioNovo: EstagioFunil

  /**
   * `patients.consentimento_lgpd_em`. Trava nº 1: nulo aqui zera a lista.
   * Aceita `Date` ou a string ISO que vem do Supabase sem conversão no caller.
   */
  consentimentoLgpdEm: Date | string | null

  /**
   * `lead_attribution.ctwa_clid`. Trava nº 2: nulo ou vazio zera a lista.
   */
  ctwaClid: string | null

  /** `patients.telefone`, já em E.164. Vira hash; nunca sai daqui em claro. */
  telefoneE164: string | null

  /**
   * Preço do que foi feito, em centavos, só para o `Purchase`. Sai arredondado à
   * centena — ver `valor.ts`. Ausente vira zero; ver a nota em
   * `valorDaConversao`.
   */
  valorCentavos?: number | null

  /**
   * Instante do evento. Injetável para o teste não depender do relógio; em
   * produção é o `new Date()` de quem move o cartão.
   */
  ocorridoEm?: Date
}

export type ConversaoPlanejada = {
  patientId: string
  evento: EventoMeta

  /**
   * A chave desta tabela: `{patientId}:{evento}`, legível. É o `unique` de
   * `meta_conversion_jobs.chave_idempotencia` que transforma reprocessamento em
   * no-op, e é ele — não uma checagem na aplicação — que garante que arrastar o
   * cartão duas vezes não vire dois eventos.
   */
  chaveIdempotencia: string

  /**
   * O que vai no campo `event_id` da Meta: SHA-256 da chave acima. Estável entre
   * execuções (é o que faz a Meta deduplicar retentativa) e opaco (o uuid
   * interno da paciente não precisa atravessar a fronteira para um terceiro).
   */
  eventId: string

  ocorridoEm: Date

  /** Valor em reais, já arredondado. Só no `Purchase`; `null` nos demais. */
  valor: number | null

  /** `'BRL'` quando há valor, `null` quando não há. Andam juntos ou nenhum vai. */
  moeda: typeof MOEDA | null

  /** A chave de atribuição. Vai em claro porque é dela que a Meta precisa. */
  ctwaClid: string

  /** SHA-256 do telefone, ou `null` quando não há telefone cadastrado. */
  telefoneHash: string | null
}

/**
 * Onde o estágio fica na escada.
 *
 * `descartado` e `null` ficam abaixo do primeiro degrau (-1): quem sai de um dos
 * dois está subindo a escada do zero. `retorno` é lido como se fosse `paciente`,
 * porque é o que ele é — alguém que já chegou ao topo. Isso faz de
 * `retorno → agendado` um retrocesso, que não gera evento, e é o desfecho certo:
 * marcar a consulta de acompanhamento de uma paciente antiga não é uma nova
 * aquisição para creditar a um anúncio.
 */
function posicaoNaEscada(estagio: EstagioFunil | null): number {
  if (estagio === null || estagio === 'descartado') return -1
  if (estagio === 'retorno') return ESCADA.indexOf('paciente')
  return ESCADA.indexOf(estagio)
}

/**
 * O valor que acompanha o `Purchase`.
 *
 * Sem valor conhecido vai zero, em vez de o evento ser suprimido. Três motivos,
 * nesta ordem:
 *
 *   - a Meta exige `value` e `currency` no `Purchase`; sem eles o evento é
 *     recusado, e um `Purchase` recusado é pior do que um com valor zero;
 *   - a clínica otimiza por `Schedule`, decisão registrada no plano. O
 *     `Purchase` é sinal de relatório, não de otimização, então um zero não
 *     ensina a Meta a evitar ninguém;
 *   - o ROI da página /marketing sai do NOSSO banco, com o preço de verdade. O
 *     que a Meta recebeu não alimenta aquela conta.
 */
function valorDaConversao(evento: EventoMeta, centavos: number | null | undefined): number | null {
  if (evento !== 'Purchase') return null
  return arredondarValorParaCentena(centavos ?? 0) / 100
}

function temConsentimento(valor: Date | string | null): boolean {
  if (valor === null || valor === undefined) return false
  if (valor instanceof Date) return !Number.isNaN(valor.getTime())
  return valor.trim() !== ''
}

/**
 * Os eventos a enviar quando o funil anda.
 *
 * ---------------------------------------------------------------------------
 * Pulo de estágio gera os intermediários. Retrocesso não gera nada.
 * ---------------------------------------------------------------------------
 * `lead → agendado` devolve `Lead`, `Contact` e `Schedule`, os três. A tentação
 * é mandar só o `Schedule`, e ela está errada por uma razão operacional antes de
 * qualquer outra: nesta clínica o caminho normal é a pessoa mandar mensagem pelo
 * anúncio e marcar na mesma conversa. A secretária toca o cartão UMA vez. Se
 * só o degrau final saísse, o `Contact` não existiria para ninguém que agenda de
 * primeira, e a taxa "lead → agendado" no Gerenciador de Eventos ficaria
 * permanentemente absurda — mais agendamentos do que contatos.
 *
 * Há um custo, e é honesto nomeá-lo: os eventos intermediários saem todos com o
 * mesmo `ocorridoEm`, que é o instante do movimento, e não o instante em que a
 * conversa de fato aconteceu. A janela de atribuição da Meta é de dias, então
 * errar por minutos não muda atribuição nenhuma — enquanto um evento que nunca
 * foi enviado erra para sempre.
 *
 * O caminho de volta — `agendado → contato`, a secretária consertando um arrasto
 * errado — não gera nada. Não existe "desconversão" na Meta, e reenviar o
 * `Contact` que já saiu não desfaz o `Schedule`. E se ela arrastar de novo para
 * frente, o `Schedule` é replanejado com a mesma `chaveIdempotencia`, esbarra no
 * `unique` do banco e vira no-op. É por isso que este módulo pode ser sem
 * memória: ele não precisa saber o que já foi enviado.
 */
export function planejarConversoes(entrada: EntradaDoFunil): ConversaoPlanejada[] {
  // Trava nº 1 — consentimento. Antes de tudo, inclusive de olhar o estágio.
  if (!temConsentimento(entrada.consentimentoLgpdEm)) return []

  // Trava nº 2 — atribuição.
  const ctwaClid = entrada.ctwaClid?.trim()
  if (!ctwaClid) return []

  // Estágio sem evento correspondente ('descartado', 'retorno') encerra aqui:
  // não há degrau novo a creditar, mesmo que a escada aponte para frente.
  if (!EVENTO_DO_ESTAGIO[entrada.estagioNovo]) return []

  const de = posicaoNaEscada(entrada.estagioAnterior)
  const para = posicaoNaEscada(entrada.estagioNovo)
  if (para <= de) return []

  const ocorridoEm = entrada.ocorridoEm ?? new Date()
  const telefoneHash = hashTelefone(entrada.telefoneE164)

  const conversoes: ConversaoPlanejada[] = []

  // Todo degrau entre o de antes (exclusive) e o de agora (inclusive).
  for (const estagio of ESCADA.slice(de + 1, para + 1)) {
    const evento = EVENTO_DO_ESTAGIO[estagio]
    if (!evento) continue

    const valor = valorDaConversao(evento, entrada.valorCentavos)

    conversoes.push({
      patientId: entrada.patientId,
      evento,
      chaveIdempotencia: chaveDaConversao(entrada.patientId, evento),
      eventId: eventIdDaConversao(entrada.patientId, evento),
      ocorridoEm,
      valor,
      moeda: valor === null ? null : MOEDA,
      ctwaClid,
      telefoneHash,
    })
  }

  return conversoes
}

/** `{patientId}:{evento}` — a chave legível, a nossa. */
export function chaveDaConversao(patientId: string, evento: EventoMeta): string {
  return `${patientId}:${evento}`
}

/** SHA-256 da chave — o `event_id` opaco que atravessa para a Meta. */
export function eventIdDaConversao(patientId: string, evento: EventoMeta): string {
  return sha256(chaveDaConversao(patientId, evento))
}
