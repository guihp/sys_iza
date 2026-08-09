import { describe, expect, it } from 'vitest'
import {
  agruparRecebidoPorMes,
  calcularKpis,
  cobrancaNoPeriodo,
  composicaoRecebidoNoPeriodo,
  contarPorFiltro,
  dataDaEntrada,
  dataRecebimentoParcela,
  deslocarMes,
  filtrarCobrancas,
  filtroDaUrl,
  periodoDaUrl,
  periodoDoMes,
  proximaParcelaAberta,
  recebidoDoMesCentavos,
  resumoParcelas,
  serieRecebidoPorDia,
  serieStatusResumo,
  serieTemValor,
  type CobrancaParaMetricas,
  type PeriodoFinanceiro,
} from '@/app/(app)/financeiro/metricas'
import {
  formatarMoeda,
  formatarMoedaRedonda,
  rotuloMes,
  rotuloStatusCobranca,
  sublegendaDoPeriodo,
} from '@/app/(app)/financeiro/formatacao'

const HOJE = '2026-08-09'

function cobranca(parcial: Partial<CobrancaParaMetricas> = {}): CobrancaParaMetricas {
  return {
    valor_entrada_centavos: 0,
    valor_proxima_consulta_centavos: 0,
    status: 'em_aberto',
    criado_em: '2026-08-05T15:00:00.000Z',
    realizado_em: null,
    parcelas: [],
    ...parcial,
  }
}

function mesAgosto(): PeriodoFinanceiro {
  return periodoDoMes('2026-08')
}

describe('periodoDaUrl + deslocarMes', () => {
  it('default e mes resolvem o mês civil de hoje', () => {
    expect(periodoDaUrl(undefined, HOJE)).toMatchObject({
      inicio: '2026-08-01',
      fim: '2026-08-31',
      chave: 'mes',
      modo: 'mes',
    })
    expect(periodoDaUrl('mes', HOJE).modo).toBe('mes')
  })

  it('semana vai de segunda a domingo', () => {
    // 2026-08-09 é domingo → semana começa em 03/08.
    expect(periodoDaUrl('semana', HOJE)).toEqual({
      inicio: '2026-08-03',
      fim: '2026-08-09',
      chave: 'semana',
      modo: 'semana',
    })
  })

  it('YYYY-MM escolhe o mês; o corrente vira modo mes', () => {
    expect(periodoDaUrl('2026-07', HOJE)).toMatchObject({
      inicio: '2026-07-01',
      fim: '2026-07-31',
      chave: '2026-07',
      modo: 'mes_escolhido',
    })
    expect(periodoDaUrl('2026-08', HOJE).modo).toBe('mes')
  })

  it('desloca mês atravessando ano', () => {
    expect(deslocarMes('2026-01', -1)).toBe('2025-12')
    expect(deslocarMes('2025-12', 1)).toBe('2026-01')
  })
})

describe('filtroDaUrl', () => {
  it('aceita filtros conhecidos e cai em todos', () => {
    expect(filtroDaUrl('a_receber')).toBe('a_receber')
    expect(filtroDaUrl('recebido')).toBe('recebido')
    expect(filtroDaUrl('atrasadas')).toBe('atrasadas')
    expect(filtroDaUrl('quitadas')).toBe('quitadas')
    expect(filtroDaUrl('xyz')).toBe('todos')
    expect(filtroDaUrl(undefined)).toBe('todos')
  })
})

