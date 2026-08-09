import { describe, expect, it } from 'vitest'
import {
  ABAS_DE_CONFIGURACOES,
  abaAtiva,
  abasParaPapel,
} from '@/app/(app)/configuracoes/abas'

describe('ABAS_DE_CONFIGURACOES', () => {
  it('expõe Meta, Marca, Mensagens, Procedimentos, Notificações e Google nesta ordem', () => {
    expect(ABAS_DE_CONFIGURACOES.map((aba) => aba.rotulo)).toEqual([
      'Meta',
      'Marca',
      'Mensagens',
      'Procedimentos',
      'Notificações',
      'Google Agenda',
    ])
  })
})

describe('abasParaPapel', () => {
  it('dá à dra todas as abas', () => {
    expect(abasParaPapel('dra').map((a) => a.rotulo)).toEqual([
      'Meta',
      'Marca',
      'Mensagens',
      'Procedimentos',
      'Notificações',
      'Google Agenda',
    ])
  })

  it('dá à secretária só Notificações', () => {
    expect(abasParaPapel('secretaria').map((a) => a.rotulo)).toEqual(['Notificações'])
  })
})

describe('abaAtiva', () => {
  it('acende a aba do caminho exato', () => {
    expect(abaAtiva('/configuracoes/meta')).toBe('/configuracoes/meta')
  })

  it('acende numa subrota', () => {
    expect(abaAtiva('/configuracoes/procedimentos/abc')).toBe('/configuracoes/procedimentos')
  })

  it('não acende por prefixo solto', () => {
    expect(abaAtiva('/configuracoes/metalurgia')).toBeNull()
  })

  it('não acende sem caminho', () => {
    expect(abaAtiva(null)).toBeNull()
  })

  it('respeita a lista filtrada da secretária', () => {
    const abas = abasParaPapel('secretaria')
    expect(abaAtiva('/configuracoes/notificacoes', abas)).toBe('/configuracoes/notificacoes')
    expect(abaAtiva('/configuracoes/meta', abas)).toBeNull()
  })
})
