import { describe, expect, it } from 'vitest'
import {
  PASSO_DO_ARREDONDAMENTO_CENTAVOS,
  arredondarValorParaCentena,
  valorDoEventoEmReais,
} from '@/domain/marketing/valor'

describe('arredondarValorParaCentena', () => {
  it('leva o preço à centena mais próxima', () => {
    expect(arredondarValorParaCentena(184_700)).toBe(180_000) // R$ 1.847 → R$ 1.800
    expect(arredondarValorParaCentena(186_000)).toBe(190_000) // R$ 1.860 → R$ 1.900
  })

  it('apaga a diferença entre procedimentos de preço vizinho', () => {
    // É o ponto inteiro da mitigação: dois preços distintos do catálogo saem
    // como o mesmo número, e o valor deixa de apontar para uma linha da tabela.
    const primeiro = arredondarValorParaCentena(181_200)
    const segundo = arredondarValorParaCentena(184_700)
    expect(primeiro).toBe(segundo)
  })

  it('sobe no meio-degrau exato', () => {
    expect(arredondarValorParaCentena(5_000)).toBe(10_000) // R$ 50 → R$ 100
    expect(arredondarValorParaCentena(4_999)).toBe(0)
  })

  it('deixa quieto o que já está na centena', () => {
    expect(arredondarValorParaCentena(180_000)).toBe(180_000)
    expect(arredondarValorParaCentena(0)).toBe(0)
  })

  it('sempre devolve múltiplo do passo', () => {
    for (const centavos of [1, 999, 4_321, 99_999, 123_456, 1_000_001]) {
      expect(arredondarValorParaCentena(centavos) % PASSO_DO_ARREDONDAMENTO_CENTAVOS).toBe(0)
    }
  })

  it('nunca propaga negativo nem NaN para fora do sistema', () => {
    expect(arredondarValorParaCentena(-180_000)).toBe(0)
    expect(arredondarValorParaCentena(Number.NaN)).toBe(0)
    expect(arredondarValorParaCentena(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('não perde a borda por ponto flutuante', () => {
    // `18.47 * 100` dá 1846.9999999999998 em ponto flutuante. A aritmética aqui
    // é inteira do começo ao fim, e centavos fracionários são resolvidos antes
    // do módulo, não depois.
    expect(arredondarValorParaCentena(1846.9999999999998)).toBe(0)
    expect(arredondarValorParaCentena(5_000.4)).toBe(10_000)
  })
})

describe('valorDoEventoEmReais', () => {
  it('devolve reais inteiros, prontos para o campo `value`', () => {
    expect(valorDoEventoEmReais(184_700)).toBe(1_800)
    expect(valorDoEventoEmReais(0)).toBe(0)
  })

  it('o resultado é sempre inteiro — a divisão por 100 é exata', () => {
    for (const centavos of [1, 7_777, 184_700, 999_999]) {
      expect(Number.isInteger(valorDoEventoEmReais(centavos))).toBe(true)
    }
  })
})
