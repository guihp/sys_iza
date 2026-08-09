import { describe, expect, it } from 'vitest'
import {
  BUCKET_MARCA,
  caminhoDoStoragePublico,
  ehUrlDaMarca,
  extensaoDoTipo,
  MARCA_VAZIA,
  TAMANHO_MAXIMO_BYTES,
} from '@/lib/marca'

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

  it('bucket público da marca tem nome fixo', () => {
    expect(BUCKET_MARCA).toBe('marca-clinica')
  })
})

describe('caminhoDoStoragePublico', () => {
  it('extrai o path do objeto na URL pública do Supabase', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/marca-clinica/hero-123.jpg'
    expect(caminhoDoStoragePublico(url)).toBe('hero-123.jpg')
  })

  it('ignora query string e decodifica o path', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/marca-clinica/logo%2Fmarca.png?t=1'
    expect(caminhoDoStoragePublico(url)).toBe('logo/marca.png')
  })

  it('recusa URL de outro bucket ou caminho local legado', () => {
    expect(
      caminhoDoStoragePublico(
        'https://abc.supabase.co/storage/v1/object/public/outro/hero.jpg',
      ),
    ).toBeNull()
    expect(caminhoDoStoragePublico('/marca/uploads/hero.jpg')).toBeNull()
  })
})

describe('ehUrlDaMarca', () => {
  it('aceita URL pública do bucket e caminho local legado', () => {
    expect(
      ehUrlDaMarca(
        'https://abc.supabase.co/storage/v1/object/public/marca-clinica/hero.jpg',
      ),
    ).toBe(true)
    expect(ehUrlDaMarca('/marca/uploads/hero.jpg')).toBe(true)
  })

  it('recusa vazio, outro host de arquivo e tipos errados', () => {
    expect(ehUrlDaMarca(null)).toBe(false)
    expect(ehUrlDaMarca('')).toBe(false)
    expect(ehUrlDaMarca('https://cdn.exemplo.com/foto.jpg')).toBe(false)
  })
})
