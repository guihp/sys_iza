import { describe, expect, it } from 'vitest'
import { extensaoDoTipo, MARCA_VAZIA, TAMANHO_MAXIMO_BYTES } from '@/lib/marca'

describe('extensaoDoTipo', () => {
  it('aceita jpeg, png e webp', () => {
    expect(extensaoDoTipo('image/jpeg')).toBe('jpg')
    expect(extensaoDoTipo('image/png')).toBe('png')
    expect(extensaoDoTipo('image/webp')).toBe('webp')
  })

  it('recusa o que não é imagem de marca', () => {
    expect(extensaoDoTipo('image/gif')).toBeNull()
    expect(extensaoDoTipo('application/pdf')).toBeNull()
  })
})

describe('constantes da marca', () => {
  it('marca vazia começa sem urls', () => {
    expect(MARCA_VAZIA).toEqual({ heroUrl: null, logoUrl: null })
  })

  it('teto de upload é 5 MB', () => {
    expect(TAMANHO_MAXIMO_BYTES).toBe(5 * 1024 * 1024)
  })
})
