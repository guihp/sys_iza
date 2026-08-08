import { describe, expect, it } from 'vitest'
import { instanteDaClinica } from '@/lib/datetime'
import { diasDaSemana } from '@/app/(app)/agenda/grade'
import {
  kpisDaSemana,
  minutosAgendadosNoExpediente,
  minutosUteisDaSemana,
} from '@/app/(app)/agenda/kpis-da-semana'

/** Segunda a domingo de 10–16 de agosto de 2026. */
const DIAS = diasDaSemana('2026-08-10')

/** 7 dias × 12 h (08–20) = 5040 min. */
const MINUTOS_UTEIS_SEMANA = 7 * 12 * 60

function consulta(dia: string, hhmm: string, duracao: number, status = 'agendado') {
  const [hora, minuto] = hhmm.split(':').map(Number)
  const inicio = instanteDaClinica(dia, hora * 60 + minuto)
  const fim = new Date(inicio.getTime() + duracao * 60_000)
  return { inicio: inicio.toISOString(), fim: fim.toISOString(), status }
}

describe('minutosUteisDaSemana', () => {
  it('soma 08–20 nos sete dias (expediente temporário liberado)', () => {
    expect(minutosUteisDaSemana(DIAS)).toBe(MINUTOS_UTEIS_SEMANA)
  })
})

describe('minutosAgendadosNoExpediente', () => {
  it('conta a duração bruta quando cabe no expediente', () => {
    const inicio = instanteDaClinica('2026-08-10', 14 * 60)
    const fim = new Date(inicio.getTime() + 60 * 60_000)
    expect(minutosAgendadosNoExpediente(inicio, fim)).toBe(60)
  })

  it('corta o que passa do fechamento (20:00)', () => {
    // 19:00–21:00: só 60 min dentro do expediente.
    const inicio = instanteDaClinica('2026-08-15', 19 * 60)
    const fim = new Date(inicio.getTime() + 120 * 60_000)
    expect(minutosAgendadosNoExpediente(inicio, fim)).toBe(60)
  })

  it('conta domingo como dia útil no horário liberado', () => {
    const inicio = instanteDaClinica('2026-08-16', 10 * 60)
    const fim = new Date(inicio.getTime() + 60 * 60_000)
    expect(minutosAgendadosNoExpediente(inicio, fim)).toBe(60)
  })
})

describe('kpisDaSemana', () => {
  it('banco vazio → 0, 0%, 0 — nunca NaN', () => {
    const kpis = kpisDaSemana([], DIAS, '2026-08-12')
    expect(kpis).toEqual({ atendimentos: 0, ocupacaoPercentual: 0, hoje: 0 })
    expect(Number.isNaN(kpis.ocupacaoPercentual)).toBe(false)
  })

  it('ignora canceladas nos três números', () => {
    const kpis = kpisDaSemana(
      [
        consulta('2026-08-12', '10:00', 60, 'agendado'),
        consulta('2026-08-12', '11:00', 60, 'cancelado'),
        consulta('2026-08-13', '09:00', 30, 'confirmado'),
      ],
      DIAS,
      '2026-08-12',
    )
    expect(kpis.atendimentos).toBe(2)
    expect(kpis.hoje).toBe(1)
    // 60 + 30 = 90 de 5040 → floor(1.78…) = 1
    expect(kpis.ocupacaoPercentual).toBe(1)
  })

  it('conta HOJE só pelo dia de calendário da clínica', () => {
    const kpis = kpisDaSemana(
      [
        consulta('2026-08-12', '09:00', 30),
        consulta('2026-08-12', '10:00', 30),
        consulta('2026-08-13', '09:00', 30),
      ],
      DIAS,
      '2026-08-12',
    )
    expect(kpis.hoje).toBe(2)
    expect(kpis.atendimentos).toBe(3)
  })

  it('ocupação usa floor e não passa de 100 por acidente de arredondamento', () => {
    const kpis = kpisDaSemana([consulta('2026-08-10', '08:00', 60)], DIAS, '2026-08-10')
    expect(kpis.ocupacaoPercentual).toBe(Math.floor((60 / MINUTOS_UTEIS_SEMANA) * 100))
  })
})
