/**
 * KPIs, períodos e filtros da tela `/financeiro` — funções puras, sem I/O.
 *
 * Cashflow por calendário da clínica:
 * - Entrada: recebida na data do atendimento (`realizado_em`), fallback `criado_em`.
 * - Parcelas (cartão): agenda pelo `vencimento`. Sem botão de baixa na UI.
 *   Para o KPI "Recebido", parcela com vencimento no período e ≤ hoje conta
 *   como liquidada no vencimento (recebimento esperado do cartão). O status
 *   de exibição continua derivado de `pago_em` + vencimento (`statusParcela`):
 *   atrasada = vencimento < hoje e sem `pago_em`.
 */

import {
  dataDaClinica,
  diaDaSemanaDaData,
  deslocarData,
  diasNoMes,
} from '@/lib/datetime'
import { statusParcela, type StatusCobranca, type StatusParcela } from '@/domain/finance/cobranca'

export type ParcelaParaMetricas = {
  valor_centavos: number
  vencimento: string
  pago_em: string | null
}

export type CobrancaParaMetricas = {
  valor_entrada_centavos: number
  valor_proxima_consulta_centavos: number
  status: StatusCobranca
  /** Timestamptz ISO do registro da cobrança (fallback da entrada). */
  criado_em: string
  /** Timestamptz do atendimento; preferido para data da entrada. */
  realizado_em?: string | null
  parcelas: ReadonlyArray<ParcelaParaMetricas>
}

/** Janela inclusiva em `YYYY-MM-DD` (calendário da clínica). */
export type PeriodoFinanceiro = {
  inicio: string
  fim: string
  /** Chave estável para a URL / navegação. */
  chave: string
  /** `semana` | `mes` (mês corrente) | `mes_escolhido` (`YYYY-MM`). */
  modo: 'semana' | 'mes' | 'mes_escolhido'
}

export type FiltroFinanceiro = 'todos' | 'a_receber' | 'recebido' | 'atrasadas' | 'quitadas'

export type KpisFinanceiros = {
  aReceberCentavos: number
  atrasadasCentavos: number
  recebidoNoPeriodoCentavos: number
}

/** Ponto diário do gráfico "Recebido ao longo do período". */
export type PontoRecebidoDia = {
  data: string
  /** Rótulo curto do eixo X (ex.: `seg`, `12`). */
  rotulo: string
  entradaCentavos: number
  parcelasCentavos: number
  totalCentavos: number
}

/** Fatia / barra do resumo a receber × recebido × atrasadas. */
export type FatiaStatusFinanceiro = {
  id: 'recebido' | 'a_receber' | 'atrasadas'
  rotulo: string
  valorCentavos: number
}

/** Totais do recebido no período, separados por origem. */
export type ComposicaoRecebido = {
  entradaCentavos: number
  parcelasCentavos: number
  totalCentavos: number
}

/** Segunda-feira da semana (mesma regra da agenda). */
export function inicioDaSemanaFinanceiro(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  const dow = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
  const recuo = dow === 0 ? 6 : dow - 1
  return deslocarData(dataISO, -recuo)
}

/** Monta o período a partir de `?periodo=` e do dia de hoje na clínica. */
export function periodoDaUrl(
  valor: string | string[] | undefined,
  hojeISO: string,
): PeriodoFinanceiro {
  const bruto = Array.isArray(valor) ? valor[0] : valor

  if (bruto === 'semana') {
    const inicio = inicioDaSemanaFinanceiro(hojeISO)
    return {
      inicio,
      fim: deslocarData(inicio, 6),
      chave: 'semana',
      modo: 'semana',
    }
  }

  if (bruto && /^\d{4}-\d{2}$/.test(bruto)) {
    const mesAtual = hojeISO.slice(0, 7)
    const base = periodoDoMes(bruto)
    if (bruto === mesAtual) {
      return { ...base, chave: 'mes', modo: 'mes' }
    }
    return base
  }

  // Default e `mes`: mês civil de hoje.
  const mes = hojeISO.slice(0, 7)
  return { ...periodoDoMes(mes), chave: 'mes', modo: 'mes' }
}

