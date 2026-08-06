import { describe, expect, it } from 'vitest'
import { ErroDePermissao, exigirDra } from '@/auth/guard'

const dra = { userId: 'u1', nome: 'Izadora', role: 'dra' as const }
const secretaria = { userId: 'u2', nome: 'Ana', role: 'secretaria' as const }

describe('exigirDra', () => {
  it('deixa a dra passar e devolve a sessão', () => {
    expect(exigirDra(dra)).toEqual(dra)
  })

  it('bloqueia a secretária', () => {
    expect(() => exigirDra(secretaria)).toThrow(ErroDePermissao)
  })

  it('bloqueia sessão ausente', () => {
    expect(() => exigirDra(null)).toThrow(ErroDePermissao)
  })
})
