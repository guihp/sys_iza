/**
 * KPIs e textos do funil — funções puras, testáveis sem banco.
 *
 * Potencial da coluna e preço do cartão saem de `potencial_centavos` (preço do
 * procedimento de interesse no catálogo). Sem valor → "—" / "A definir".
 */

import { dataDaClinica, deslocarData } from '@/lib/datetime'
import { formatarValorRedondo } from '@/lib/meta'
import { ehEstagio, type PatientStage } from './estagios'

/** Estágios que não contam como lead ativo (igual à casca). */
const FORA_DO_FUNIL: ReadonlySet<PatientStage> = new Set(['paciente', 'descartado'])

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

/** Intl pt-BR usa NBSP após R$; a UI e os testes esperam espaço comum. */
function formatarReais(centavos: number): string {
  return MOEDA.format(centavos / 100).replace(/\u00a0/g, ' ')
}

export type PacienteParaMetricas = {
  stage: PatientStage
  /** ISO do banco. Ausente = não entra no "+N esta semana". */
  criado_em?: string | null
  /** Centavos do procedimento de interesse. Ausente/nulo = sem potencial. */
  potencial_centavos?: number | null
}

export type KpisDoFunil = {
  leadsAtivos: number
  novosNaSemana: number
  /** `38%` ou `—` quando não há base. */
  conversao: string
  /** `R$ 3.9k` / `R$ 0` / `—`. */
  ticketMedio: string
}

/** Quantos leads ativos (fora paciente/descartado). */
export function contarLeadsAtivos(pacientes: PacienteParaMetricas[]): number {
  return pacientes.filter((p) => ehEstagio(p.stage) && !FORA_DO_FUNIL.has(p.stage)).length
}

/**
 * Cadastros desta semana no calendário da clínica (hoje e 6 dias atrás).
 * Conta todo mundo — o subtítulo do KPI é "+N esta semana".
 */
export function contarNovosNaSemana(
  pacientes: PacienteParaMetricas[],
  hojeISO: string,
): number {
  const inicio = deslocarData(hojeISO, -6)
  return pacientes.filter((p) => {
    if (!p.criado_em) return false
    const dia = dataDaClinica(new Date(p.criado_em))
    return dia >= inicio && dia <= hojeISO
  }).length
}

/**
 * Conversão lead → paciente: pacientes no estágio `paciente` sobre o total
 * que não foi descartado. Sem base → `—`.
 */
export function formatarConversao(pacientes: PacienteParaMetricas[]): string {
  const base = pacientes.filter((p) => p.stage !== 'descartado')
  if (base.length === 0) return '—'
  const convertidas = base.filter((p) => p.stage === 'paciente').length
  return `${Math.round((convertidas / base.length) * 100)}%`
}

/**
 * Ticket médio dos últimos 30 dias. Centavos já somados/divididos fora —
 * aqui só formata no estilo do mockup (`R$ 3.9k` quando ≥ 1000).
 */
export function formatarTicketMedio(centavos: number | null): string {
  if (centavos === null) return '—'
  if (centavos <= 0) return 'R$ 0'
  const reais = centavos / 100
  if (reais >= 1000) {
    const milhares = reais / 1000
    const texto =
      milhares >= 10 ? String(Math.round(milhares)) : milhares.toFixed(1).replace('.', ',')
    return `R$ ${texto}k`
  }
  return formatarValorRedondo(centavos)
}

export function montarKpisDoFunil(
  pacientes: PacienteParaMetricas[],
  hojeISO: string,
  ticketMedioCentavos: number | null,
): KpisDoFunil {
  return {
    leadsAtivos: contarLeadsAtivos(pacientes),
    novosNaSemana: contarNovosNaSemana(pacientes, hojeISO),
    conversao: formatarConversao(pacientes),
    ticketMedio: formatarTicketMedio(ticketMedioCentavos),
  }
}

/** Soma do potencial da coluna → `R$ 4.200 em potencial` ou `—`. */
export function textoPotencialDaColuna(centavos: Array<number | null | undefined>): string {
  const valores = centavos.filter((v): v is number => typeof v === 'number' && v > 0)
  if (valores.length === 0) return '—'
  const total = valores.reduce((a, b) => a + b, 0)
  return `${formatarReais(total)} em potencial`
}

/** Preço no rodapé do cartão. Sem valor → `A definir` (mockup). */
export function textoPrecoDoCartao(centavos: number | null | undefined): string {
  if (centavos == null || centavos <= 0) return 'A definir'
  return formatarReais(centavos)
}
