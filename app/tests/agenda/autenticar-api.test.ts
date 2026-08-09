import { describe, expect, it } from 'vitest'
import { chaveApiBate, extrairChaveDoPedido } from '@/lib/agenda/autenticar-api'

describe('extrairChaveDoPedido', () => {
  it('lê Authorization Bearer', () => {
    const h = new Headers({ authorization: 'Bearer segredo-abc' })
    expect(extrairChaveDoPedido(h)).toBe('segredo-abc')
  })

  it('lê x-api-key', () => {
    const h = new Headers({ 'x-api-key': 'chave-xyz' })
    expect(extrairChaveDoPedido(h)).toBe('chave-xyz')
  })

  it('prefere Bearer a x-api-key', () => {
    const h = new Headers({
      authorization: 'Bearer do-bearer',
      'x-api-key': 'do-header',
    })
    expect(extrairChaveDoPedido(h)).toBe('do-bearer')
  })

  it('devolve null sem cabeçalho útil', () => {
    expect(extrairChaveDoPedido(new Headers())).toBeNull()
  })
})

describe('chaveApiBate', () => {
  it('recusa quando a chave do ambiente está ausente', () => {
    expect(chaveApiBate('qualquer', undefined)).toBe(false)
    expect(chaveApiBate('qualquer', '')).toBe(false)
  })

  it('recusa fornecida vazia ou nula', () => {
    expect(chaveApiBate(null, 'secreta')).toBe(false)
    expect(chaveApiBate('', 'secreta')).toBe(false)
  })

  it('aceita igualdade exata', () => {
    expect(chaveApiBate('mesma-chave', 'mesma-chave')).toBe(true)
  })

  it('recusa chave errada', () => {
    expect(chaveApiBate('errada', 'certa!!!!')).toBe(false)
  })
})
