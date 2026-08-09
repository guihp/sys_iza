/**
 * Helpers puros da galeria / resumo de atendimentos (fora de `'use server'`).
 */

import type { ExecucaoStatusLista, ResumoCobrancaLista } from './atendimento-tipos'

export const ROTULO_STATUS_COBRANCA: Record<
  NonNullable<ResumoCobrancaLista>['status'],
  string
> = {
  em_aberto: 'em aberto',
  parcial: 'parcial',
  quitado: 'quitado',
}

export function rotuloStatusExecucao(status: ExecucaoStatusLista): string | null {
  if (status === 'completo') return 'Execução completa'
  if (status === 'parcial') return 'Execução parcial'
  return null
}

/** Texto curto de pagamento para card da galeria. */
export function textoResumoCobranca(
  cobranca: ResumoCobrancaLista,
  formatarMoeda: (centavos: number) => string,
): string | null {
  if (!cobranca) return null
  return `Entrada ${formatarMoeda(cobranca.valor_entrada_centavos)} de ${formatarMoeda(cobranca.valor_total_centavos)} · ${ROTULO_STATUS_COBRANCA[cobranca.status]}`
}

/**
 * Baseline de execução a partir das linhas já gravadas.
 * Linhas com `planejado_qtd > 0` entram no snapshot (extras têm 0).
 */
export function baselineDasLinhasSalvas(
  itens: ReadonlyArray<{
    ordem: number
    planejado_qtd: number
    planejado_centavos: number
  }>,
): Array<{ ordem: number; planejado_qtd: number; planejado_centavos: number }> {
  return itens
    .filter((i) => i.planejado_qtd > 0)
    .map((i) => ({
      ordem: i.ordem,
      planejado_qtd: i.planejado_qtd,
      planejado_centavos: i.planejado_centavos,
    }))
}

/** Extra neste atendimento = planejado 0 (não veio do plano). */
export function linhaSalvaEhDoPlano(planejadoQtd: number): boolean {
  return planejadoQtd > 0
}
