import { describe, expect, it } from 'vitest'
import {
  contarPorStatus,
  montarFila,
  ultimoPorPaciente,
  type AtendimentoDoPaciente,
} from '@/app/(app)/retornos/fila'

const HOJE = '2026-08-05'

let sequencia = 0

function atendimento(parcial: Partial<AtendimentoDoPaciente> = {}): AtendimentoDoPaciente {
  sequencia += 1
  return {
    atendimentoId: `at-${sequencia}`,
    pacienteId: 'p1',
    paciente: 'Ana Souza',
    apelido: null,
    telefone: '+5511987654321',
    procedimento: 'Toxina botulínica',
    intervaloRetornoDias: 120,
    realizadoEm: '2026-04-05T13:00:00.000Z',
    vencimento: '2026-08-03',
    ...parcial,
  }
}

describe('ultimoPorPaciente', () => {
  it('mantém só o atendimento mais recente de cada paciente', () => {
    const antigo = atendimento({ pacienteId: 'p1', realizadoEm: '2025-01-10T13:00:00.000Z' })
    const recente = atendimento({ pacienteId: 'p1', realizadoEm: '2026-04-05T13:00:00.000Z' })
    const outra = atendimento({ pacienteId: 'p2', realizadoEm: '2026-02-01T13:00:00.000Z' })

    const resultado = ultimoPorPaciente([antigo, recente, outra])

    expect(resultado.map((r) => r.atendimentoId)).toEqual([recente.atendimentoId, outra.atendimentoId])
  })

  it('não depende da ordem em que os registros chegam', () => {
    const antigo = atendimento({ realizadoEm: '2025-01-10T13:00:00.000Z' })
    const recente = atendimento({ realizadoEm: '2026-04-05T13:00:00.000Z' })

    expect(ultimoPorPaciente([antigo, recente])[0].atendimentoId).toBe(recente.atendimentoId)
    expect(ultimoPorPaciente([recente, antigo])[0].atendimentoId).toBe(recente.atendimentoId)
  })
})

describe('montarFila — quem entra', () => {
  it('inclui quem já venceu', () => {
    const fila = montarFila([atendimento({ vencimento: '2026-08-01' })], HOJE)
    expect(fila).toHaveLength(1)
    expect(fila[0].status).toBe('vencido')
    expect(fila[0].diasRestantes).toBe(-4)
  })

  it('inclui quem vence dentro de trinta dias', () => {
    const fila = montarFila([atendimento({ vencimento: '2026-09-04' })], HOJE)
    expect(fila).toHaveLength(1)
    expect(fila[0].status).toBe('vencendo')
    expect(fila[0].diasRestantes).toBe(30)
  })

  it('quem vence hoje entra como vencendo, não como vencido', () => {
    const fila = montarFila([atendimento({ vencimento: HOJE })], HOJE)
    expect(fila[0].status).toBe('vencendo')
    expect(fila[0].diasRestantes).toBe(0)
  })

  it('deixa de fora quem ainda está em dia', () => {
    expect(montarFila([atendimento({ vencimento: '2026-12-03' })], HOJE)).toHaveLength(0)
  })

  it('deixa de fora quem não tem retorno', () => {
    expect(montarFila([atendimento({ vencimento: null })], HOJE)).toHaveLength(0)
  })

  it('o atendimento mais novo manda, mesmo quando o antigo está vencido', () => {
    // A paciente voltou. O retorno vencido do procedimento anterior não pode
    // continuar cobrando alguém que acabou de sair da cadeira.
    const fila = montarFila(
      [
        atendimento({ realizadoEm: '2025-01-10T13:00:00.000Z', vencimento: '2025-06-01' }),
        atendimento({ realizadoEm: '2026-07-20T13:00:00.000Z', vencimento: '2026-11-17' }),
      ],
      HOJE,
    )
    expect(fila).toHaveLength(0)
  })

  it('sem retorno no atendimento mais novo tira a paciente da fila', () => {
    // Nível 3 do cálculo de retorno chegando até a fila: a Dra. dispensou o
    // retorno no último atendimento, e a fila para de cobrar.
    const fila = montarFila(
      [
        atendimento({ realizadoEm: '2025-01-10T13:00:00.000Z', vencimento: '2025-06-01' }),
        atendimento({ realizadoEm: '2026-07-20T13:00:00.000Z', vencimento: null }),
      ],
      HOJE,
    )
    expect(fila).toHaveLength(0)
  })

  it('cada paciente aparece uma vez só', () => {
    const fila = montarFila(
      [
        atendimento({ pacienteId: 'p1', realizadoEm: '2025-01-10T13:00:00.000Z' }),
        atendimento({ pacienteId: 'p1', realizadoEm: '2026-04-05T13:00:00.000Z' }),
        atendimento({ pacienteId: 'p2', realizadoEm: '2026-04-05T13:00:00.000Z' }),
      ],
      HOJE,
    )
    expect(fila).toHaveLength(2)
  })
})

describe('montarFila — ordem', () => {
  it('vencidos primeiro, e dentro de cada grupo o vencimento mais antigo na frente', () => {
    const fila = montarFila(
      [
        atendimento({ pacienteId: 'p1', paciente: 'Vence em 20 dias', vencimento: '2026-08-25' }),
        atendimento({ pacienteId: 'p2', paciente: 'Atrasado há 4 dias', vencimento: '2026-08-01' }),
        atendimento({ pacienteId: 'p3', paciente: 'Vence amanhã', vencimento: '2026-08-06' }),
        atendimento({ pacienteId: 'p4', paciente: 'Atrasado há 8 meses', vencimento: '2025-12-01' }),
      ],
      HOJE,
    )

    expect(fila.map((linha) => linha.paciente)).toEqual([
      'Atrasado há 8 meses',
      'Atrasado há 4 dias',
      'Vence amanhã',
      'Vence em 20 dias',
    ])
  })

  it('empate de vencimento é desempatado pelo nome, para a lista não dançar', () => {
    const fila = montarFila(
      [
        atendimento({ pacienteId: 'p1', paciente: 'Carla', vencimento: '2026-08-10' }),
        atendimento({ pacienteId: 'p2', paciente: 'Ana', vencimento: '2026-08-10' }),
        atendimento({ pacienteId: 'p3', paciente: 'Beatriz', vencimento: '2026-08-10' }),
      ],
      HOJE,
    )
    expect(fila.map((linha) => linha.paciente)).toEqual(['Ana', 'Beatriz', 'Carla'])
  })
})

describe('contarPorStatus', () => {
  it('conta vencidos e vencendo', () => {
    const fila = montarFila(
      [
        atendimento({ pacienteId: 'p1', vencimento: '2026-08-01' }),
        atendimento({ pacienteId: 'p2', vencimento: '2026-07-01' }),
        atendimento({ pacienteId: 'p3', vencimento: '2026-08-20' }),
      ],
      HOJE,
    )
    expect(contarPorStatus(fila)).toEqual({ vencidos: 2, vencendo: 1 })
  })

  it('fila vazia conta zero', () => {
    expect(contarPorStatus([])).toEqual({ vencidos: 0, vencendo: 0 })
  })
})