export function periodoDoMes(mesYYYYMM: string): PeriodoFinanceiro {
  const inicio = `${mesYYYYMM}-01`
  const ultimoDia = diasNoMes(inicio)
  const fim = `${mesYYYYMM}-${String(ultimoDia).padStart(2, '0')}`
  return {
    inicio,
    fim,
    chave: mesYYYYMM,
    modo: 'mes_escolhido',
  }
}

/** Mês anterior / seguinte a um `YYYY-MM`. */
export function deslocarMes(mesYYYYMM: string, delta: number): string {
  const [ano, mes] = mesYYYYMM.split('-').map(Number)
  const indice = ano * 12 + (mes - 1) + delta
  const novoAno = Math.floor(indice / 12)
  const novoMes = (indice % 12) + 1
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`
}

/** Lê `?filtro=`; inválido → `todos`. */
export function filtroDaUrl(valor: string | string[] | undefined): FiltroFinanceiro {
  const bruto = Array.isArray(valor) ? valor[0] : valor
  if (
    bruto === 'todos' ||
    bruto === 'a_receber' ||
    bruto === 'recebido' ||
    bruto === 'atrasadas' ||
    bruto === 'quitadas'
  ) {
    return bruto
  }
  return 'todos'
}

/** Status efetivo da parcela (pago / atrasado / pendente) no dia da clínica. */
export function statusEfetivoDaParcela(
  parcela: ParcelaParaMetricas,
  hojeISO: string,
): StatusParcela {
  return statusParcela({
    vencimento: parcela.vencimento,
    pago_em: parcela.pago_em,
    hoje: hojeISO,
  })
}

/** Data de calendário em que a entrada conta como recebida. */
export function dataDaEntrada(cobranca: CobrancaParaMetricas): string | null {
  if (cobranca.realizado_em) {
    const instante = new Date(cobranca.realizado_em)
    if (!Number.isNaN(instante.getTime())) return dataDaClinica(instante)
  }
  const criado = new Date(cobranca.criado_em)
  if (Number.isNaN(criado.getTime())) return null
  return dataDaClinica(criado)
}

/**
 * Data em que a parcela conta no KPI "Recebido".
 *
 * 1. Com `pago_em` → dia da baixa na clínica.
 * 2. Sem baixa, vencimento ≤ hoje → liquidação esperada no vencimento (cartão).
 */
export function dataRecebimentoParcela(
  parcela: ParcelaParaMetricas,
  hojeISO: string,
): string | null {
  if (parcela.pago_em) {
    const instante = new Date(parcela.pago_em)
    if (Number.isNaN(instante.getTime())) return null
    return dataDaClinica(instante)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(parcela.vencimento) && parcela.vencimento <= hojeISO) {
    return parcela.vencimento
  }
  return null
}

function dataNoPeriodo(dataISO: string | null, periodo: PeriodoFinanceiro): boolean {
  if (!dataISO || !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) return false
  return dataISO >= periodo.inicio && dataISO <= periodo.fim
}

/**
 * KPIs do período selecionado.
 *
 * - Recebido: entradas com data no período + parcelas com data de recebimento
 *   (baixa ou vencimento esperado) no período.
 * - A receber: próxima (não quitada) + parcelas ainda não pagas (pendente ou
 *   atrasada) — saldo em aberto, independente do período.
 * - Atrasadas: parcelas com vencimento passado e sem `pago_em`.
 */
export function calcularKpis(
  cobrancas: ReadonlyArray<CobrancaParaMetricas>,
  hojeISO: string,
  periodo: PeriodoFinanceiro,
): KpisFinanceiros {
  let aReceber = 0
  let atrasadas = 0
  let recebidoNoPeriodo = 0

  for (const cobranca of cobrancas) {
    if (cobranca.status !== 'quitado') {
      aReceber += inteiroNaoNegativo(cobranca.valor_proxima_consulta_centavos)
    }

    const dataEntrada = dataDaEntrada(cobranca)
    if (dataNoPeriodo(dataEntrada, periodo)) {
      recebidoNoPeriodo += inteiroNaoNegativo(cobranca.valor_entrada_centavos)
    }

    for (const parcela of cobranca.parcelas) {
      const status = statusEfetivoDaParcela(parcela, hojeISO)
      const valor = inteiroNaoNegativo(parcela.valor_centavos)
      const dataRx = dataRecebimentoParcela(parcela, hojeISO)

      if (status === 'pago') {
        if (dataNoPeriodo(dataRx, periodo)) recebidoNoPeriodo += valor
      } else if (status === 'atrasado') {
        aReceber += valor
        atrasadas += valor
      } else if (dataRx) {
        // Vence hoje (ainda pendente no banco): liquidação esperada do cartão.
        if (dataNoPeriodo(dataRx, periodo)) recebidoNoPeriodo += valor
      } else {
        aReceber += valor
      }
    }
  }

  return {
    aReceberCentavos: aReceber,
    atrasadasCentavos: atrasadas,
    recebidoNoPeriodoCentavos: recebidoNoPeriodo,
  }
}

/** Cobrança intersecta o período (atendimento, entrada, vencimento ou atrasada viva). */
export function cobrancaNoPeriodo(
  cobranca: CobrancaParaMetricas,
  periodo: PeriodoFinanceiro,
  hojeISO: string,
): boolean {
  if (dataNoPeriodo(dataDaEntrada(cobranca), periodo)) return true

  for (const parcela of cobranca.parcelas) {
    if (dataNoPeriodo(parcela.vencimento, periodo)) return true
    const rx = dataRecebimentoParcela(parcela, hojeISO)
    if (dataNoPeriodo(rx, periodo)) return true
    // Atrasada continua visível em qualquer período (saldo que precisa atenção).
    if (statusEfetivoDaParcela(parcela, hojeISO) === 'atrasado') return true
  }

  if (
    cobranca.status !== 'quitado' &&
    inteiroNaoNegativo(cobranca.valor_proxima_consulta_centavos) > 0
  ) {
    return true
  }

  return false
}

/** Classificação da cobrança para os chips de filtro. */
export function classificacaoDaCobranca(
  cobranca: CobrancaParaMetricas,
  hojeISO: string,
): {
  temAReceber: boolean
  temRecebido: boolean
  temAtrasada: boolean
  quitada: boolean
} {
  const quitada = cobranca.status === 'quitado'
  let temAReceber = false
  let temRecebido = inteiroNaoNegativo(cobranca.valor_entrada_centavos) > 0
  let temAtrasada = false

  if (!quitada && inteiroNaoNegativo(cobranca.valor_proxima_consulta_centavos) > 0) {
    temAReceber = true
  }

  for (const parcela of cobranca.parcelas) {
    const status = statusEfetivoDaParcela(parcela, hojeISO)
    if (status === 'pago') {
      temRecebido = true
    } else if (status === 'atrasado') {
      temAtrasada = true
      temAReceber = true
    } else {
      temAReceber = true
      // Vence hoje: liquidação esperada do cartão → também "recebido".
      if (dataRecebimentoParcela(parcela, hojeISO)) temRecebido = true
    }
  }

  return { temAReceber, temRecebido, temAtrasada, quitada }
}

export function filtrarCobrancas<T extends CobrancaParaMetricas>(
  cobrancas: ReadonlyArray<T>,
  filtro: FiltroFinanceiro,
  periodo: PeriodoFinanceiro,
  hojeISO: string,
): T[] {
  // Atrasadas e quitadas olham o estoque inteiro; os demais recortam o período.
  const base =
    filtro === 'atrasadas' || filtro === 'quitadas'
      ? [...cobrancas]
      : cobrancas.filter((c) => cobrancaNoPeriodo(c, periodo, hojeISO))

  if (filtro === 'todos') return base

  return base.filter((cobranca) => {
    const cls = classificacaoDaCobranca(cobranca, hojeISO)
    if (filtro === 'a_receber') return cls.temAReceber
    if (filtro === 'recebido') return cls.temRecebido
    if (filtro === 'atrasadas') return cls.temAtrasada
    if (filtro === 'quitadas') return cls.quitada
    return true
  })
}

/** Quantas parcelas já foram pagas vs total. */
export function resumoParcelas(
  parcelas: ReadonlyArray<ParcelaParaMetricas>,
  hojeISO: string,
): { pagas: number; total: number; atrasadas: number; pendentes: number } {
  let pagas = 0
  let atrasadas = 0
  let pendentes = 0
  for (const parcela of parcelas) {
    const status = statusEfetivoDaParcela(parcela, hojeISO)
    if (status === 'pago') pagas += 1
    else if (status === 'atrasado') atrasadas += 1
    else pendentes += 1
  }
  return { pagas, total: parcelas.length, atrasadas, pendentes }
}

/** Próxima parcela ainda em aberto (menor `numero`), ou null. */
export function proximaParcelaAberta<T extends ParcelaParaMetricas & { numero: number; id: string }>(
  parcelas: ReadonlyArray<T>,
  hojeISO: string,
): T | null {
  const abertas = parcelas
    .filter((p) => statusEfetivoDaParcela(p, hojeISO) !== 'pago')
    .sort((a, b) => a.numero - b.numero)
  return abertas[0] ?? null
}

/** Contagens dos chips (período para todos/a receber/recebido; estoque para atrasadas/quitadas). */
export function contarPorFiltro(
  cobrancas: ReadonlyArray<CobrancaParaMetricas>,
  periodo: PeriodoFinanceiro,
  hojeISO: string,
): Record<FiltroFinanceiro, number> {
  const basePeriodo = cobrancas.filter((c) => cobrancaNoPeriodo(c, periodo, hojeISO))
  const contagens: Record<FiltroFinanceiro, number> = {
    todos: basePeriodo.length,
    a_receber: 0,
    recebido: 0,
    atrasadas: 0,
    quitadas: 0,
  }

  for (const cobranca of basePeriodo) {
    const cls = classificacaoDaCobranca(cobranca, hojeISO)
    if (cls.temAReceber) contagens.a_receber += 1
    if (cls.temRecebido) contagens.recebido += 1
  }

  for (const cobranca of cobrancas) {
    const cls = classificacaoDaCobranca(cobranca, hojeISO)
    if (cls.temAtrasada) contagens.atrasadas += 1
    if (cls.quitada) contagens.quitadas += 1
  }

  return contagens
}

/**
 * Série diária do recebido no período (entrada + parcelas), um ponto por dia
 * da janela — mesmo critério de `calcularKpis`.
 */
export function serieRecebidoPorDia(
  cobrancas: ReadonlyArray<CobrancaParaMetricas>,
  hojeISO: string,
  periodo: PeriodoFinanceiro,
): PontoRecebidoDia[] {
  const porDia = new Map<string, { entrada: number; parcelas: number }>()
  for (const dia of diasDoPeriodo(periodo)) {
    porDia.set(dia, { entrada: 0, parcelas: 0 })
  }

  for (const cobranca of cobrancas) {
    const dataEntrada = dataDaEntrada(cobranca)
    if (dataEntrada && porDia.has(dataEntrada)) {
      const bucket = porDia.get(dataEntrada)!
      bucket.entrada += inteiroNaoNegativo(cobranca.valor_entrada_centavos)
    }

    for (const parcela of cobranca.parcelas) {
      const status = statusEfetivoDaParcela(parcela, hojeISO)
      const valor = inteiroNaoNegativo(parcela.valor_centavos)
      const dataRx = dataRecebimentoParcela(parcela, hojeISO)
      if (!dataRx || !porDia.has(dataRx)) continue

      if (status === 'pago') {
        porDia.get(dataRx)!.parcelas += valor
      } else if (status !== 'atrasado' && dataRx) {
        // Vence hoje (ainda pendente): liquidação esperada do cartão.
        porDia.get(dataRx)!.parcelas += valor
      }
    }
  }

  return [...porDia.entries()].map(([data, bucket]) => ({
    data,
    rotulo: rotuloEixoDia(data, periodo.modo),
    entradaCentavos: bucket.entrada,
    parcelasCentavos: bucket.parcelas,
    totalCentavos: bucket.entrada + bucket.parcelas,
  }))
}

/** Soma entrada × parcelas a partir da série diária (ou zero se vazia). */
export function composicaoRecebidoNoPeriodo(
  serie: ReadonlyArray<PontoRecebidoDia>,
): ComposicaoRecebido {
  let entradaCentavos = 0
  let parcelasCentavos = 0
  for (const ponto of serie) {
    entradaCentavos += ponto.entradaCentavos
    parcelasCentavos += ponto.parcelasCentavos
  }
  return {
    entradaCentavos,
    parcelasCentavos,
    totalCentavos: entradaCentavos + parcelasCentavos,
  }
}

/** Barras/fatias do resumo alinhadas aos KPIs do cabeçalho. */
export function serieStatusResumo(kpis: KpisFinanceiros): FatiaStatusFinanceiro[] {
  return [
    { id: 'recebido', rotulo: 'Recebido', valorCentavos: kpis.recebidoNoPeriodoCentavos },
    { id: 'a_receber', rotulo: 'A receber', valorCentavos: kpis.aReceberCentavos },
    { id: 'atrasadas', rotulo: 'Atrasadas', valorCentavos: kpis.atrasadasCentavos },
  ]
}

export function serieTemValor(
  pontos: ReadonlyArray<{ totalCentavos?: number; valorCentavos?: number }>,
): boolean {
  return pontos.some((p) => (p.totalCentavos ?? p.valorCentavos ?? 0) > 0)
}

/**
 * Realizado da meta = caixa recebido no mês, não faturamento de catálogo.
 * Mesma regra do KPI "Recebido no período" (`calcularKpis`).
 */
export function recebidoDoMesCentavos(
  cobrancas: ReadonlyArray<CobrancaParaMetricas>,
  hojeISO: string,
  anoMes: string = hojeISO.slice(0, 7),
): number {
  return calcularKpis(cobrancas, hojeISO, periodoDoMes(anoMes)).recebidoNoPeriodoCentavos
}

/**
 * Soma o recebido (entrada + parcelas liquidas) por `YYYY-MM`.
 * Usado pelo histórico da meta e pelo cartão da sidebar.
 */
export function agruparRecebidoPorMes(
  cobrancas: ReadonlyArray<CobrancaParaMetricas>,
  hojeISO: string,
  meses: ReadonlyArray<string>,
): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const mes of meses) {
    mapa.set(mes, recebidoDoMesCentavos(cobrancas, hojeISO, mes))
  }
  return mapa
}

const DIAS_EIXO_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const

function rotuloEixoDia(dataISO: string, modo: PeriodoFinanceiro['modo']): string {
  if (modo === 'semana') return DIAS_EIXO_CURTO[diaDaSemanaDaData(dataISO)] ?? dataISO
  const dia = Number(dataISO.slice(8, 10))
  return String(dia)
}

function* diasDoPeriodo(periodo: PeriodoFinanceiro): Generator<string> {
  let atual = periodo.inicio
  while (atual <= periodo.fim) {
    yield atual
    atual = deslocarData(atual, 1)
  }
}

function inteiroNaoNegativo(valor: number): number {
  if (!Number.isFinite(valor) || !Number.isInteger(valor) || valor < 0) return 0
  return valor
}
