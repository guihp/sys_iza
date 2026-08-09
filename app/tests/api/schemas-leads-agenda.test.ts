import { describe, expect, it } from 'vitest'
import { schemaCancelamento } from '@/lib/agenda/cancelar'
import { schemaRemarcacao } from '@/lib/agenda/remarcar'
import { schemaAtualizarLead } from '@/lib/leads/atualizar'
import { schemaCriarLead } from '@/lib/leads/criar'
import { schemaMoverEstagio } from '@/lib/leads/mover-estagio'

const UUID = '11111111-1111-4111-8111-111111111111'

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

describe('schemaRemarcacao', () => {
  it('exige consultaId e inicio', () => {
    expect(schemaRemarcacao.safeParse({}).success).toBe(false)
  })

  it('aceita remarcação mínima', () => {
    expect(
      schemaRemarcacao.safeParse({
        consultaId: UUID,
        inicio: '2026-08-20T17:00:00.000Z',
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
