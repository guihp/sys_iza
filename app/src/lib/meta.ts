/**
 * Meta de faturamento do mês — o cartão no rodapé da sidebar.
 *
 * O alvo do mês corrente sai de `clinic_meta_mensal` (migration `0018`), com
 * fallback em `clinic_settings.meta_mensal_centavos` (`0017`) e, por último,
 * em `META_MENSAL_CENTAVOS` se a leitura falhar — o cartão não some.
 *
 * Realizado = caixa recebido no mês, não faturamento de catálogo. Mesma regra
 * do KPI "Recebido" em `/financeiro` (`recebidoDoMesCentavos`). Com o banco
 * vazio dá R$ 0, 0% e a barra zerada — estado correto, não erro.
 */

import { diasNoMes } from '@/lib/datetime'

/** Meta mensal padrão em centavos — fallback e seed da migration 0017. */
export const META_MENSAL_CENTAVOS = 4_500_000

const MOEDA_CHEIA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const MES_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  month: 'long',
})

const MES_COM_ANO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
})

export type ProgressoDaMeta = {
  /** Caixa recebido no mês (entradas + parcelas), em centavos. */
  realizadoCentavos: number
  metaCentavos: number
  /** Inteiro de 0 a 100 para desenhar a barra — nunca passa de 100. */
  percentualDaBarra: number
  /** Inteiro do texto. Pode passar de 100 quando a Dra. bater a meta. */
  percentualAlcancado: number
  /** Dias que ainda faltam no mês, contando hoje. */
  diasRestantes: number
}

/**
 * Resultado do mês contra a meta.
 * `em_progresso` só no mês corrente ainda aberto e abaixo da meta.
 */
export type StatusDaMeta = 'em_progresso' | 'nao_atingiu' | 'atingiu' | 'ultrapassou'

export const ROTULO_STATUS_DA_META: Record<StatusDaMeta, string> = {
  em_progresso: 'Em progresso',
  nao_atingiu: 'Não atingiu',
  atingiu: 'Atingiu',
  ultrapassou: 'Ultrapassou',
}

export type OpcoesStatusDaMeta = {
  /**
   * Mês corrente ainda em curso no calendário da clínica.
   * Abaixo da meta → `em_progresso` (não `nao_atingiu`).
   */
  mesEmCurso?: boolean
}

/**
 * Monta o cartão a partir do realizado, do dia de hoje **na clínica**
 * (`dataDaClinica(new Date())`) e da meta configurada.
 *
 * Função pura: sem `new Date()` aqui dentro, para o teste poder fixar o dia
 * sem mexer no relógio do processo. `metaCentavos` ausente cai no fallback.
 *
 * `diasRestantes` conta hoje. No último dia do mês o cartão diz "1 dia
 * restante", e não "0 dias restantes" — ainda dá para atender hoje.
 */
export function progressoDaMeta(
  realizadoCentavos: number,
  hojeISO: string,
  metaCentavos: number = META_MENSAL_CENTAVOS,
): ProgressoDaMeta {
  const meta = Number.isFinite(metaCentavos) && metaCentavos >= 0 ? metaCentavos : META_MENSAL_CENTAVOS
  // Meta zerada dividiria por zero e mandaria `Infinity` para a tela. Com meta
  // desligada a barra fica zerada, que é o estado neutro.
  const bruto = meta > 0 ? (realizadoCentavos / meta) * 100 : 0

  const diaDoMes = Number(hojeISO.slice(8, 10))

  return {
    realizadoCentavos,
    metaCentavos: meta,
    percentualDaBarra: Math.max(0, Math.min(100, Math.round(bruto))),
    percentualAlcancado: Math.max(0, Math.round(bruto)),
    diasRestantes: Math.max(0, diasNoMes(hojeISO) - diaDoMes + 1),
  }
}

/** Centavos → `R$ 12.450`. Sem centavos: o cartão da meta é leitura de relance. */
export function formatarValorRedondo(centavos: number): string {
  return MOEDA_CHEIA.format(centavos / 100)
}

/** `0% alcançado · 25 dias restantes`. Singular no dia certo. */
export function descreverProgresso(progresso: ProgressoDaMeta): string {
  const dias = progresso.diasRestantes
  const plural = dias === 1 ? 'dia restante' : 'dias restantes'
  return `${progresso.percentualAlcancado}% alcançado · ${dias} ${plural}`
}

/**
 * Compara realizado × meta em centavos.
 *
 * - Acima → ultrapassou; igual → atingiu.
 * - Abaixo + mês em curso → em progresso (ainda dá para bater).
 * - Abaixo + mês fechado / passado → não atingiu.
 * Meta zerada / inválida → não atingiu (não há alvo a bater).
 */
export function statusDaMeta(
  realizadoCentavos: number,
  metaCentavos: number,
  opcoes: OpcoesStatusDaMeta = {},
): StatusDaMeta {
  if (!Number.isFinite(metaCentavos) || metaCentavos <= 0) return 'nao_atingiu'
  if (realizadoCentavos > metaCentavos) return 'ultrapassou'
  if (realizadoCentavos === metaCentavos) return 'atingiu'
  if (opcoes.mesEmCurso) return 'em_progresso'
  return 'nao_atingiu'
}

/** Percentual inteiro do realizado sobre a meta (pode passar de 100). */
export function percentualDaMeta(realizadoCentavos: number, metaCentavos: number): number {
  if (!Number.isFinite(metaCentavos) || metaCentavos <= 0) return 0
  return Math.max(0, Math.round((realizadoCentavos / metaCentavos) * 100))
}

/** `2026-08` → `agosto`. Para o rótulo "Meta do mês de …". */
export function nomeDoMes(anoMes: string): string {
  const [ano, mes] = anoMes.split('-').map(Number)
  if (!ano || !mes) return anoMes
  return MES_EXTENSO.format(new Date(Date.UTC(ano, mes - 1, 1)))
}

/** `2026-08` → `agosto de 2026`. Histórico e gráfico. */
export function nomeDoMesComAno(anoMes: string): string {
  const [ano, mes] = anoMes.split('-').map(Number)
  if (!ano || !mes) return anoMes
  return MES_COM_ANO.format(new Date(Date.UTC(ano, mes - 1, 1)))
}

/** `YYYY-MM-DD` → `YYYY-MM` do calendário da clínica. */
export function anoMesDeData(dataISO: string): string {
  return dataISO.slice(0, 7)
}
