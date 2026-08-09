/**
 * Leitura e normalização de cobranças para métricas de caixa.
 *
 * Usado por `/financeiro`, pelo cartão da meta na sidebar e pelo histórico
 * em Configurações → Meta. Realizado da meta = caixa recebido no mês, não
 * faturamento de catálogo.
 */

import type { StatusCobranca } from '@/domain/finance/cobranca'
import { createServerClient } from '@/lib/supabase/server'
import type { CobrancaParaMetricas, ParcelaParaMetricas } from './metricas'

/** Mesmo teto da tela Financeiro — estoque recente basta para KPIs e meta. */
export const TETO_DE_COBRANCAS = 500

type ParcelaDoBanco = {
  valor_centavos: number
  vencimento: string
  pago_em: string | null
}

type LinhaDoBanco = {
  valor_entrada_centavos: number
  valor_proxima_consulta_centavos: number
  status: StatusCobranca
  criado_em: string
  attendance_records: { realizado_em: string } | null
  payment_installments: ParcelaDoBanco[] | null
}

/** Select mínimo para `calcularKpis` / `recebidoDoMesCentavos`. */
export const SELECT_COBRANCAS_PARA_METRICAS = `
  valor_entrada_centavos,
  valor_proxima_consulta_centavos,
  status,
  criado_em,
  attendance_records(realizado_em),
  payment_installments(valor_centavos, vencimento, pago_em)
` as const

export function cobrancaParaMetricas(linha: LinhaDoBanco): CobrancaParaMetricas {
  const parcelas: ParcelaParaMetricas[] = (linha.payment_installments ?? []).map((p) => ({
    valor_centavos: p.valor_centavos,
    vencimento: p.vencimento,
    pago_em: p.pago_em,
  }))

  return {
    valor_entrada_centavos: linha.valor_entrada_centavos,
    valor_proxima_consulta_centavos: linha.valor_proxima_consulta_centavos,
    status: linha.status,
    criado_em: linha.criado_em,
    realizado_em: linha.attendance_records?.realizado_em ?? null,
    parcelas,
  }
}

/** Carrega cobranças recentes com o client autenticado (RLS). */
export async function carregarCobrancasParaMetricas(
  limite = TETO_DE_COBRANCAS,
): Promise<CobrancaParaMetricas[]> {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('patient_charges')
    .select(SELECT_COBRANCAS_PARA_METRICAS)
    .order('criado_em', { ascending: false })
    .limit(limite)

  return ((data ?? []) as unknown as LinhaDoBanco[]).map(cobrancaParaMetricas)
}
