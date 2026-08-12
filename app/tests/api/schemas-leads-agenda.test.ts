import { describe, expect, it } from 'vitest'
import { schemaAgendamento } from '@/lib/agenda/agendar'
import { schemaCancelamento } from '@/lib/agenda/cancelar'
import { schemaRemarcacao } from '@/lib/agenda/remarcar'
import { schemaAtualizarLead } from '@/lib/leads/atualizar'
import { schemaCriarLead } from '@/lib/leads/criar'
import { schemaMoverEstagio } from '@/lib/leads/mover-estagio'

const UUID = '11111111-1111-4111-8111-111111111111'
const INICIO = '2026-08-20T17:00:00.000Z'

describe('schemaCriarLead', () => {
  it('exige nome', () => {
    expect(schemaCriarLead.safeParse({ nome: '' }).success).toBe(false)
  })

  it('aceita mínimo válido', () => {
    expect(schemaCriarLead.safeParse({ nome: 'Maria' }).success).toBe(true)
  })
})

describe('schemaAtualizarLead', () => {
  it('recusa body vazio', () => {
    expect(schemaAtualizarLead.safeParse({}).success).toBe(false)
  })

  it('aceita um campo', () => {
    expect(schemaAtualizarLead.safeParse({ nome: 'Ana' }).success).toBe(true)
  })
})

describe('schemaMoverEstagio', () => {
  it('recusa estágio inventado', () => {
    expect(
      schemaMoverEstagio.safeParse({ pacienteId: UUID, estagio: 'xyz' }).success,
    ).toBe(false)
  })

  it('aceita estágio do funil', () => {
    expect(
      schemaMoverEstagio.safeParse({ pacienteId: UUID, estagio: 'contato' }).success,
    ).toBe(true)
  })
})

describe('schemaAgendamento', () => {
  it('exige paciente da lista ou paciente novo', () => {
    expect(
      schemaAgendamento.safeParse({
        procedimentoId: UUID,
        inicio: INICIO,
      }).success,
    ).toBe(false)
  })

  it('aceita paciente existente', () => {
    expect(
      schemaAgendamento.safeParse({
        pacienteId: UUID,
        procedimentoId: UUID,
        inicio: INICIO,
      }).success,
    ).toBe(true)
  })

  it('aceita paciente novo só com nome', () => {
    expect(
      schemaAgendamento.safeParse({
        pacienteNovo: { nome: 'Maria Silva' },
        procedimentoId: UUID,
        inicio: INICIO,
      }).success,
    ).toBe(true)
  })

  it('recusa os dois ao mesmo tempo', () => {
    expect(
      schemaAgendamento.safeParse({
        pacienteId: UUID,
        pacienteNovo: { nome: 'Maria' },
        procedimentoId: UUID,
        inicio: INICIO,
      }).success,
    ).toBe(false)
  })
})

describe('schemaRemarcacao', () => {
  it('exige consultaId e inicio', () => {
    expect(schemaRemarcacao.safeParse({}).success).toBe(false)
  })

  it('aceita remarcação mínima', () => {
    expect(
      schemaRemarcacao.safeParse({
        consultaId: UUID,
        inicio: INICIO,
      }).success,
    ).toBe(true)
  })
})

describe('schemaCancelamento', () => {
  it('exige consultaId', () => {
    expect(schemaCancelamento.safeParse({}).success).toBe(false)
    expect(schemaCancelamento.safeParse({ consultaId: UUID }).success).toBe(true)
  })
})
