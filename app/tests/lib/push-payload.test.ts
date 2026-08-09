import { describe, expect, it } from 'vitest'
import { formatarPayloadDeAgendamento } from '@/lib/push/payload'

describe('formatarPayloadDeAgendamento', () => {
  it('monta título, corpo com paciente/data/hora/procedimento e URL da agenda', () => {
    // 2026-08-10 14:30 America/Sao_Paulo = 17:30 UTC
    const inicio = new Date('2026-08-10T17:30:00.000Z')
    const payload = formatarPayloadDeAgendamento({
      nomePaciente: 'Maria Silva',
      nomeProcedimento: 'Toxina botulínica',
      inicio,
    })

    expect(payload.titulo).toBe('Novo agendamento')
    expect(payload.url).toBe('/agenda')
    expect(payload.corpo).toContain('Maria Silva')
    expect(payload.corpo).toContain('Toxina botulínica')
    expect(payload.corpo).toContain('14:30')
    expect(payload.corpo).toMatch(/10 de agosto/)
  })

  it('usa fallbacks quando nome ou procedimento vêm vazios', () => {
    const inicio = new Date('2026-08-10T17:30:00.000Z')
    const payload = formatarPayloadDeAgendamento({
      nomePaciente: '  ',
      nomeProcedimento: '',
      inicio,
    })
    expect(payload.corpo).toContain('Paciente')
    expect(payload.corpo).toContain('procedimento')
  })
})
