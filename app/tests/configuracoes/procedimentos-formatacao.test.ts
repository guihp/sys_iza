import { describe, expect, it } from 'vitest'
import {
  descreverRetorno,
  formatarDuracao,
  formatarPreco,
  mascararMoedaAoDigitar,
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

describe('formatarDuracao', () => {
  it('sufixo curto do mockup', () => {
    expect(formatarDuracao(60)).toBe('60 min')
    expect(formatarDuracao(45)).toBe('45 min')
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
  it('devolve o valor editável com milhar e vírgula decimal, sem símbolo', () => {
    expect(precoParaCampo(180000)).toBe('1.800,00')
    expect(precoParaCampo(1240000)).toBe('12.400,00')
    expect(precoParaCampo(2550)).toBe('25,50')
    expect(precoParaCampo(0)).toBe('0,00')
  })

  it('faz a volta completa com reaisParaCentavos', () => {
    expect(reaisParaCentavos(precoParaCampo(2550))).toBe(2550)
    expect(reaisParaCentavos(precoParaCampo(1240000))).toBe(1240000)
  })
})

describe('mascararMoedaAoDigitar', () => {
  it('trata dígitos como centavos da direita para a esquerda', () => {
    expect(mascararMoedaAoDigitar('1')).toBe('0,01')
    expect(mascararMoedaAoDigitar('12')).toBe('0,12')
    expect(mascararMoedaAoDigitar('123')).toBe('1,23')
    expect(mascararMoedaAoDigitar('10000')).toBe('100,00')
    expect(mascararMoedaAoDigitar('1000000')).toBe('10.000,00')
    expect(mascararMoedaAoDigitar('1240000')).toBe('12.400,00')
  })

  it('ignora pontuação e símbolo ao colar valor já formatado', () => {
    expect(mascararMoedaAoDigitar('R$ 1.800,00')).toBe('1.800,00')
    expect(mascararMoedaAoDigitar('12.400,00')).toBe('12.400,00')
  })

  it('campo sem dígitos fica vazio; só zeros vira 0,00', () => {
    expect(mascararMoedaAoDigitar('')).toBe('')
    expect(mascararMoedaAoDigitar('abc')).toBe('')
    expect(mascararMoedaAoDigitar('0')).toBe('0,00')
    expect(mascararMoedaAoDigitar('000')).toBe('0,00')
  })

  it('volta para centavos com reaisParaCentavos', () => {
    expect(reaisParaCentavos(mascararMoedaAoDigitar('1000000'))).toBe(1000000)
    expect(reaisParaCentavos(mascararMoedaAoDigitar('2550'))).toBe(2550)
  })
})