describe('calcularKpis', () => {
  it('soma a receber: próxima + parcelas não pagas', () => {
    const kpis = calcularKpis(
      [
        cobranca({
          status: 'parcial',
          valor_entrada_centavos: 3000,
          valor_proxima_consulta_centavos: 2000,
          parcelas: [
            { valor_centavos: 2500, vencimento: '2026-09-01', pago_em: null },
            { valor_centavos: 2500, vencimento: '2026-10-01', pago_em: null },
          ],
        }),
      ],
      HOJE,
      mesAgosto(),
    )
    expect(kpis.aReceberCentavos).toBe(7000)
    expect(kpis.atrasadasCentavos).toBe(0)
  })

  it('conta atrasadas pelo vencimento, não pelo status gravado', () => {
    const kpis = calcularKpis(
      [
        cobranca({
          status: 'parcial',
          parcelas: [
            { valor_centavos: 1000, vencimento: '2026-07-01', pago_em: null },
            { valor_centavos: 1000, vencimento: '2026-09-01', pago_em: null },
          ],
        }),
      ],
      HOJE,
      mesAgosto(),
    )
    expect(kpis.atrasadasCentavos).toBe(1000)
    expect(kpis.aReceberCentavos).toBe(2000)
    // Atrasada não entra de novo em "recebido" do período.
    expect(kpis.recebidoNoPeriodoCentavos).toBe(0)
  })

  it('recebido no período: entrada por realizado_em + parcela paga no período', () => {
    const kpis = calcularKpis(
      [
        cobranca({
          realizado_em: '2026-08-02T15:00:00.000Z',
          criado_em: '2026-07-01T12:00:00.000Z',
          valor_entrada_centavos: 5000,
          status: 'parcial',
          parcelas: [
            {
              valor_centavos: 2000,
              vencimento: '2026-08-01',
              pago_em: '2026-08-03T18:00:00.000Z',
            },
            {
              valor_centavos: 2000,
              vencimento: '2026-09-01',
              pago_em: null,
            },
          ],
        }),
        cobranca({
          realizado_em: '2026-07-20T12:00:00.000Z',
          criado_em: '2026-07-20T12:00:00.000Z',
          valor_entrada_centavos: 9000,
          status: 'quitado',
          parcelas: [],
        }),
      ],
      HOJE,
      mesAgosto(),
    )
    expect(kpis.recebidoNoPeriodoCentavos).toBe(7000)
  })

  it('parcela que vence hoje sem baixa conta como recebida no período (cartão)', () => {
    const kpis = calcularKpis(
      [
        cobranca({
          status: 'parcial',
          parcelas: [{ valor_centavos: 1500, vencimento: HOJE, pago_em: null }],
        }),
      ],
      HOJE,
      mesAgosto(),
    )
    expect(kpis.recebidoNoPeriodoCentavos).toBe(1500)
    expect(kpis.aReceberCentavos).toBe(0)
    expect(kpis.atrasadasCentavos).toBe(0)
  })

  it('recebido respeita a janela da semana', () => {
    const semana = periodoDaUrl('semana', HOJE)
    const kpis = calcularKpis(
      [
        cobranca({
          realizado_em: '2026-08-04T15:00:00.000Z',
          valor_entrada_centavos: 1000,
          status: 'parcial',
        }),
        cobranca({
          realizado_em: '2026-07-28T15:00:00.000Z',
          valor_entrada_centavos: 5000,
          status: 'parcial',
        }),
      ],
      HOJE,
      semana,
    )
    expect(kpis.recebidoNoPeriodoCentavos).toBe(1000)
  })

  it('quitado não soma valor_proxima em a receber', () => {
    const kpis = calcularKpis(
      [
        cobranca({
          status: 'quitado',
          valor_proxima_consulta_centavos: 0,
          parcelas: [
            {
              valor_centavos: 1000,
              vencimento: '2026-07-01',
              pago_em: '2026-07-02T12:00:00.000Z',
            },
          ],
        }),
      ],
      HOJE,
      mesAgosto(),
    )
    expect(kpis.aReceberCentavos).toBe(0)
  })
})

describe('dataDaEntrada + dataRecebimentoParcela', () => {
  it('prefere realizado_em para a entrada', () => {
    expect(
      dataDaEntrada(
        cobranca({
          realizado_em: '2026-08-02T18:00:00.000Z',
          criado_em: '2026-07-01T12:00:00.000Z',
        }),
      ),
    ).toBe('2026-08-02')
  })

  it('parcela paga usa pago_em; sem baixa usa vencimento se ≤ hoje', () => {
    expect(
      dataRecebimentoParcela(
        { valor_centavos: 1, vencimento: '2026-08-01', pago_em: '2026-08-05T12:00:00.000Z' },
        HOJE,
      ),
    ).toBe('2026-08-05')
    expect(
      dataRecebimentoParcela(
        { valor_centavos: 1, vencimento: '2026-08-01', pago_em: null },
        HOJE,
      ),
    ).toBe('2026-08-01')
    expect(
      dataRecebimentoParcela(
        { valor_centavos: 1, vencimento: '2026-09-01', pago_em: null },
        HOJE,
      ),
    ).toBeNull()
  })
})

