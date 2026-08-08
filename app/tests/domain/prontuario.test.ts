import { describe, expect, it } from 'vitest'
import {
  abaDaUrl,
  idadeEmAnos,
  totalMlFiller,
  totalUnidadesBotox,
  validarAutoconfianca,
} from '@/domain/clinical/prontuario'

describe('validarAutoconfianca', () => {
  it('aceita inteiros de 0 a 10', () => {
    expect(validarAutoconfianca(0)).toBe(0)
    expect(validarAutoconfianca(10)).toBe(10)
    expect(validarAutoconfianca('7')).toBe(7)
  })

  it('rejeita fora da escala e não-inteiros', () => {
    expect(validarAutoconfianca(-1)).toBeNull()
    expect(validarAutoconfianca(11)).toBeNull()
    expect(validarAutoconfianca(3.5)).toBeNull()
    expect(validarAutoconfianca('abc')).toBeNull()
  })

  it('trata vazio como ausência', () => {
    expect(validarAutoconfianca(null)).toBeNull()
    expect(validarAutoconfianca('')).toBeNull()
    expect(validarAutoconfianca(undefined)).toBeNull()
  })
})

describe('idadeEmAnos', () => {
  it('conta anos completos no aniversário', () => {
    expect(idadeEmAnos('1990-08-06', '2026-08-06')).toBe(36)
    expect(idadeEmAnos('1990-08-06', '2026-08-05')).toBe(35)
  })

  it('rejeita nascimento futuro ou data inválida', () => {
    expect(idadeEmAnos('2030-01-01', '2026-08-06')).toBeNull()
    expect(idadeEmAnos('1990-13-01', '2026-08-06')).toBeNull()
    expect(idadeEmAnos('nao-e-data', '2026-08-06')).toBeNull()
  })
})

describe('totais dos planos', () => {
  it('soma unidades de toxina preferindo total_unidades', () => {
    expect(
      totalUnidadesBotox([
        { quantidade_unidades: 10, total_unidades: 12 },
        { quantidade_unidades: 5 },
        { total_unidades: null },
      ]),
    ).toBe(17)
  })

  it('soma ml de preenchimento ignorando inválidos', () => {
    expect(totalMlFiller([{ quantidade_ml: 1.5 }, { quantidade_ml: -1 }, { quantidade_ml: 0.5 }])).toBe(
      2,
    )
  })
})

describe('abaDaUrl', () => {
  it('aceita abas conhecidas e cai em cadastro no resto', () => {
    expect(abaDaUrl('anamnese')).toBe('anamnese')
    expect(abaDaUrl(['pasta'])).toBe('pasta')
    expect(abaDaUrl('xyz')).toBe('cadastro')
    expect(abaDaUrl(undefined)).toBe('cadastro')
  })
})
