/**
 * Como os valores do financeiro aparecem na tela.
 *
 * Mesma convenção do Marketing: NBSP do `Intl` vira espaço comum; zero é zero
 * (não "Sem custo"); ausência vira `—`.
 */

import { formatarDataCurta } from '@/lib/datetime'
import type { FiltroFinanceiro, PeriodoFinanceiro } from './metricas'

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const MOEDA_REDONDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const MES_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
})

export const TRACINHO = '—'

export const FILTROS_FINANCEIRO: { id: FiltroFinanceiro; rotulo: string }[] = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'a_receber', rotulo: 'A receber' },
  { id: 'recebido', rotulo: 'Recebido' },
  { id: 'atrasadas', rotulo: 'Atrasadas' },
  { id: 'quitadas', rotulo: 'Quitadas' },
]

function semEspacoTeimoso(texto: string): string {
  return texto.replace(/\u00A0/g, ' ')
}

/** Centavos → `R$ 179,96`. */
export function formatarMoeda(centavos: number | null): string {
  if (centavos === null || !Number.isFinite(centavos)) return TRACINHO
  return semEspacoTeimoso(MOEDA.format(centavos / 100))
}

/** Centavos → `R$ 180`, sem centavos. Para KPI. */
export function formatarMoedaRedonda(centavos: number | null): string {
  if (centavos === null || !Number.isFinite(centavos)) return TRACINHO
  return semEspacoTeimoso(MOEDA_REDONDA.format(centavos / 100))
}

export function rotuloStatusCobranca(status: string): string {
  if (status === 'em_aberto') return 'Em aberto'
  if (status === 'parcial') return 'Parcial'
  if (status === 'quitado') return 'Quitado'
  return status
}

export function rotuloFormaRestante(forma: string | null | undefined): string {
  if (forma === 'pix') return 'PIX'
  if (forma === 'cartao') return 'Cartão'
  return TRACINHO
}

/** `2026-08` → `agosto de 2026`. */
export function rotuloMes(mesYYYYMM: string): string {
  const [ano, mes] = mesYYYYMM.split('-').map(Number)
  if (!ano || !mes) return mesYYYYMM
  return MES_EXTENSO.format(new Date(Date.UTC(ano, mes - 1, 1)))
}

/** Texto curto do seletor de período. */
export function rotuloDoPeriodo(periodo: PeriodoFinanceiro): string {
  if (periodo.modo === 'semana') {
    return `${formatarDataCurta(periodo.inicio)} – ${formatarDataCurta(periodo.fim)}`
  }
  return rotuloMes(periodo.inicio.slice(0, 7))
}

/** Sublegenda dos KPIs conforme o modo. */
export function sublegendaDoPeriodo(periodo: PeriodoFinanceiro): string {
  if (periodo.modo === 'semana') return 'nesta semana'
  if (periodo.modo === 'mes') return 'neste mês'
  return `em ${rotuloMes(periodo.inicio.slice(0, 7))}`
}
