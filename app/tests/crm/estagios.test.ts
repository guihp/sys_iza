import { describe, expect, it } from 'vitest'
import {
  agruparPorEstagio,
  ehEstagio,
  ESTAGIOS,
  ROTULOS,
  type PatientStage,
} from '@/app/(app)/crm/estagios'

describe('ESTAGIOS', () => {
  it('tem exatamente os sete estágios, na ordem do funil', () => {
    // A ordem não é cosmética: é a ordem das colunas do kanban e a mesma do
    // enum patient_stage no banco.
    expect([...ESTAGIOS]).toEqual([
      'lead',
      'contato',
      'agendado',
      'compareceu',
      'paciente',
      'retorno',
      'descartado',
    ])
  })

  it('tem rótulo em português para cada estágio', () => {
    for (const estagio of ESTAGIOS) {
      expect(ROTULOS[estagio], `falta rótulo de ${estagio}`).toBeTruthy()
    }
    expect(Object.keys(ROTULOS)).toHaveLength(ESTAGIOS.length)
  })
})

describe('ehEstagio', () => {
  it('reconhece os estágios válidos', () => {
    for (const estagio of ESTAGIOS) {
      expect(ehEstagio(estagio)).toBe(true)
    }
  })

  it('recusa qualquer outra coisa', () => {
    expect(ehEstagio('vendido')).toBe(false)
    expect(ehEstagio('Lead')).toBe(false)
    expect(ehEstagio('')).toBe(false)
    expect(ehEstagio(null)).toBe(false)
    expect(ehEstagio(3)).toBe(false)
  })
})

describe('agruparPorEstagio', () => {
  const paciente = (id: string, stage: PatientStage) => ({ id, stage })

  it('devolve as sete colunas mesmo sem paciente algum', () => {
    const grupos = agruparPorEstagio([])
    expect(Object.keys(grupos)).toHaveLength(7)
    for (const estagio of ESTAGIOS) {
      expect(grupos[estagio]).toEqual([])
    }
  })

  it('põe cada paciente na sua coluna, preservando a ordem de entrada', () => {
    const grupos = agruparPorEstagio([
      paciente('a', 'lead'),
      paciente('b', 'paciente'),
      paciente('c', 'lead'),
    ])
    expect(grupos.lead.map((p) => p.id)).toEqual(['a', 'c'])
    expect(grupos.paciente.map((p) => p.id)).toEqual(['b'])
    expect(grupos.descartado).toEqual([])
  })

  it('ignora estágio desconhecido em vez de quebrar a tela', () => {
    const grupos = agruparPorEstagio([
      { id: 'a', stage: 'lead' as PatientStage },
      { id: 'x', stage: 'inventado' as PatientStage },
    ])
    expect(grupos.lead.map((p) => p.id)).toEqual(['a'])
    expect(Object.values(grupos).flat()).toHaveLength(1)
  })
})
