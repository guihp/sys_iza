import { describe, expect, it } from 'vitest'
import {
  BUCKET_MARCA,
  caminhoDoStoragePublico,
  ehUrlDaMarca,
  estiloImagemDaLogo,
  extensaoDoTipo,
  LOGO_ESCALA_PADRAO,
  LOGO_POS_PADRAO,
  MARCA_VAZIA,
  normalizarEnquadramento,
  normalizarEscalaDaLogo,
  normalizarPosicaoDaLogo,
  TAMANHO_MAXIMO_BYTES,
  tamanhoQuadroDaLogo,
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
  it('marca vazia começa sem urls e enquadramento padrão', () => {
    expect(MARCA_VAZIA).toEqual({
      heroUrl: null,
      logoUrl: null,
      logoEscala: LOGO_ESCALA_PADRAO,
      logoPosX: LOGO_POS_PADRAO,
      logoPosY: LOGO_POS_PADRAO,
    })
  })

  it('teto de upload é 5 MB', () => {
    expect(TAMANHO_MAXIMO_BYTES).toBe(5 * 1024 * 1024)
  })

  it('bucket público da marca tem nome fixo', () => {
    expect(BUCKET_MARCA).toBe('marca-clinica')
  })
})

describe('enquadramento da logo', () => {
  it('normaliza escala até 400%', () => {
    expect(normalizarEscalaDaLogo(1)).toBe(1)
    expect(normalizarEscalaDaLogo(9)).toBe(4)
    expect(normalizarEscalaDaLogo(0.1)).toBe(0.5)
  })

  it('normaliza posição 0–100', () => {
    expect(normalizarPosicaoDaLogo(50)).toBe(50)
    expect(normalizarPosicaoDaLogo(-10)).toBe(0)
    expect(normalizarPosicaoDaLogo(150)).toBe(100)
  })

  it('estilo de imagem usa contain + scale interno (layout fixo)', () => {
    const estilo = estiloImagemDaLogo({ escala: 2, posX: 20, posY: 80 })
    expect(estilo.objectFit).toBe('contain')
    expect(estilo.objectPosition).toBe('20% 80%')
    expect(estilo.transform).toBe('scale(2)')
    expect(estilo.transformOrigin).toBe('20% 80%')
  })

  it('normalizarEnquadramento preenche defaults', () => {
    expect(normalizarEnquadramento({})).toEqual({
      escala: LOGO_ESCALA_PADRAO,
      posX: LOGO_POS_PADRAO,
      posY: LOGO_POS_PADRAO,
    })
  })

  it('tamanho do quadro ignora zoom (fixo)', () => {
    expect(tamanhoQuadroDaLogo({ alturaPx: 48, larguraPx: 160 })).toEqual({
      height: '48px',
      width: '160px',
    })
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
