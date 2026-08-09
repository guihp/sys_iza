import { describe, expect, it } from 'vitest'
import {
  aplicarFeito,
  criarLinhaExtra,
  montarLinhasBotox,
  montarLinhasFiller,
  resumoQuantidadeFeita,
  statusExecucao,
  totaisExecucao,
} from '@/domain/clinical/atendimento-execucao'

const catalogo = [
  { id: 'tox-1', preco_centavos: 50 }, // R$ 0,50 / U
  { id: 'fil-1', preco_centavos: 10000 }, // R$ 100 / mL
]

describe('montarLinhasBotox', () => {
  it('monta linhas com feito = planejado e centavos do catálogo', () => {
    const linhas = montarLinhasBotox(
      [
        {
          musculo: 'Frontal',
          total_unidades: 20,
          quantidade_unidades: 18,
          procedimento_id: 'tox-1',
          ordem: 0,
        },
        {
          musculo: 'Glabela',
          quantidade_unidades: 10,
          procedimento_id: 'tox-1',
          ordem: 1,
        },
      ],
      catalogo,
    )

    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toMatchObject({
      rotulo: 'Frontal',
      unidade: 'U',
      planejado_qtd: 20,
      feito_qtd: 20,
      planejado_centavos: 1000,
      feito_centavos: 1000,
      preco_centavos: 50,
    })
    expect(linhas[1]).toMatchObject({
      planejado_qtd: 10,
      feito_qtd: 10,
      planejado_centavos: 500,
      feito_centavos: 500,
    })
  })

  it('aceita Map de preços e zera quando sem procedimento', () => {
    const linhas = montarLinhasBotox(
      [{ musculo: 'X', quantidade_unidades: 5, procedimento_id: null }],
      new Map([['tox-1', 50]]),
    )
    expect(linhas[0]!.planejado_centavos).toBe(0)
    expect(linhas[0]!.preco_centavos).toBe(0)
  })
})

describe('montarLinhasFiller', () => {
  it('usa mL × preço do catálogo', () => {
    const linhas = montarLinhasFiller(
      [{ produto: 'Malar', quantidade_ml: 1.5, procedimento_id: 'fil-1', ordem: 0 }],
      catalogo,
    )
    expect(linhas[0]).toMatchObject({
      rotulo: 'Malar',
      unidade: 'ml',
      planejado_qtd: 1.5,
      feito_qtd: 1.5,
      planejado_centavos: 15000,
      feito_centavos: 15000,
    })
  })
})

