import { describe, expect, it } from 'vitest'
import {
  caminhoNoBucket,
  destinoDoArquivo,
  extensaoDeMime,
  tituloDeNomeArquivo,
} from '@/lib/pasta-paciente'

describe('pasta-paciente', () => {
  it('monta caminho por paciente e pasta', () => {
    expect(caminhoNoBucket('abc', 'fotos', 'x.jpg')).toBe('abc/fotos/x.jpg')
    expect(caminhoNoBucket('abc', 'arquivos', 'termo.pdf')).toBe('abc/arquivos/termo.pdf')
  })

  it('aceita mime de imagem e PDF', () => {
    expect(extensaoDeMime('image/jpeg', true)).toBe('jpg')
    expect(extensaoDeMime('application/pdf', true)).toBeNull()
    expect(extensaoDeMime('application/pdf')).toBe('pdf')
  })

  it('classifica destino por mime', () => {
    expect(destinoDoArquivo('image/png')).toBe('foto')
    expect(destinoDoArquivo('application/pdf')).toBe('arquivo')
    expect(destinoDoArquivo('image/gif')).toBeNull()
  })

  it('deriva título do nome do arquivo', () => {
    expect(tituloDeNomeArquivo('termo-assinado.pdf')).toBe('termo-assinado')
    expect(tituloDeNomeArquivo('/tmp/exame.lab.PDF')).toBe('exame.lab')
    expect(tituloDeNomeArquivo('.hidden')).toBe('.hidden')
  })
})
