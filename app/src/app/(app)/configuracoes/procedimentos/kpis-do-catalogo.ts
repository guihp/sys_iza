/**
 * KPIs do cabeçalho de Procedimentos.
 *
 * Funções puras: recebem o catálogo ativo e devolvem os três números do mockup.
 * Sem banco, sem React — a página monta o `<Kpi>` em cima do resultado.
 *
 * Banco vazio → `0`, `—`, `0`. Nunca `NaN`.
 */

export type ProcedimentoParaKpi = {
  preco_centavos: number
  default_return_interval_days: number | null
}

export type KpisDoCatalogo = {
  /** Procedimentos ativos listados. */
  ativos: number
  /**
   * Média aritmética dos preços padrão, em centavos.
   * `null` quando o catálogo está vazio — média de zero termos não existe.
   */
  ticketMedioCentavos: number | null
  /** Quantos têm `default_return_interval_days` preenchido. */
  geramRetorno: number
}

/**
 * Os três KPIs do catálogo clínico.
 *
 * Ticket médio inclui cortesia (preço 0): o "preço padrão" do catálogo é a
 * média de tudo que está ativo, não só do que cobra.
 */
export function kpisDoCatalogo(
  procedimentos: readonly ProcedimentoParaKpi[],
): KpisDoCatalogo {
  const ativos = procedimentos.length
  if (ativos === 0) {
    return { ativos: 0, ticketMedioCentavos: null, geramRetorno: 0 }
  }

  let soma = 0
  let geramRetorno = 0
  for (const procedimento of procedimentos) {
    soma += procedimento.preco_centavos
    if (procedimento.default_return_interval_days != null) geramRetorno += 1
  }

  return {
    ativos,
    ticketMedioCentavos: Math.round(soma / ativos),
    geramRetorno,
  }
}

/**
 * Centavos → leitura de relance do KPI: `R$ 2.6k`, `R$ 850`, `—`.
 *
 * Acima de mil reais o mockup abrevia com `k` e uma casa decimal (ponto, como
 * no print). Abaixo, valor inteiro em reais. Catálogo vazio → travessão.
 */
export function formatarTicketMedio(centavos: number | null): string {
  if (centavos === null) return '—'
  const reais = centavos / 100
  if (!Number.isFinite(reais)) return '—'
  if (reais >= 1000) {
    const milhares = reais / 1000
    const texto =
      Number.isInteger(milhares) || milhares >= 10
        ? milhares.toFixed(0)
        : milhares.toFixed(1)
    return `R$ ${texto}k`
  }
  return `R$ ${Math.round(reais)}`
}
