import { describe, expect, it } from 'vitest'
import {
  baselineDasLinhasSalvas,
  linhaSalvaEhDoPlano,
  rotuloStatusExecucao,
  textoResumoCobranca,
} from '@/app/(app)/pacientes/[id]/atendimento-lista'

describe('rotuloStatusExecucao', () => {
  it('rotula completo e parcial; avulso sem rótulo', () => {
    expect(rotuloStatusExecucao('completo')).toBe('Execução completa')
    expect(rotuloStatusExecucao('parcial')).toBe('Execução parcial')
    expect(rotuloStatusExecucao('nao_aplicavel')).toBeNull()
  })
})

describe('textoResumoCobranca', () => {
  const fmt = (c: number) => `R$ ${(c / 100).toFixed(2)}`

  it('null quando não há cobrança', () => {
    expect(textoResumoCobranca(null, fmt)).toBeNull()
  })

  it('monta entrada / total / status', () => {
    expect(
      textoResumoCobranca(
        {
          valor_total_centavos: 10000,
          valor_entrada_centavos: 4000,
          status: 'parcial',
        },
        fmt,
      ),
    ).toBe('Entrada R$ 40.00 de R$ 100.00 · parcial')
  })
})

describe('baselineDasLinhasSalvas', () => {
  it('ignora extras (planejado 0) e preserva ordem/centavos', () => {
    expect(
      baselineDasLinhasSalvas([
        { ordem: 0, planejado_qtd: 20, planejado_centavos: 1000 },
        { ordem: 1, planejado_qtd: 0, planejado_centavos: 0 },
        { ordem: 2, planejado_qtd: 5, planejado_centavos: 250 },
      ]),
    ).toEqual([
      { ordem: 0, planejado_qtd: 20, planejado_centavos: 1000 },
      { ordem: 2, planejado_qtd: 5, planejado_centavos: 250 },
    ])
  })
})

describe('linhaSalvaEhDoPlano', () => {
  it('planejado > 0 = do plano; 0 = extra', () => {
    expect(linhaSalvaEhDoPlano(10)).toBe(true)
    expect(linhaSalvaEhDoPlano(0)).toBe(false)
  })
})