describe('statusExecucao + aplicarFeito + totais', () => {
  it('completo quando feito cobre o planejado; ignora planejado 0', () => {
    const base = montarLinhasBotox(
      [
        { musculo: 'A', quantidade_unidades: 10, procedimento_id: 'tox-1' },
        { musculo: 'B', quantidade_unidades: 0, procedimento_id: 'tox-1' },
      ],
      catalogo,
    )
    expect(statusExecucao(base)).toBe('completo')

    const parcial = [aplicarFeito(base[0]!, 4), base[1]!]
    expect(statusExecucao(parcial)).toBe('parcial')
    expect(totaisExecucao(parcial)).toEqual({
      planejado_centavos: 500,
      feito_centavos: 200,
    })
  })

  it('completo sem linhas relevantes', () => {
    expect(statusExecucao([])).toBe('completo')
    expect(statusExecucao([{ planejado_qtd: 0, feito_qtd: 0, ordem: 0 }])).toBe('completo')
  })

  it('parcial se linha do baseline foi removida deste atendimento', () => {
    const base = montarLinhasBotox(
      [
        { musculo: 'A', quantidade_unidades: 10, procedimento_id: 'tox-1', ordem: 0 },
        { musculo: 'B', quantidade_unidades: 8, procedimento_id: 'tox-1', ordem: 1 },
      ],
      catalogo,
    )
    expect(statusExecucao([base[0]!], base)).toBe('parcial')
    expect(statusExecucao(base, base)).toBe('completo')
  })

  it('extras (planejado 0) não impedem completo', () => {
    const base = montarLinhasBotox(
      [{ musculo: 'A', quantidade_unidades: 10, procedimento_id: 'tox-1', ordem: 0 }],
      catalogo,
    )
    const comExtra = [
      ...base,
      criarLinhaExtra({
        ordem: 1,
        unidade: 'U',
        procedimento_id: 'tox-1',
        preco_centavos: 50,
        feito_qtd: 2,
        rotulo: 'Extra',
      }),
    ]
    expect(statusExecucao(comExtra, base)).toBe('completo')
  })

  it('com baseline, Planejado congela ao remover linha; Feito cai', () => {
    const base = montarLinhasBotox(
      [
        { musculo: 'A', quantidade_unidades: 10, procedimento_id: 'tox-1', ordem: 0 },
        { musculo: 'B', quantidade_unidades: 8, procedimento_id: 'tox-1', ordem: 1 },
      ],
      catalogo,
    )
    const planejadoOriginal = totaisExecucao(base).planejado_centavos
    expect(planejadoOriginal).toBe(900) // 500 + 400

    const semB = [base[0]!]
    expect(totaisExecucao(semB, base)).toEqual({
      planejado_centavos: planejadoOriginal,
      feito_centavos: 500,
    })
    expect(statusExecucao(semB, base)).toBe('parcial')
  })

  it('com baseline, extra sobe Feito e mantém Planejado; completo se plano intacto', () => {
    const base = montarLinhasBotox(
      [{ musculo: 'A', quantidade_unidades: 10, procedimento_id: 'tox-1', ordem: 0 }],
      catalogo,
    )
    const comExtra = [
      ...base,
      criarLinhaExtra({
        ordem: 1,
        unidade: 'U',
        procedimento_id: 'tox-1',
        preco_centavos: 50,
        feito_qtd: 2,
        rotulo: 'Extra',
      }),
    ]
    expect(totaisExecucao(comExtra, base)).toEqual({
      planejado_centavos: 500,
      feito_centavos: 600,
    })
    expect(statusExecucao(comExtra, base)).toBe('completo')
  })

  it('sem baseline, planejado ainda soma as linhas atuais', () => {
    const base = montarLinhasBotox(
      [
        { musculo: 'A', quantidade_unidades: 10, procedimento_id: 'tox-1', ordem: 0 },
        { musculo: 'B', quantidade_unidades: 8, procedimento_id: 'tox-1', ordem: 1 },
      ],
      catalogo,
    )
    expect(totaisExecucao([base[0]!])).toEqual({
      planejado_centavos: 500,
      feito_centavos: 500,
    })
  })
})

describe('criarLinhaExtra', () => {
  it('cria linha com planejado 0 e centavos do feito', () => {
    const linha = criarLinhaExtra({
      ordem: 3,
      unidade: 'U',
      procedimento_id: 'tox-1',
      preco_centavos: 50,
      feito_qtd: 4,
      rotulo: 'Extra',
    })
    expect(linha).toMatchObject({
      ordem: 3,
      rotulo: 'Extra',
      planejado_qtd: 0,
      planejado_centavos: 0,
      feito_qtd: 4,
      feito_centavos: 200,
    })
  })
})

describe('resumoQuantidadeFeita', () => {
  it('formata U e mL e omite zeros', () => {
    expect(
      resumoQuantidadeFeita([
        { feito_qtd: 4, unidade: 'U' },
        { feito_qtd: 1, unidade: 'U' },
        { feito_qtd: 0, unidade: 'U' },
      ]),
    ).toBe('4 U + 1 U')

    expect(resumoQuantidadeFeita([{ feito_qtd: 2.5, unidade: 'ml' }])).toBe('2,5 mL')
  })
})
