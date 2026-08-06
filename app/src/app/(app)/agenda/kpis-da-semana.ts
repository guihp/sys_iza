/**
 * KPIs do cabeçalho da Agenda.
 *
 * Funções puras: recebem as consultas da semana e o dia de hoje na clínica, e
 * devolvem os três números do mockup. Sem banco, sem React — a página monta o
 * `<Kpi>` em cima do resultado.
 *
 * Banco vazio → `0`, `0%`, `0`. Nunca `NaN`.
 */

import { dataDaClinica, minutosDoDiaNaClinica } from '@/lib/datetime'
import {
  HORARIO_PADRAO,
  type HorarioDeAtendimento,
  faixasDoDia,
  minutosDeHHMM,
} from '@/domain/scheduling/working-hours'

/** Forma mínima que o KPI precisa de uma consulta. */
export type ConsultaParaKpi = {
  inicio: string
  fim: string
  status: string
}

export type KpisDaSemana = {
  /** Consultas vivas (≠ cancelado) na semana. */
  atendimentos: number
  /** `floor(minutosAgendados / minutosUteis * 100)`. Sempre ≥ 0. */
  ocupacaoPercentual: number
  /** Consultas vivas com início no dia `hojeISO`. */
  hoje: number
}

/** Soma das faixas abertas nos sete dias. Domingo (e dia fechado) soma zero. */
export function minutosUteisDaSemana(
  dias: readonly string[],
  horario: HorarioDeAtendimento = HORARIO_PADRAO,
): number {
  let total = 0
  for (const dia of dias) {
    for (const faixa of faixasDoDia(dia, horario)) {
      total += minutosDeHHMM(faixa.ate) - minutosDeHHMM(faixa.de)
    }
  }
  return total
}

/**
 * Minutos de uma consulta que caem dentro do expediente do dia.
 *
 * Cap no expediente: consulta que vaza da grade útil não infla a ocupação além
 * do que a clínica realmente atende. Fora do expediente (ou no domingo) zera.
 */
export function minutosAgendadosNoExpediente(
  inicio: Date,
  fim: Date,
  horario: HorarioDeAtendimento = HORARIO_PADRAO,
): number {
  const dataISO = dataDaClinica(inicio)
  const faixas = faixasDoDia(dataISO, horario)
  if (faixas.length === 0) return 0

  // Duração a partir do início — mesmo critério de `working-hours` / `grade`.
  const inicioMin = minutosDoDiaNaClinica(inicio)
  const duracao = Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 60_000))
  const fimMin = inicioMin + duracao

  let total = 0
  for (const faixa of faixas) {
    const de = minutosDeHHMM(faixa.de)
    const ate = minutosDeHHMM(faixa.ate)
    total += Math.max(0, Math.min(fimMin, ate) - Math.max(inicioMin, de))
  }
  return total
}

/**
 * Os três KPIs da semana clínica.
 *
 * `dias` são as sete datas ISO da grade (segunda → domingo). `hojeISO` é o dia
 * de calendário da clínica (`dataDaClinica(new Date())`).
 */
export function kpisDaSemana(
  consultas: readonly ConsultaParaKpi[],
  dias: readonly string[],
  hojeISO: string,
  horario: HorarioDeAtendimento = HORARIO_PADRAO,
): KpisDaSemana {
  const vivas = consultas.filter((consulta) => consulta.status !== 'cancelado')

  let minutosAgendados = 0
  let hoje = 0

  for (const consulta of vivas) {
    const inicio = new Date(consulta.inicio)
    const fim = new Date(consulta.fim)
    minutosAgendados += minutosAgendadosNoExpediente(inicio, fim, horario)
    if (dataDaClinica(inicio) === hojeISO) hoje += 1
  }

  const minutosUteis = minutosUteisDaSemana(dias, horario)
  const ocupacaoPercentual =
    minutosUteis === 0 ? 0 : Math.floor((minutosAgendados / minutosUteis) * 100)

  return {
    atendimentos: vivas.length,
    ocupacaoPercentual: Number.isFinite(ocupacaoPercentual) ? ocupacaoPercentual : 0,
    hoje,
  }
}
