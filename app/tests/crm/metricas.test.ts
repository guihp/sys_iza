import { describe, expect, it } from 'vitest'
import {
  contarLeadsAtivos,
  contarNovosNaSemana,
  formatarConversao,
  formatarTicketMedio,
  montarKpisDoFunil,
  textoPotencialDaColuna,
  textoPrecoDoCartao,
} from '@/app/(app)/crm/metricas'

describe('contarLeadsAtivos', () => {
  it('ignora paciente e descartado', () => {
    expect(
      contarLeadsAtivos([
        { stage: 'lead' },
        { stage: 'contato' },
        { stage: 'paciente' },
        { stage: 'descartado' },
      ]),
    ).toBe(2)
  })
})

describe('contarNovosNaSemana', () => {
  it('conta cadastros entre hoje e 6 dias atrás no calendário da clínica', () => {
    // Hoje clínica 2026-08-06 — janela 2026-07-31 … 2026-08-06.
    expect(
      contarNovosNaSemana(
        [
          { stage: 'lead', criado_em: '2026-08-06T15:00:00.000Z' },
          { stage: 'lead', criado_em: '2026-07-31T15:00:00.000Z' },
          { stage: 'lead', criado_em: '2026-07-30T15:00:00.000Z' },
          { stage: 'lead', criado_em: null },
        ],
        '2026-08-06',
      ),
    ).toBe(2)
  })
})

describe('formatarConversao', () => {
  it('devolve — sem base', () => {
    expect(formatarConversao([])).toBe('—')
    expect(formatarConversao([{ stage: 'descartado' }])).toBe('—')
  })

  it('ignora descartado no denominador', () => {
    expect(
      formatarConversao([
        { stage: 'paciente' },
        { stage: 'paciente' },
        { stage: 'lead' },
        { stage: 'descartado' },
      ]),
    ).toBe('67%')
  })
})

describe('formatarTicketMedio', () => {
  it('formata milhares no estilo do mockup', () => {
    expect(formatarTicketMedio(null)).toBe('—')
    expect(formatarTicketMedio(0)).toBe('R$ 0')
    expect(formatarTicketMedio(390_000)).toBe('R$ 3,9k')
    expect(formatarTicketMedio(12_000_000)).toBe('R$ 120k')
  })
})

describe('potencial e preço do cartão', () => {
  it('potencial da coluna soma valores positivos', () => {
    expect(textoPotencialDaColuna([null, 0, undefined])).toBe('—')
    expect(textoPotencialDaColuna([420_000, 180_000])).toBe('R$ 6.000 em potencial')
  })

  it('preço do cartão usa A definir sem valor', () => {
    expect(textoPrecoDoCartao(null)).toBe('A definir')
    expect(textoPrecoDoCartao(0)).toBe('A definir')
    expect(textoPrecoDoCartao(240_000)).toBe('R$ 2.400')
  })
})

describe('montarKpisDoFunil', () => {
  it('monta o pacote completo', () => {
    const kpis = montarKpisDoFunil(
      [
        { stage: 'lead', criado_em: '2026-08-05T12:00:00.000Z' },
        { stage: 'paciente', criado_em: '2026-07-01T12:00:00.000Z' },
      ],
      '2026-08-06',
      390_000,
    )
    expect(kpis).toEqual({
      leadsAtivos: 1,
      novosNaSemana: 1,
      conversao: '50%',
      ticketMedio: 'R$ 3,9k',
    })
  })
})
