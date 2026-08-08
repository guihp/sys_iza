import { describe, expect, it } from 'vitest'
import {
  caminhoNoBucket,
  extensaoDeMime,
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
})
