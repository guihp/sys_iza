/**
 * Histórico de metas mensais — funções puras.
 *
 * Junta a lista de meses, a meta gravada (ou fallback do mês corrente) e o
 * realizado (caixa recebido no mês — mesma regra do cartão da sidebar e do
 * KPI "Recebido" em `/financeiro`). Sem I/O: a página carrega os dados e
 * monta aqui.
 */

import {
  nomeDoMesComAno,
  percentualDaMeta,
  statusDaMeta,
  type StatusDaMeta,
} from '@/lib/meta'

/** Quantos meses o histórico mostra (mês corrente + 11 anteriores). */
export const MESES_DO_HISTORICO = 12

export type LinhaDoHistoricoDaMeta = {
  anoMes: string
  /** `agosto de 2026`. */
  rotulo: string
  /** Meta definida para o mês; `null` se nunca foi gravada (nem fallback). */
  metaCentavos: number | null
  realizadoCentavos: number
  percentual: number
  status: StatusDaMeta | null
  /** Mês corrente no calendário da clínica. */
  atual: boolean
}

/** `2026-08` + (−1) → `2026-07`. Sem fuso: aritmética de calendário. */
export function deslocarAnoMes(anoMes: string, delta: number): string {
  const [ano, mes] = anoMes.split('-').map(Number)
  const indice = ano * 12 + (mes - 1) + delta
  const novoAno = Math.floor(indice / 12)
  const novoMes = (indice % 12) + 1
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`
}

/**
 * Últimos N meses terminando em `anoMesAtual`, do mais recente ao mais antigo.
 * Ex.: `2026-08` com 3 → `['2026-08','2026-07','2026-06']`.
 */
export function listarMesesDoHistorico(anoMesAtual: string, quantidade = MESES_DO_HISTORICO): string[] {
  const n = Math.max(1, quantidade)
  const meses: string[] = []
  for (let i = 0; i < n; i += 1) {
    meses.push(deslocarAnoMes(anoMesAtual, -i))
  }
  return meses
}

type MontarHistoricoArgs = {
  meses: ReadonlyArray<string>
  /** Metas gravadas em `clinic_meta_mensal`. */
  metasPorMes: ReadonlyMap<string, number>
  /** Realizado = caixa recebido no mês (não faturamento de catálogo). */
  realizadoPorMes: ReadonlyMap<string, number>
  mesAtual: string
  /**
   * Fallback só para o mês corrente quando ainda não há linha em
   * `clinic_meta_mensal` — espelha `clinic_settings.meta_mensal_centavos`.
   */
  fallbackMetaCentavos: number
}

/**
 * Monta as linhas do histórico. Meses sem meta (e sem fallback) ficam com
 * `metaCentavos: null` e `status: null` — a UI mostra traço.
 */
export function montarHistoricoDaMeta({
  meses,
  metasPorMes,
  realizadoPorMes,
  mesAtual,
  fallbackMetaCentavos,
}: MontarHistoricoArgs): LinhaDoHistoricoDaMeta[] {
  return meses.map((anoMes) => {
    const atual = anoMes === mesAtual
    const gravada = metasPorMes.get(anoMes)
    const metaCentavos =
      gravada != null
        ? gravada
        : atual && Number.isFinite(fallbackMetaCentavos)
          ? fallbackMetaCentavos
          : null

    const realizadoCentavos = realizadoPorMes.get(anoMes) ?? 0
    // Mês atual ainda aberto: abaixo da meta → "Em progresso", não "Não atingiu".
    const status =
      metaCentavos == null
        ? null
        : statusDaMeta(realizadoCentavos, metaCentavos, { mesEmCurso: atual })
    const percentual =
      metaCentavos == null ? 0 : percentualDaMeta(realizadoCentavos, metaCentavos)

    return {
      anoMes,
      rotulo: nomeDoMesComAno(anoMes),
      metaCentavos,
      realizadoCentavos,
      percentual,
      status,
      atual,
    }
  })
}
