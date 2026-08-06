/**
 * Cálculo do retorno de um atendimento.
 *
 * Módulo puro: sem I/O, sem Supabase, sem React, sem Next. É o que permite
 * cobrir cada nível de precedência e cada borda de janela com teste unitário,
 * sem banco e sem mock — e é o que garante que a prévia na tela da Dra. e o
 * valor gravado pela Server Action saiam da mesma conta.
 *
 * Sobre fuso: aqui não há nenhum. As `Date` que entram e saem são tratadas como
 * marcadores de um dia de calendário, e é responsabilidade de quem chama
 * ancorá-las de forma consistente — `diaDeCalendario()` em `src/lib/datetime.ts`
 * faz isso, convertendo `YYYY-MM-DD` na meia-noite UTC do mesmo dia. Decidir
 * *qual* é o dia de hoje na clínica é problema de fuso e mora lá; somar 120 dias
 * a um dia de calendário não é.
 */

export type EntradaRetorno = {
  realizadoEm: Date
  /** Intervalo padrão do procedimento no catálogo. Null = não gera retorno. */
  padraoDias: number | null
  /** Ajuste em dias feito pela Dra. no registro do atendimento. */
  ajusteDias?: number | null
  /** Data escolhida no calendário pela Dra. Vence o ajuste em dias. */
  ajusteData?: Date | null
  /** Marcado quando o retorno não se aplica àquele paciente. Vence tudo. */
  semRetorno?: boolean
}

export type StatusRetorno = 'sem_retorno' | 'em_dia' | 'vencendo' | 'vencido'

const DIA_EM_MS = 24 * 60 * 60 * 1000

/**
 * A partir de quantos dias antes do vencimento o paciente entra na fila.
 *
 * Trinta dias é o tempo de conseguir falar com a pessoa, oferecer horário e
 * ainda encaixar na agenda antes de o efeito do procedimento cair. Janela menor
 * transforma a fila em lista de atrasados; maior enche a tela de gente que ainda
 * nem pensou no assunto.
 */
export const JANELA_VENCENDO_DIAS = 30

/**
 * Data em que o paciente deve voltar, ou `null` quando não há retorno.
 *
 * Precedência, do mais forte ao mais fraco:
 *
 *   3.  `semRetorno`   — a Dra. marcou que esta paciente não volta. Vence tudo,
 *                        inclusive uma data já escolhida no calendário.
 *   2b. `ajusteData`   — data escolhida à mão para este atendimento.
 *   2a. `ajusteDias`   — intervalo em dias digitado para este atendimento.
 *   1.  `padraoDias`   — intervalo do catálogo (`default_return_interval_days`).
 *
 * Não existe empate: a ordem é total e o nível mais forte preenchido decide
 * sozinho, sem consultar os de baixo. Preencher os três ao mesmo tempo é
 * situação normal — o formulário chega com o padrão do catálogo já no campo de
 * dias —, e o resultado é sempre o do nível mais alto.
 *
 * Campo em branco não é decisão: `null`/`undefined` devolve a escolha ao nível
 * de baixo, e é por isso que o operador é `??` e não `||`. Quando nenhum nível
 * se aplica — catálogo sem retorno padrão e nenhum ajuste — o resultado é
 * `null`, o paciente fica com `retorno_vencimento` nulo e simplesmente não entra
 * na fila de retornos.
 */
export function calcularRetorno(entrada: EntradaRetorno): Date | null {
  if (entrada.semRetorno) return null
  if (entrada.ajusteData) return entrada.ajusteData

  const dias = entrada.ajusteDias ?? entrada.padraoDias
  if (dias == null) return null

  return new Date(entrada.realizadoEm.getTime() + dias * DIA_EM_MS)
}

/**
 * Dias entre hoje e o vencimento. Positivo = falta; negativo = atraso.
 *
 * `Math.ceil` para que um vencimento a poucas horas de distância ainda conte
 * como "falta 1 dia" em vez de arredondar para zero, e para que o dia do próprio
 * vencimento dê exatamente 0 quando as duas datas estão ancoradas no mesmo
 * horário — que é o caso quando ambas vêm de `diaDeCalendario()`.
 */
export function diasAteRetorno(vencimento: Date, hoje: Date): number {
  return Math.ceil((vencimento.getTime() - hoje.getTime()) / DIA_EM_MS)
}

/**
 * Situação do retorno para a fila.
 *
 * `vencido` só a partir do dia seguinte ao vencimento: o dia marcado ainda é
 * dia de ligar sem pedir desculpa, e contá-lo como atraso pintaria de vermelho
 * quem está em dia.
 */
export function statusRetorno(vencimento: Date | null, hoje: Date): StatusRetorno {
  if (!vencimento) return 'sem_retorno'

  const diasRestantes = diasAteRetorno(vencimento, hoje)
  if (diasRestantes < 0) return 'vencido'
  if (diasRestantes <= JANELA_VENCENDO_DIAS) return 'vencendo'
  return 'em_dia'
}