describe('filtrarCobrancas + cobrancaNoPeriodo', () => {
  const base: CobrancaParaMetricas[] = [
    cobranca({
      status: 'parcial',
      realizado_em: '2026-08-05T12:00:00.000Z',
      valor_entrada_centavos: 1000,
      valor_proxima_consulta_centavos: 500,
      parcelas: [{ valor_centavos: 2000, vencimento: '2026-09-01', pago_em: null }],
    }),
    cobranca({
      status: 'parcial',
      realizado_em: '2026-07-10T12:00:00.000Z',
      valor_entrada_centavos: 800,
      parcelas: [{ valor_centavos: 900, vencimento: '2026-07-01', pago_em: null }],
    }),
    cobranca({
      status: 'quitado',
      realizado_em: '2026-08-01T12:00:00.000Z',
      valor_entrada_centavos: 3000,
      parcelas: [
        {
          valor_centavos: 1000,
          vencimento: '2026-07-01',
          pago_em: '2026-07-02T12:00:00.000Z',
        },
      ],
    }),
  ]

  it('recorta cobranças que tocam o período', () => {
    expect(cobrancaNoPeriodo(base[0]!, mesAgosto(), HOJE)).toBe(true)
    expect(cobrancaNoPeriodo(base[1]!, mesAgosto(), HOJE)).toBe(true) // próxima/atrasada viva
    expect(
      cobrancaNoPeriodo(
        cobranca({
          status: 'quitado',
          realizado_em: '2026-06-01T12:00:00.000Z',
          valor_entrada_centavos: 1,
          parcelas: [],
        }),
        mesAgosto(),
        HOJE,
      ),
    ).toBe(false)
  })

  it('filtra a_receber, recebido, atrasadas e quitadas', () => {
    expect(filtrarCobrancas(base, 'a_receber', mesAgosto(), HOJE)).toHaveLength(2)
    expect(filtrarCobrancas(base, 'recebido', mesAgosto(), HOJE).length).toBeGreaterThanOrEqual(2)
    expect(filtrarCobrancas(base, 'atrasadas', mesAgosto(), HOJE)).toHaveLength(1)
    expect(filtrarCobrancas(base, 'quitadas', mesAgosto(), HOJE)).toHaveLength(1)
  })

  it('conta chips por filtro', () => {
    const contagens = contarPorFiltro(base, mesAgosto(), HOJE)
    expect(contagens.atrasadas).toBe(1)
    expect(contagens.quitadas).toBe(1)
    expect(contagens.todos).toBeGreaterThanOrEqual(2)
  })
})

describe('resumoParcelas + proximaParcelaAberta', () => {
  it('resume pagas e aponta a próxima em aberto', () => {
    const parcelas = [
      {
        id: 'a',
        numero: 1,
        valor_centavos: 1000,
        vencimento: '2026-07-01',
        pago_em: '2026-07-02T12:00:00.000Z',
      },
      {
        id: 'b',
        numero: 2,
        valor_centavos: 1000,
        vencimento: '2026-08-01',
        pago_em: null,
      },
      {
        id: 'c',
        numero: 3,
        valor_centavos: 1000,
        vencimento: '2026-09-01',
        pago_em: null,
      },
    ]
    expect(resumoParcelas(parcelas, HOJE)).toEqual({
      pagas: 1,
      total: 3,
      atrasadas: 1,
      pendentes: 1,
    })
    expect(proximaParcelaAberta(parcelas, HOJE)?.id).toBe('b')
  })
})

