import { describe, expect, it } from 'vitest'
import {
  META_MENSAL_CENTAVOS,
  descreverProgresso,
  formatarValorRedondo,
  progressoDaMeta,
} from '@/lib/meta'

describe('progressoDaMeta', () => {
  it('com o banco vazio dá R$ 0 e barra zerada — não NaN, não erro', () => {
    const progresso = progressoDaMeta(0, '2026-08-06')
    expect(progresso.realizadoCentavos).toBe(0)
    expect(progresso.percentualDaBarra).toBe(0)
    expect(progresso.percentualAlcancado).toBe(0)
    expect(Number.isNaN(progresso.percentualDaBarra)).toBe(false)
  })

  it('calcula o percentual sobre a meta declarada', () => {
    const progresso = progressoDaMeta(META_MENSAL_CENTAVOS / 2, '2026-08-06')
    expect(progresso.percentualDaBarra).toBe(50)
    expect(progresso.percentualAlcancado).toBe(50)
  })

  it('deixa o texto passar de 100% mas trava a barra em 100', () => {
    const progresso = progressoDaMeta(META_MENSAL_CENTAVOS * 2, '2026-08-06')
    expect(progresso.percentualAlcancado).toBe(200)
    expect(progresso.percentualDaBarra).toBe(100)
  })

  it('conta os dias restantes incluindo hoje', () => {
    // Agosto tem 31 dias: no dia 6 faltam 26, contando o próprio dia 6.
    expect(progressoDaMeta(0, '2026-08-06').diasRestantes).toBe(26)
    // No último dia ainda dá para atender: "1 dia restante", não zero.
    expect(progressoDaMeta(0, '2026-08-31').diasRestantes).toBe(1)
  })

  it('acerta fevereiro, inclusive bissexto', () => {
    expect(progressoDaMeta(0, '2026-02-01').diasRestantes).toBe(28)
    expect(progressoDaMeta(0, '2028-02-01').diasRestantes).toBe(29)
  })
})

describe('descreverProgresso', () => {
  it('escreve a linha do cartão', () => {
    expect(descreverProgresso(progressoDaMeta(0, '2026-08-06'))).toBe(
      '0% alcançado · 26 dias restantes',
    )
  })

  it('usa singular no último dia do mês', () => {
    expect(descreverProgresso(progressoDaMeta(0, '2026-08-31'))).toBe(
      '0% alcançado · 1 dia restante',
    )
  })
})

describe('formatarValorRedondo', () => {
  // O `Intl.NumberFormat('pt-BR')` separa o `R$` do número com espaço NÃO
  // SEPARÁVEL (U+00A0), não com espaço comum — é o certo tipograficamente, e é
  // invisível na tela. Escrito explícito aqui porque o literal com espaço comum
  // falha com as duas strings parecendo idênticas no relatório do vitest.
  const ESPACO = ' '

  it('mostra o valor sem centavos, para leitura de relance', () => {
    expect(formatarValorRedondo(0)).toBe(`R$${ESPACO}0`)
    expect(formatarValorRedondo(1_245_000)).toBe(`R$${ESPACO}12.450`)
  })
})
