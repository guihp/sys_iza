import { describe, expect, it } from 'vitest'
import {
  jurosMaquininhaCentavos,
  MAX_PARCELAS_MAQUININHA,
  taxaMaquininhaPercentual,
  TAXA_CREDITO_POR_PARCELAS,
  TAXA_DEBITO_PERCENTUAL,
} from '@/domain/finance/taxas-maquininha'

describe('taxas maquininha', () => {
  it('expõe tabela crédito 1–4× e máximo 4', () => {
    expect(MAX_PARCELAS_MAQUININHA).toBe(4)
    expect(TAXA_CREDITO_POR_PARCELAS).toEqual({
      1: 3.86,
      2: 9.86,
      3: 11.24,
      4: 12.59,
    })
    expect(TAXA_DEBITO_PERCENTUAL).toBe(1.69)
  })

  it('taxa crédito por parcela', () => {
    expect(taxaMaquininhaPercentual(1)).toBe(3.86)
    expect(taxaMaquininhaPercentual(4)).toBe(12.59)
    expect(taxaMaquininhaPercentual(5)).toBeNull()
    expect(taxaMaquininhaPercentual(0)).toBeNull()
  })

  it('débito só em 1×', () => {
    expect(taxaMaquininhaPercentual(1, 'debito')).toBe(1.69)
    expect(taxaMaquininhaPercentual(2, 'debito')).toBeNull()
  })

  it('juros sem repasse = base × taxa%', () => {
    // R$ 1.000,00 em 1× → 3,86% = R$ 38,60
    expect(
      jurosMaquininhaCentavos({
        valorBaseCentavos: 100_000,
        parcelasQtd: 1,
        repassarAoCliente: false,
      }),
    ).toBe(3860)
  })

  it('juros com repasse = gross-up base × taxa/(100−taxa)', () => {
    // 100000 * 3.86 / 96.14 ≈ 4014.98 → 4015
    expect(
      jurosMaquininhaCentavos({
        valorBaseCentavos: 100_000,
        parcelasQtd: 1,
        repassarAoCliente: true,
      }),
    ).toBe(4015)
  })

  it('4× com repasse usa 12,59%', () => {
    // 50000 * 12.59 / 87.41 ≈ 7201.69 → 7202
    expect(
      jurosMaquininhaCentavos({
        valorBaseCentavos: 50_000,
        parcelasQtd: 4,
        repassarAoCliente: true,
      }),
    ).toBe(7202)
  })

  it('base zerada ou parcela inválida → 0', () => {
    expect(
      jurosMaquininhaCentavos({
        valorBaseCentavos: 0,
        parcelasQtd: 1,
        repassarAoCliente: true,
      }),
    ).toBe(0)
    expect(
      jurosMaquininhaCentavos({
        valorBaseCentavos: 10_000,
        parcelasQtd: 5,
        repassarAoCliente: true,
      }),
    ).toBe(0)
  })
})
