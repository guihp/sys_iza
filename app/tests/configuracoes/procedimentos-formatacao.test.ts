import { describe, expect, it } from 'vitest'
import {
  descreverRetorno,
  formatarPreco,
  precoParaCampo,
  reaisParaCentavos,
} from '@/app/(app)/configuracoes/procedimentos/formatacao'

/** O Intl usa espaço não separável depois do "R$"; normalizar evita falso negativo. */
const semNbsp = (texto: string) => texto.replace(/ /g, ' ')

describe('formatarPreco', () => {
  it('formata centavos em reais', () => {
    expect(semNbsp(formatarPreco(180000))).toBe('R$ 1.800,00')
    expect(semNbsp(formatarPreco(2550))).toBe('R$ 25,50')
  })

  it('preço zero vira "Sem custo" — é a avaliação de cortesia, não R$ 0,00', () => {
    expect(formatarPreco(0)).toBe('Sem custo')
  })
})

describe('descreverRetorno', () => {
  it('null significa que o procedimento não gera retorno', () => {
    expect(descreverRetorno(null)).toBe('Sem retorno')
  })

  it('descreve o intervalo em dias', () => {
    expect(descreverRetorno(120)).toBe('120 dias')
    expect(descreverRetorno(1)).toBe('1 dia')
  })
})

describe('reaisParaCentavos', () => {
  it('aceita a vírgula decimal do pt-BR', () => {
    expect(reaisParaCentavos('1.800,00')).toBe(180000)
    expect(reaisParaCentavos('25,50')).toBe(2550)
  })

  it('aceita ponto decimal digitado por teclado numérico', () => {
    expect(reaisParaCentavos('1800.50')).toBe(180050)
  })

  it('trata ponto com três casas como separador de milhar, não decimal', () => {
    // Quem digita "1.800" no Brasil quer mil e oitocentos reais, não R$ 1,80.
    expect(reaisParaCentavos('1.800')).toBe(180000)
  })

  it('ignora o símbolo da moeda e espaços', () => {
    expect(reaisParaCentavos('R$ 1.800,00')).toBe(180000)
  })

  it('arredonda para o centavo mais próximo', () => {
    expect(reaisParaCentavos('10,005')).toBe(1001)
  })

  it('devolve null quando não há número', () => {
    expect(reaisParaCentavos('')).toBeNull()
    expect(reaisParaCentavos('   ')).toBeNull()
    expect(reaisParaCentavos('abc')).toBeNull()
  })

  it('devolve null para valor negativo — preço não é desconto', () => {
    expect(reaisParaCentavos('-10')).toBeNull()
  })
})

describe('precoParaCampo', () => {
  it('devolve o valor editável, sem símbolo de moeda', () => {
    expect(precoParaCampo(180000)).toBe('1800,00')
    expect(precoParaCampo(0)).toBe('0,00')
  })

  it('faz a volta completa com reaisParaCentavos', () => {
    expect(reaisParaCentavos(precoParaCampo(2550))).toBe(2550)
  })
})
