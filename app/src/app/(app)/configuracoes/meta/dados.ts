/**
 * Leitura da meta e do histórico — fora de `'use server'`.
 *
 * A action só grava; a página e a casca precisam ler sem virar action
 * exportada à toa (regra do Next: arquivo `'use server'` só exporta async).
 */

import {
  listarMesesDoHistorico,
  MESES_DO_HISTORICO,
  montarHistoricoDaMeta,
  type LinhaDoHistoricoDaMeta,
} from '@/app/(app)/configuracoes/meta/historico'
import { carregarCobrancasParaMetricas } from '@/app/(app)/financeiro/cobrancas'
import { agruparRecebidoPorMes } from '@/app/(app)/financeiro/metricas'
import { carregarMetaGlobalCentavos, carregarMetaDoMesCentavos } from '@/lib/clinic-settings'
import { dataDaClinica } from '@/lib/datetime'
import { anoMesDeData } from '@/lib/meta'
import { createServerClient } from '@/lib/supabase/server'

export type DadosDaPaginaDaMeta = {
  mesAtual: string
  metaCentavos: number
  historico: LinhaDoHistoricoDaMeta[]
}

/**
 * Meta do mês corrente (linha ou fallback) + histórico dos últimos 12 meses
 * com o mesmo realizado do cartão da sidebar (caixa recebido no mês).
 */
export async function carregarDadosDaPaginaDaMeta(): Promise<DadosDaPaginaDaMeta> {
  const hojeISO = dataDaClinica(new Date())
  const mesAtual = anoMesDeData(hojeISO)
  const meses = listarMesesDoHistorico(mesAtual, MESES_DO_HISTORICO)

  const supabase = await createServerClient()

  const [metaCentavos, fallbackGlobal, metasRows, cobrancas] = await Promise.all([
    carregarMetaDoMesCentavos(mesAtual),
    carregarMetaGlobalCentavos(),
    supabase
      .from('clinic_meta_mensal')
      .select('ano_mes, meta_centavos')
      .in('ano_mes', [...meses]),
    carregarCobrancasParaMetricas(),
  ])

  const metasPorMes = new Map<string, number>()
  for (const linha of metasRows.data ?? []) {
    if (linha.ano_mes != null && linha.meta_centavos != null) {
      metasPorMes.set(linha.ano_mes, linha.meta_centavos)
    }
  }

  // Realizado = caixa recebido no mês, não faturamento de catálogo.
  const realizadoPorMes = agruparRecebidoPorMes(cobrancas, hojeISO, meses)

  return {
    mesAtual,
    metaCentavos,
    historico: montarHistoricoDaMeta({
      meses,
      metasPorMes,
      realizadoPorMes,
      mesAtual,
      fallbackMetaCentavos: fallbackGlobal,
    }),
  }
}
