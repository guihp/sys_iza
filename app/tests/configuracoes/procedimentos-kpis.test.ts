import { describe, expect, it } from 'vitest'
import {
  formatarTicketMedio,
  kpisDoCatalogo,
} from '@/app/(app)/configuracoes/procedimentos/kpis-do-catalogo'

describe('kpisDoCatalogo', () => {
  it('banco vazio → 0, null, 0 — nunca NaN', () => {
    const kpis = kpisDoCatalogo([])
    expect(kpis).toEqual({ ativos: 0, ticketMedioCentavos: null, geramRetorno: 0 })
  })

  it('conta ativos e quem gera retorno', () => {
    const kpis = kpisDoCatalogo([
      { preco_centavos: 180000, default_return_interval_days: 120 },
      { preco_centavos: 250000, default_return_interval_days: 365 },
      { preco_centavos: 0, default_return_interval_days: null },
    ])
    expect(kpis.ativos).toBe(3)
    expect(kpis.geramRetorno).toBe(2)
    // (1800 + 2500 + 0) / 3 = 1433,33… → 143333 centavos
    expect(kpis.ticketMedioCentavos).toBe(143333)
  })

  it('inclui cortesia (preço 0) na média — preço padrão do catálogo inteiro', () => {
    const kpis = kpisDoCatalogo([
      { preco_centavos: 200000, default_return_interval_days: 90 },
      { preco_centavos: 0, default_return_interval_days: null },
    ])
    expect(kpis.ticketMedioCentavos).toBe(100000)
  })
})

describe('formatarTicketMedio', () => {
  it('abreviado com k acima de mil reais', () => {
    expect(formatarTicketMedio(260000)).toBe('R$ 2.6k')
    expect(formatarTicketMedio(180000)).toBe('R$ 1.8k')
    expect(formatarTicketMedio(1000000)).toBe('R$ 10k')
  })

  it('abaixo de mil reais mostra o valor inteiro', () => {
    expect(formatarTicketMedio(85000)).toBe('R$ 850')
    expect(formatarTicketMedio(0)).toBe('R$ 0')
  })

  it('catálogo vazio → travessão', () => {
    expect(formatarTicketMedio(null)).toBe('—')
  })
})
