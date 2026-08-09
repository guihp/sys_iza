import { describe, expect, it } from 'vitest'
import {
  deslocarAnoMes,
  listarMesesDoHistorico,
  montarHistoricoDaMeta,
} from '@/app/(app)/configuracoes/meta/historico'
import {
  nomeDoMes,
  nomeDoMesComAno,
  percentualDaMeta,
  statusDaMeta,
} from '@/lib/meta'
import {
  agruparRecebidoPorMes,
  type CobrancaParaMetricas,
} from '@/app/(app)/financeiro/metricas'

describe('statusDaMeta', () => {
  it('classifica abaixo / igual / acima em mês fechado', () => {
    expect(statusDaMeta(900_000, 1_000_000)).toBe('nao_atingiu')
    expect(statusDaMeta(1_000_000, 1_000_000)).toBe('atingiu')
    expect(statusDaMeta(1_100_000, 1_000_000)).toBe('ultrapassou')
  })

  it('no mês em curso abaixo da meta vira em progresso', () => {
    expect(statusDaMeta(900_000, 1_000_000, { mesEmCurso: true })).toBe('em_progresso')
    expect(statusDaMeta(0, 1_000_000, { mesEmCurso: true })).toBe('em_progresso')
  })

  it('no mês em curso ainda mostra atingiu / ultrapassou', () => {
    expect(statusDaMeta(1_000_000, 1_000_000, { mesEmCurso: true })).toBe('atingiu')
    expect(statusDaMeta(1_100_000, 1_000_000, { mesEmCurso: true })).toBe('ultrapassou')
  })

  it('com meta zero ou inválida cai em não atingiu', () => {
    expect(statusDaMeta(500_000, 0)).toBe('nao_atingiu')
    expect(statusDaMeta(500_000, -1)).toBe('nao_atingiu')
    expect(statusDaMeta(500_000, 0, { mesEmCurso: true })).toBe('nao_atingiu')
  })
})

describe('percentualDaMeta', () => {
  it('arredonda o percentual e tolera meta zero', () => {
    expect(percentualDaMeta(500_000, 1_000_000)).toBe(50)
    expect(percentualDaMeta(1_000_000, 0)).toBe(0)
    expect(percentualDaMeta(2_000_000, 1_000_000)).toBe(200)
  })
})

describe('nomeDoMes', () => {
  it('escreve o mês em português', () => {
    expect(nomeDoMes('2026-08')).toBe('agosto')
    expect(nomeDoMesComAno('2026-08')).toBe('agosto de 2026')
  })
})

describe('deslocarAnoMes / listarMesesDoHistorico', () => {
  it('volta meses e atravessa o ano', () => {
    expect(deslocarAnoMes('2026-01', -1)).toBe('2025-12')
    expect(deslocarAnoMes('2026-08', 0)).toBe('2026-08')
  })

  it('lista do mais recente ao mais antigo', () => {
    expect(listarMesesDoHistorico('2026-08', 3)).toEqual(['2026-08', '2026-07', '2026-06'])
  })
})

function cobranca(parcial: Partial<CobrancaParaMetricas> & Pick<CobrancaParaMetricas, 'criado_em'>): CobrancaParaMetricas {
  return {
    valor_entrada_centavos: 0,
    valor_proxima_consulta_centavos: 0,
    status: 'em_aberto',
    realizado_em: null,
    parcelas: [],
    ...parcial,
  }
}

describe('agruparRecebidoPorMes (realizado da meta)', () => {
  it('soma entrada + parcela paga no mês; ignora parcela futura e próxima', () => {
    const mapa = agruparRecebidoPorMes(
      [
        cobranca({
          criado_em: '2026-07-01T12:00:00.000Z',
          realizado_em: '2026-08-01T15:00:00.000Z',
          valor_entrada_centavos: 100_000,
          valor_proxima_consulta_centavos: 50_000,
          status: 'parcial',
          parcelas: [
            { valor_centavos: 50_000, vencimento: '2026-08-10', pago_em: '2026-08-10T18:00:00.000Z' },
            { valor_centavos: 50_000, vencimento: '2026-09-10', pago_em: null },
          ],
        }),
        cobranca({
          criado_em: '2026-07-15T12:00:00.000Z',
          realizado_em: '2026-07-15T15:00:00.000Z',
          valor_entrada_centavos: 200_000,
          status: 'quitado',
        }),
      ],
      '2026-08-15',
      ['2026-08', '2026-07'],
    )
    expect(mapa.get('2026-08')).toBe(150_000)
    expect(mapa.get('2026-07')).toBe(200_000)
  })
})

describe('montarHistoricoDaMeta', () => {
  it('usa fallback só no mês atual e classifica status (em progresso no atual)', () => {
    const linhas = montarHistoricoDaMeta({
      meses: ['2026-08', '2026-07', '2026-06'],
      metasPorMes: new Map([['2026-07', 1_000_000]]),
      realizadoPorMes: new Map([
        ['2026-08', 400_000],
        ['2026-07', 1_200_000],
        ['2026-06', 50_000],
      ]),
      mesAtual: '2026-08',
      fallbackMetaCentavos: 900_000,
    })

    expect(linhas[0]).toMatchObject({
      anoMes: '2026-08',
      metaCentavos: 900_000,
      realizadoCentavos: 400_000,
      status: 'em_progresso',
      atual: true,
    })
    expect(linhas[1]).toMatchObject({
      anoMes: '2026-07',
      metaCentavos: 1_000_000,
      status: 'ultrapassou',
      percentual: 120,
      atual: false,
    })
    expect(linhas[2]).toMatchObject({
      anoMes: '2026-06',
      metaCentavos: null,
      status: null,
      realizadoCentavos: 50_000,
    })
  })

  it('mês atual que bateu a meta mostra atingiu, não em progresso', () => {
    const [linha] = montarHistoricoDaMeta({
      meses: ['2026-08'],
      metasPorMes: new Map([['2026-08', 500_000]]),
      realizadoPorMes: new Map([['2026-08', 500_000]]),
      mesAtual: '2026-08',
      fallbackMetaCentavos: 500_000,
    })
    expect(linha?.status).toBe('atingiu')
  })
})