describe('serieRecebidoPorDia + serieStatusResumo', () => {
  it('monta um ponto por dia e soma igual ao KPI recebido', () => {
    const cobrancas = [
      cobranca({
        realizado_em: '2026-08-04T15:00:00.000Z',
        valor_entrada_centavos: 5000,
        status: 'parcial',
        parcelas: [
          {
            valor_centavos: 2000,
            vencimento: '2026-08-06',
            pago_em: '2026-08-06T18:00:00.000Z',
          },
          {
            valor_centavos: 2000,
            vencimento: '2026-09-01',
            pago_em: null,
          },
        ],
      }),
      cobranca({
        realizado_em: '2026-07-20T12:00:00.000Z',
        valor_entrada_centavos: 9000,
        status: 'quitado',
        parcelas: [],
      }),
    ]
    const periodo = mesAgosto()
    const serie = serieRecebidoPorDia(cobrancas, HOJE, periodo)
    expect(serie).toHaveLength(31)
    expect(serie[0]?.rotulo).toBe('1')
    expect(serie.find((p) => p.data === '2026-08-04')).toMatchObject({
      entradaCentavos: 5000,
      parcelasCentavos: 0,
      totalCentavos: 5000,
    })
    expect(serie.find((p) => p.data === '2026-08-06')).toMatchObject({
      entradaCentavos: 0,
      parcelasCentavos: 2000,
      totalCentavos: 2000,
    })

    const composicao = composicaoRecebidoNoPeriodo(serie)
    expect(composicao.totalCentavos).toBe(7000)
    expect(composicao.entradaCentavos).toBe(5000)
    expect(composicao.parcelasCentavos).toBe(2000)
    expect(calcularKpis(cobrancas, HOJE, periodo).recebidoNoPeriodoCentavos).toBe(
      composicao.totalCentavos,
    )
  })

  it('na semana usa rótulos curtos de dia e respeita a janela', () => {
    const semana = periodoDaUrl('semana', HOJE)
    const serie = serieRecebidoPorDia(
      [
        cobranca({
          realizado_em: '2026-08-04T15:00:00.000Z',
          valor_entrada_centavos: 1000,
          status: 'parcial',
        }),
        cobranca({
          realizado_em: '2026-07-28T15:00:00.000Z',
          valor_entrada_centavos: 5000,
          status: 'parcial',
        }),
      ],
      HOJE,
      semana,
    )
    expect(serie).toHaveLength(7)
    expect(serie.map((p) => p.rotulo)).toEqual(['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'])
    expect(serieTemValor(serie)).toBe(true)
    expect(composicaoRecebidoNoPeriodo(serie).totalCentavos).toBe(1000)
  })

  it('serieStatusResumo espelha os KPIs e serieTemValor detecta zero', () => {
    const kpis = {
      recebidoNoPeriodoCentavos: 3000,
      aReceberCentavos: 1500,
      atrasadasCentavos: 500,
    }
    expect(serieStatusResumo(kpis)).toEqual([
      { id: 'recebido', rotulo: 'Recebido', valorCentavos: 3000 },
      { id: 'a_receber', rotulo: 'A receber', valorCentavos: 1500 },
      { id: 'atrasadas', rotulo: 'Atrasadas', valorCentavos: 500 },
    ])
    expect(serieTemValor(serieStatusResumo(kpis))).toBe(true)
    expect(
      serieTemValor(
        serieStatusResumo({
          recebidoNoPeriodoCentavos: 0,
          aReceberCentavos: 0,
          atrasadasCentavos: 0,
        }),
      ),
    ).toBe(false)
  })
})

describe('formatacao', () => {
  it('formata moeda, rótulos e período', () => {
    expect(formatarMoeda(17996)).toBe('R$ 179,96')
    expect(formatarMoedaRedonda(18000)).toBe('R$ 180')
    expect(rotuloStatusCobranca('em_aberto')).toBe('Em aberto')
    expect(rotuloStatusCobranca('quitado')).toBe('Quitado')
    expect(rotuloMes('2026-08')).toMatch(/agosto.*2026/i)
    expect(sublegendaDoPeriodo(periodoDaUrl('semana', HOJE))).toBe('nesta semana')
    expect(sublegendaDoPeriodo(periodoDaUrl('mes', HOJE))).toBe('neste mês')
  })
})

describe('recebidoDoMesCentavos / agruparRecebidoPorMes', () => {
  it('espelha o KPI recebido do mês (meta = caixa, não catálogo)', () => {
    const cobrancas = [
      cobranca({
        realizado_em: '2026-08-02T15:00:00.000Z',
        criado_em: '2026-07-01T12:00:00.000Z',
        valor_entrada_centavos: 5000,
        status: 'parcial',
        parcelas: [
          {
            valor_centavos: 2000,
            vencimento: '2026-08-01',
            pago_em: '2026-08-03T18:00:00.000Z',
          },
          {
            valor_centavos: 2000,
            vencimento: '2026-09-01',
            pago_em: null,
          },
        ],
      }),
    ]
    expect(recebidoDoMesCentavos(cobrancas, HOJE, '2026-08')).toBe(7000)
    expect(calcularKpis(cobrancas, HOJE, mesAgosto()).recebidoNoPeriodoCentavos).toBe(7000)

    const mapa = agruparRecebidoPorMes(cobrancas, HOJE, ['2026-08', '2026-09'])
    expect(mapa.get('2026-08')).toBe(7000)
    expect(mapa.get('2026-09')).toBe(0)
  })
})
