import { describe, expect, it } from 'vitest'
import {
  gerarPlaintextDaChaveApi,
  hashDaChaveApi,
  hashDaChaveApiBate,
  prefixoDaChaveApi,
} from '@/lib/api/chave-api-hash'
import { urlPublicaDoApp } from '@/lib/url-publica'

describe('hashDaChaveApi / hashDaChaveApiBate', () => {
  it('gera plaintext de 64 hex', () => {
    const chave = gerarPlaintextDaChaveApi()
    expect(chave).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hash é estável e bate com a mesma chave', () => {
    const chave = 'a'.repeat(64)
    const hash = hashDaChaveApi(chave)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashDaChaveApi(chave)).toBe(hash)
    expect(hashDaChaveApiBate(chave, hash)).toBe(true)
  })

  it('recusa chave errada e hash inválido', () => {
    const hash = hashDaChaveApi('certa'.padEnd(64, '0'))
    expect(hashDaChaveApiBate('errada'.padEnd(64, '0'), hash)).toBe(false)
    expect(hashDaChaveApiBate('certa'.padEnd(64, '0'), null)).toBe(false)
    expect(hashDaChaveApiBate('certa'.padEnd(64, '0'), 'nao-hex')).toBe(false)
    expect(hashDaChaveApiBate('', hash)).toBe(false)
  })

  it('prefixo corta os primeiros caracteres', () => {
    expect(prefixoDaChaveApi('abcdefghijklmnop', 8)).toBe('abcdefgh')
  })
})

describe('urlPublicaDoApp', () => {
  it('usa x-forwarded-host e proto', () => {
    const h = new Headers({
      'x-forwarded-host': 'web.clinica.exemplo',
      'x-forwarded-proto': 'https',
    })
    expect(urlPublicaDoApp(h)).toBe('https://web.clinica.exemplo')
  })

  it('pega o primeiro host da lista do proxy', () => {
    const h = new Headers({
      'x-forwarded-host': 'app.exemplo.com, localhost:3000',
      'x-forwarded-proto': 'https, http',
    })
    expect(urlPublicaDoApp(h)).toBe('https://app.exemplo.com')
  })

  it('cai em host + http em localhost', () => {
    const h = new Headers({ host: 'localhost:3000' })
    expect(urlPublicaDoApp(h)).toBe('http://localhost:3000')
  })

  it('assume https sem proto em domínio público', () => {
    const h = new Headers({ host: 'sistema.clinica.com' })
    expect(urlPublicaDoApp(h)).toBe('https://sistema.clinica.com')
  })

  it('devolve vazio sem host', () => {
    expect(urlPublicaDoApp(new Headers())).toBe('')
  })
})
