'use client'

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import {
  aplicarFeito,
  criarLinhaExtra,
  montarLinhasBotox,
  montarLinhasFiller,
  resumoQuantidadeFeita,
  statusExecucao,
  totaisExecucao,
  type LinhaExecucao,
  type UnidadeExecucao,
} from '@/domain/clinical/atendimento-execucao'
import {
  composicaoPorFormaRestante,
  gerarParcelas,
  mensagemErroCobranca,
  validarComposicao,
  type FormaEntrada,
  type FormaRestante,
} from '@/domain/finance/cobranca'
import {
  jurosMaquininhaCentavos,
  MAX_PARCELAS_MAQUININHA,
  taxaMaquininhaPercentual,
} from '@/domain/finance/taxas-maquininha'
import { calcularRetorno } from '@/domain/returns/compute-return'
import {
  formatarMoeda,
} from '@/app/(app)/marketing/formatacao'
import {
  mascararMoedaAoDigitar,
  precoParaCampo,
  reaisParaCentavos,
} from '@/app/(app)/configuracoes/procedimentos/formatacao'
import {
  dataDoDiaDeCalendario,
  diaDeCalendario,
  formatarDataExtensaComAno,
} from '@/lib/datetime'
import { BOTAO_PRINCIPAL, BOTAO_SECUNDARIO, CAMPO } from '../campos'
import { atualizarAtendimento, registrarAtendimento } from './acoes'
import {
  baselineDasLinhasSalvas,
  linhaSalvaEhDoPlano,
} from './atendimento-lista'
import type { AtendimentoCompleto, OrigemAtendimento } from './atendimento-tipos'

export type OpcaoDeProcedimento = {
  id: string
  nome: string
  /** `default_return_interval_days` do catálogo. Nível 1 da precedência. */
  retornoPadraoDias: number | null
  precoCentavos: number
}

export type OpcaoDeConsulta = {
  id: string
  /** Já formatado no servidor: "10 de agosto · 14:00 · Toxina botulínica". */
  rotulo: string
}

export type ItemPlanoBotoxOpcao = {
  musculo: string
  quantidade_unidades: number | null
  total_unidades: number | null
  procedimento_id: string | null
  ordem: number
}

export type ItemPlanoFillerOpcao = {
  produto: string
  quantidade_ml: number | null
  procedimento_id: string | null
  ordem: number
}

export type PlanoBotoxOpcao = {
  id: string
  rotulo: string
  itens: ItemPlanoBotoxOpcao[]
}

export type PlanoFillerOpcao = {
  id: string
  rotulo: string
  itens: ItemPlanoFillerOpcao[]
}

/** Linha na tela: execução + id estável + se veio do plano ou foi extra neste atendimento. */
type LinhaNaTela = LinhaExecucao & { idLocal: string; doPlano: boolean }

const BOTAO_PERIGO =
  'rounded-lg border border-red-600/30 px-2 py-1 text-xs text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300'

const FORMAS_ENTRADA: { valor: FormaEntrada; rotulo: string }[] = [
  { valor: 'pix', rotulo: 'PIX' },
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
  { valor: 'debito', rotulo: 'Débito' },
  { valor: 'credito', rotulo: 'Crédito' },
  { valor: 'outro', rotulo: 'Outro' },
]

const FORMAS_RESTANTE: { valor: FormaRestante; rotulo: string }[] = [
  { valor: 'pix', rotulo: 'PIX' },
  { valor: 'cartao', rotulo: 'Cartão' },
]

/** Inferência para cobranças antigas sem `forma_restante` gravada. */
function inferirFormaRestante(c: {
  forma_restante?: FormaRestante | null
  valor_parcelado_centavos: number
  valor_proxima_consulta_centavos: number
} | null): FormaRestante | '' {
  if (!c) return ''
  if (c.forma_restante === 'pix' || c.forma_restante === 'cartao') return c.forma_restante
  if (c.valor_parcelado_centavos > 0) return 'cartao'
  if (c.valor_proxima_consulta_centavos > 0) return 'pix'
  return ''
}

const MSG_REMOVER =
  'Remover esta linha só deste atendimento?\n\nO plano original da paciente não será alterado.'
const MSG_ADICIONAR =
  'Incluir uma linha extra (algo feito além do plano)?\n\nO plano original da paciente não será alterado.'

/** Estado inicial dos campos de retorno para um procedimento. */
function padraoDoProcedimento(
  procedimentos: OpcaoDeProcedimento[],
  id: string,
): { padraoDias: number | null; dias: string } {
  const escolhido = procedimentos.find((procedimento) => procedimento.id === id)
  const padraoDias = escolhido?.retornoPadraoDias ?? null
  return { padraoDias, dias: padraoDias == null ? '' : String(padraoDias) }
}

function catalogoMapa(procedimentos: OpcaoDeProcedimento[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of procedimentos) m.set(p.id, p.precoCentavos)
  return m
}

/** Soma um mês a `YYYY-MM-DD` (último dia do mês se o dia não existir). */
function maisUmMes(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [y, m, d] = iso.split('-').map(Number)
  const alvoMes = m - 1 + 1
  const ny = y + Math.floor(alvoMes / 12)
  const nm = ((alvoMes % 12) + 12) % 12
  const ultimo = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const nd = Math.min(d, ultimo)
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

function nomeProcedimento(
  procedimentos: OpcaoDeProcedimento[],
  id: string | null,
): string {
  if (!id) return '—'
  return procedimentos.find((p) => p.id === id)?.nome ?? '—'
}

function campoCentavos(valor: number): string {
  return precoParaCampo(Math.max(0, valor))
}

function formatarQtd(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : String(valor).replace('.', ',')
}

function lerQtd(texto: string): number {
  const n = texto.trim() === '' ? 0 : Number(texto.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function comIdLocal(linhas: LinhaExecucao[], prefixo: string): LinhaNaTela[] {
  return linhas.map((linha, i) => ({
    ...linha,
    idLocal: `${prefixo}-${linha.ordem}-${i}`,
    doPlano: true,
  }))
}

/**
 * Formulário de atendimento — criar ou editar.
 *
 * Create: grava prontuário novo + retorno + lembretes (como antes).
 * Edit: clínica / execução / pagamento; **retorno travado** (lembretes idempotentes
 * sem a data — replanejar não atualizaria o job antigo).
 *
 * Sem autosave: salva só no botão. Secretária: somenteLeitura.
 */
export function RegistrarAtendimento({
  pacienteId,
  hojeISO,
  procedimentos,
  consultas,
  planosBotox,
  planosFiller,
  atendimentoInicial = null,
  somenteLeitura = false,
  onVoltar,
  onSalvo,
}: {
  pacienteId: string
  /** Dia de calendário de hoje **na clínica**, resolvido no servidor. */
  hojeISO: string
  procedimentos: OpcaoDeProcedimento[]
  consultas: OpcaoDeConsulta[]
  planosBotox: PlanoBotoxOpcao[]
  planosFiller: PlanoFillerOpcao[]
  /** Null = criar; preenchido = editar/ver. */
  atendimentoInicial?: AtendimentoCompleto | null
  somenteLeitura?: boolean
  onVoltar?: () => void
  /** Após create/update ok — volta à galeria e refresca. */
  onSalvo?: () => void
}) {
  const idGerador = useId()
  const sequenciaExtra = useRef(0)
  const alertaRef = useRef<HTMLParagraphElement | null>(null)
  const editando = atendimentoInicial != null
  const bloqueado = somenteLeitura

  const origemInicial: OrigemAtendimento =
    atendimentoInicial &&
    (atendimentoInicial.botox_plan_id || atendimentoInicial.filler_plan_id)
      ? 'plano'
      : 'avulso'
  const planoChaveInicial = atendimentoInicial?.botox_plan_id
    ? `botox:${atendimentoInicial.botox_plan_id}`
    : atendimentoInicial?.filler_plan_id
      ? `filler:${atendimentoInicial.filler_plan_id}`
      : ''

  const linhasIniciais: LinhaNaTela[] = atendimentoInicial
    ? [...atendimentoInicial.itens]
        .sort((a, b) => a.ordem - b.ordem)
        .map((item, i) => ({
          ordem: item.ordem,
          rotulo: item.rotulo,
          unidade: item.unidade,
          procedimento_id: item.procedimento_id,
          preco_centavos: item.preco_centavos,
          planejado_qtd: Number(item.planejado_qtd),
          feito_qtd: Number(item.feito_qtd),
          planejado_centavos: item.planejado_centavos,
          feito_centavos: item.feito_centavos,
          idLocal: item.id || `salvo-${i}`,
          doPlano: linhaSalvaEhDoPlano(Number(item.planejado_qtd)),
        }))
    : []

  const baselineInicial = atendimentoInicial
    ? baselineDasLinhasSalvas(
        atendimentoInicial.itens.map((i) => ({
          ordem: i.ordem,
          planejado_qtd: Number(i.planejado_qtd),
          planejado_centavos: i.planejado_centavos,
        })),
      )
    : []

  const cobrancaIni = atendimentoInicial?.cobranca ?? null
  const primeiraParcela = cobrancaIni?.parcelas
    .slice()
    .sort((a, b) => a.numero - b.numero)[0]
  const temParcelaPaga =
    cobrancaIni?.parcelas.some((p) => p.status === 'pago') === true

  const [origem, setOrigem] = useState<OrigemAtendimento>(origemInicial)
  const [planoChave, setPlanoChave] = useState(planoChaveInicial)
  const [linhas, setLinhas] = useState<LinhaNaTela[]>(linhasIniciais)
  /**
   * Snapshot do plano ao carregar (congelado):
   * - status parcial se linha planejada sumir / feito cair
   * - Planejado R$ vem daqui, não da tabela mutável
   */
  const [baseline, setBaseline] = useState<
    Array<Pick<LinhaExecucao, 'ordem' | 'planejado_qtd' | 'planejado_centavos'>>
  >(baselineInicial)

  const [procedimentoId, setProcedimentoId] = useState(
    atendimentoInicial?.procedure_id ?? '',
  )
  const [consultaId, setConsultaId] = useState(atendimentoInicial?.appointment_id ?? '')
  const [regiaoTratada, setRegiaoTratada] = useState(
    atendimentoInicial?.regiao_tratada ?? '',
  )
  const [quantidade, setQuantidade] = useState(atendimentoInicial?.quantidade ?? '')
  const [produto, setProduto] = useState(atendimentoInicial?.produto ?? '')
  const [lote, setLote] = useState(atendimentoInicial?.lote ?? '')
  const [observacoes, setObservacoes] = useState(atendimentoInicial?.observacoes ?? '')
  const [termoAssinado, setTermoAssinado] = useState(
    atendimentoInicial?.termo_assinado === true,
  )

  const [dias, setDias] = useState(
    atendimentoInicial?.retorno_ajuste_dias != null
      ? String(atendimentoInicial.retorno_ajuste_dias)
      : atendimentoInicial
        ? ''
        : '',
  )
  const [data, setData] = useState(atendimentoInicial?.retorno_data ?? '')
  const [semRetorno, setSemRetorno] = useState(atendimentoInicial?.sem_retorno === true)

  // Pagamento — textos dos campos em reais (pt-BR).
  const [incluirPagamento, setIncluirPagamento] = useState(cobrancaIni != null)
  const [totalTexto, setTotalTexto] = useState(
    cobrancaIni ? campoCentavos(cobrancaIni.valor_total_centavos) : '',
  )
  const [entradaTexto, setEntradaTexto] = useState(
    cobrancaIni ? campoCentavos(cobrancaIni.valor_entrada_centavos) : '',
  )
  const [formaEntrada, setFormaEntrada] = useState<FormaEntrada | ''>(
    cobrancaIni?.forma_entrada ?? '',
  )
  const [formaRestante, setFormaRestante] = useState<FormaRestante | ''>(() =>
    inferirFormaRestante(cobrancaIni),
  )
  const [proximaTexto, setProximaTexto] = useState(
    cobrancaIni ? campoCentavos(cobrancaIni.valor_proxima_consulta_centavos) : '0,00',
  )
  const [parceladoTexto, setParceladoTexto] = useState(
    cobrancaIni ? campoCentavos(cobrancaIni.valor_parcelado_centavos) : '0,00',
  )
  const [parcelasQtd, setParcelasQtd] = useState(() => {
    const qtd = cobrancaIni ? Math.max(1, cobrancaIni.parcelas_qtd || 1) : 1
    return String(Math.min(MAX_PARCELAS_MAQUININHA, qtd))
  })
  const [primeiroVencimento, setPrimeiroVencimento] = useState(
    () => primeiraParcela?.vencimento ?? maisUmMes(hojeISO),
  )
  const [jurosRepassados, setJurosRepassados] = useState(
    cobrancaIni?.juros_repassados_ao_cliente === true,
  )
  /** Evita sobrescrever total/entrada quando a Dra. já editou à mão. */
  const [pagamentoManual, setPagamentoManual] = useState(editando && cobrancaIni != null)

  const [erro, setErro] = useState<string | null>(null)
  const [confirmacao, setConfirmacao] = useState<string | null>(null)
  const [pendente, iniciarTransicao] = useTransition()

  const precos = useMemo(() => catalogoMapa(procedimentos), [procedimentos])
  const temPlanos = planosBotox.length > 0 || planosFiller.length > 0

  const { padraoDias } = padraoDoProcedimento(procedimentos, procedimentoId)

  const diasDigitados = dias.trim() === '' ? null : Number(dias)
  const ajusteDias =
    diasDigitados !== null && Number.isFinite(diasDigitados) && diasDigitados > 0
      ? diasDigitados
      : null

  /** Em create: prévia a partir de hoje. Em edit: usa o vencimento já gravado. */
  const previsto = editando
    ? atendimentoInicial?.retorno_vencimento
      ? diaDeCalendario(atendimentoInicial.retorno_vencimento)
      : null
    : calcularRetorno({
        realizadoEm: diaDeCalendario(hojeISO),
        padraoDias,
        ajusteDias: semRetorno ? null : ajusteDias,
        ajusteData: semRetorno || !data ? null : diaDeCalendario(data),
        semRetorno,
      })

  const retornoTravado = editando
  const parcelasTravadas = editando && temParcelaPaga
  const origemTravada = editando

  const statusPlano =
    origem === 'plano' && (linhas.length > 0 || baseline.length > 0)
      ? statusExecucao(linhas, baseline)
      : null
  const totais = origem === 'plano' ? totaisExecucao(linhas, baseline) : null
  const quantidadeAuto =
    origem === 'plano' && linhas.length > 0 ? resumoQuantidadeFeita(linhas) : null

  const unidadeDoPlano: UnidadeExecucao = planoChave.startsWith('filler:') ? 'ml' : 'U'

  const totalCentavos = reaisParaCentavos(totalTexto) ?? 0
  const entradaCentavos = reaisParaCentavos(entradaTexto) ?? 0
  const restandoEhCartao = formaRestante === 'cartao'
  const qtdParcelas = Math.min(
    MAX_PARCELAS_MAQUININHA,
    Math.max(1, Number.parseInt(parcelasQtd, 10) || 1),
  )
  // Base clínica no cartão (antes do MDR). Próxima no cartão fica 0 — residual
  // inteiro vai para o parcelado.
  const baseCartaoCentavos = restandoEhCartao
    ? Math.max(0, totalCentavos - entradaCentavos)
    : 0
  const jurosCentavos =
    restandoEhCartao && baseCartaoCentavos > 0
      ? jurosMaquininhaCentavos({
          valorBaseCentavos: baseCartaoCentavos,
          parcelasQtd: qtdParcelas,
          repassarAoCliente: jurosRepassados,
        })
      : 0
  const taxaPercentual = restandoEhCartao
    ? taxaMaquininhaPercentual(qtdParcelas, 'credito')
    : null

  // PIX / não informado: residual na próxima. Cartão: residual no parcelado.
  const distribuicaoRestante = incluirPagamento
    ? composicaoPorFormaRestante({
        forma_restante: formaRestante || null,
        valor_total_centavos: totalCentavos,
        valor_entrada_centavos: entradaCentavos,
        juros_maquininha_centavos: restandoEhCartao ? jurosCentavos : 0,
        juros_repassados_ao_cliente: restandoEhCartao && jurosRepassados,
      })
    : null

  const parceladoCentavos = distribuicaoRestante?.valor_parcelado_centavos ?? 0
  const proximaCentavos = distribuicaoRestante?.valor_proxima_consulta_centavos ?? 0

  const previewParcelas =
    incluirPagamento && restandoEhCartao && parceladoCentavos > 0
      ? gerarParcelas(parceladoCentavos, qtdParcelas, primeiroVencimento)
      : []

  const validacaoPagamento = incluirPagamento
    ? validarComposicao({
        valor_total_centavos: totalCentavos,
        valor_entrada_centavos: entradaCentavos,
        valor_proxima_consulta_centavos: proximaCentavos,
        valor_parcelado_centavos: parceladoCentavos,
        juros_maquininha_centavos: restandoEhCartao ? jurosCentavos : 0,
        juros_repassados_ao_cliente: restandoEhCartao && jurosRepassados,
        parcelas_qtd: parceladoCentavos > 0 ? qtdParcelas : undefined,
      })
    : ({ ok: true } as const)

  const alertaPagamento =
    !validacaoPagamento.ok
      ? mensagemErroCobranca(validacaoPagamento, formatarMoeda)
      : null

  useEffect(() => {
    if (erro && alertaRef.current) {
      alertaRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [erro])

  // Quando o total feito muda (plano), pré-preenche total = feito e entrada = total.
  useEffect(() => {
    if (origem !== 'plano' || !totais || pagamentoManual) return
    setTotalTexto(campoCentavos(totais.feito_centavos))
    setEntradaTexto(campoCentavos(totais.feito_centavos))
    setProximaTexto('0,00')
    setParceladoTexto('0,00')
  }, [origem, totais?.feito_centavos, pagamentoManual])

  // Sincroniza textos de próxima / parcelado com a distribuição pela forma do restante.
  useEffect(() => {
    if (!distribuicaoRestante) return
    setProximaTexto(campoCentavos(distribuicaoRestante.valor_proxima_consulta_centavos))
    setParceladoTexto(campoCentavos(distribuicaoRestante.valor_parcelado_centavos))
  }, [
    distribuicaoRestante?.valor_proxima_consulta_centavos,
    distribuicaoRestante?.valor_parcelado_centavos,
  ])

  // Fora do cartão: sem juros / parcelas da maquininha.
  useEffect(() => {
    if (restandoEhCartao) return
    setJurosRepassados(false)
    setParcelasQtd('1')
  }, [restandoEhCartao])

  function aplicarFormaRestante(valor: FormaRestante | '') {
    setPagamentoManual(true)
    setFormaRestante(valor)
  }

  function aplicarPlano(chave: string) {
    setPlanoChave(chave)
    setPagamentoManual(false)
    if (!chave) {
      setLinhas([])
      setBaseline([])
      return
    }
    const [tipo, id] = chave.split(':')
    if (tipo === 'botox') {
      const plano = planosBotox.find((p) => p.id === id)
      if (!plano) return
      const montadas = montarLinhasBotox(plano.itens, precos)
      setLinhas(comIdLocal(montadas, `botox-${id}`))
      setBaseline(
        montadas.map((l) => ({
          ordem: l.ordem,
          planejado_qtd: l.planejado_qtd,
          planejado_centavos: l.planejado_centavos,
        })),
      )
      const proc =
        montadas.find((l) => l.procedimento_id)?.procedimento_id ??
        procedimentos[0]?.id ??
        ''
      if (proc) {
        setProcedimentoId(proc)
        setDias(padraoDoProcedimento(procedimentos, proc).dias)
      }
      return
    }
    if (tipo === 'filler') {
      const plano = planosFiller.find((p) => p.id === id)
      if (!plano) return
      const montadas = montarLinhasFiller(plano.itens, precos)
      setLinhas(comIdLocal(montadas, `filler-${id}`))
      setBaseline(
        montadas.map((l) => ({
          ordem: l.ordem,
          planejado_qtd: l.planejado_qtd,
          planejado_centavos: l.planejado_centavos,
        })),
      )
      const proc =
        montadas.find((l) => l.procedimento_id)?.procedimento_id ??
        procedimentos[0]?.id ??
        ''
      if (proc) {
        setProcedimentoId(proc)
        setDias(padraoDoProcedimento(procedimentos, proc).dias)
      }
    }
  }

  function atualizarFeito(idLocal: string, feitoTexto: string) {
    const n = lerQtd(feitoTexto)
    setLinhas((prev) =>
      prev.map((linha) =>
        linha.idLocal === idLocal ? { ...aplicarFeito(linha, n), idLocal, doPlano: linha.doPlano } : linha,
      ),
    )
    setPagamentoManual(false)
  }

  function atualizarRotulo(idLocal: string, rotulo: string) {
    setLinhas((prev) =>
      prev.map((linha) => (linha.idLocal === idLocal ? { ...linha, rotulo } : linha)),
    )
  }

  function atualizarProcedimentoLinha(idLocal: string, procedimentoEscolhido: string) {
    const preco = procedimentoEscolhido ? (precos.get(procedimentoEscolhido) ?? 0) : 0
    setLinhas((prev) =>
      prev.map((linha) => {
        if (linha.idLocal !== idLocal) return linha
        const base: LinhaExecucao = {
          ...linha,
          procedimento_id: procedimentoEscolhido || null,
          preco_centavos: preco,
        }
        const comFeito = aplicarFeito(base, linha.feito_qtd)
        const comPlanejado = aplicarFeito(base, linha.planejado_qtd)
        return {
          ...comFeito,
          planejado_qtd: linha.planejado_qtd,
          planejado_centavos: comPlanejado.feito_centavos,
          idLocal,
          doPlano: linha.doPlano,
        }
      }),
    )
    setPagamentoManual(false)
  }

  function removerLinha(idLocal: string) {
    if (!window.confirm(MSG_REMOVER)) return
    setLinhas((prev) => prev.filter((l) => l.idLocal !== idLocal))
    setPagamentoManual(false)
  }

  function adicionarLinhaExtra() {
    if (!window.confirm(MSG_ADICIONAR)) return
    sequenciaExtra.current += 1
    const ordem =
      linhas.reduce((max, l) => Math.max(max, l.ordem), -1) + 1
    const procPadrao = procedimentoId || procedimentos[0]?.id || ''
    const preco = procPadrao ? (precos.get(procPadrao) ?? 0) : 0
    const extra = criarLinhaExtra({
      ordem,
      unidade: unidadeDoPlano,
      procedimento_id: procPadrao || null,
      preco_centavos: preco,
      feito_qtd: 0,
      rotulo: '',
    })
    setLinhas((prev) => [
      ...prev,
      {
        ...extra,
        idLocal: `${idGerador}-extra-${sequenciaExtra.current}`,
        doPlano: false,
      },
    ])
    setPagamentoManual(false)
  }

  function limpar() {
    setOrigem('avulso')
    setPlanoChave('')
    setLinhas([])
    setBaseline([])
    setProcedimentoId('')
    setConsultaId('')
    setRegiaoTratada('')
    setQuantidade('')
    setProduto('')
    setLote('')
    setObservacoes('')
    setTermoAssinado(false)
    setDias('')
    setData('')
    setSemRetorno(false)
    setIncluirPagamento(false)
    setTotalTexto('')
    setEntradaTexto('')
    setFormaEntrada('')
    setFormaRestante('')
    setProximaTexto('0,00')
    setParceladoTexto('0,00')
    setParcelasQtd('1')
    setPrimeiroVencimento(maisUmMes(hojeISO))
    setJurosRepassados(false)
    setPagamentoManual(false)
  }

  if (procedimentos.length === 0) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-lg">
            {editando ? 'Atendimento' : 'Novo atendimento'}
          </h2>
          {onVoltar ? (
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onVoltar}>
              Voltar
            </button>
          ) : null}
        </div>
        <p className="rounded-xl border border-linha p-4 text-sm text-texto/60">
          Cadastre ao menos um procedimento ativo no catálogo antes de registrar atendimento.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg">
            {editando
              ? somenteLeitura
                ? 'Consultar atendimento'
                : 'Editar atendimento'
              : 'Novo atendimento'}
          </h2>
          <p className="text-sm text-texto/60">
            {editando
              ? retornoTravado
                ? 'Clínica, execução e pagamento. Retorno e lembretes ficam como no registro original.'
                : 'O que foi feito e o pagamento deste atendimento.'
              : 'O que foi feito hoje e quando esta paciente volta. Salva ao clicar em Registrar.'}
          </p>
        </div>
        {onVoltar ? (
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onVoltar}>
            Voltar
          </button>
        ) : null}
      </div>

      {erro && (
        <p
          ref={alertaRef}
          role="alert"
          className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      {confirmacao && (
        <p
          role="status"
          className="rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
        >
          {confirmacao}
        </p>
      )}

      <form
        onSubmit={(evento) => {
          evento.preventDefault()
          if (bloqueado) return
          setErro(null)
          setConfirmacao(null)

          if (origem === 'plano' && !planoChave) {
            setErro('Escolha um plano ou mude para atendimento avulso.')
            return
          }
          if (origem === 'plano' && linhas.length === 0 && baseline.length === 0) {
            setErro('Este plano não tem linhas para executar. Inclua uma linha extra ou escolha outro plano.')
            return
          }
          if (origem === 'plano' && linhas.length === 0) {
            setErro(
              'Nenhuma linha neste atendimento. Remova o plano, inclua uma linha extra, ou mantenha ao menos o que foi feito.',
            )
            return
          }
          if (origem === 'plano') {
            const extraSemProc = linhas.find((l) => !l.doPlano && !l.procedimento_id)
            if (extraSemProc) {
              setErro('Nas linhas extras, escolha o procedimento.')
              return
            }
          }
          if (!procedimentoId) {
            setErro('Escolha o procedimento realizado.')
            return
          }
          if (incluirPagamento && alertaPagamento) {
            setErro(alertaPagamento)
            return
          }

          iniciarTransicao(async () => {
            try {
              const [tipoPlano, idPlano] = planoChave ? planoChave.split(':') : [null, null]
              const payloadExecucao =
                origem === 'plano'
                  ? {
                      execucaoItens: linhas.map((l) => ({
                        ordem: l.ordem,
                        rotulo: l.rotulo,
                        unidade: l.unidade,
                        procedimento_id: l.procedimento_id || null,
                        preco_centavos: l.preco_centavos,
                        planejado_qtd: l.planejado_qtd,
                        feito_qtd: l.feito_qtd,
                      })),
                      execucaoBaseline: baseline,
                    }
                  : {}

              const payloadCobranca = incluirPagamento
                ? {
                    valor_total_centavos: totalCentavos,
                    valor_entrada_centavos: entradaCentavos,
                    valor_proxima_consulta_centavos: proximaCentavos,
                    valor_parcelado_centavos: parceladoCentavos,
                    parcelas_qtd: parceladoCentavos > 0 ? qtdParcelas : undefined,
                    juros_maquininha_centavos: restandoEhCartao ? jurosCentavos : 0,
                    juros_repassados_ao_cliente: restandoEhCartao && jurosRepassados,
                    forma_entrada: formaEntrada || null,
                    forma_restante: formaRestante || null,
                    primeiro_vencimento:
                      restandoEhCartao && parceladoCentavos > 0
                        ? primeiroVencimento
                        : undefined,
                  }
                : null

              if (editando && atendimentoInicial) {
                const resultado = await atualizarAtendimento({
                  atendimentoId: atendimentoInicial.id,
                  pacienteId,
                  procedimentoId,
                  consultaId: consultaId || null,
                  regiaoTratada,
                  quantidade: origem === 'plano' ? (quantidadeAuto ?? '') : quantidade,
                  produto,
                  lote,
                  observacoes,
                  termoAssinado,
                  ...payloadExecucao,
                  cobranca: payloadCobranca,
                })

                if (!resultado.ok) {
                  setErro(resultado.erro)
                  return
                }

                setConfirmacao('Atendimento atualizado.')
                onSalvo?.()
                return
              }

              const resultado = await registrarAtendimento({
                pacienteId,
                procedimentoId,
                consultaId: consultaId || null,
                regiaoTratada,
                quantidade: origem === 'plano' ? (quantidadeAuto ?? '') : quantidade,
                produto,
                lote,
                observacoes,
                termoAssinado,
                ajusteDias: semRetorno ? null : ajusteDias,
                ajusteData: semRetorno || !data ? null : data,
                semRetorno,
                botoxPlanId: origem === 'plano' && tipoPlano === 'botox' ? idPlano : null,
                fillerPlanId: origem === 'plano' && tipoPlano === 'filler' ? idPlano : null,
                ...payloadExecucao,
                cobranca: payloadCobranca,
              })

              if (!resultado.ok) {
                setErro(resultado.erro)
                return
              }

              setConfirmacao(
                resultado.vencimento
                  ? `Atendimento registrado. Retorno previsto para ${formatarDataExtensaComAno(resultado.vencimento)}.`
                  : 'Atendimento registrado. Esta paciente não tem retorno previsto.',
              )
              limpar()
              onSalvo?.()
            } catch {
              setErro(
                editando
                  ? 'Não foi possível salvar. Verifique a conexão e tente de novo.'
                  : 'Não foi possível registrar. Verifique a conexão e tente de novo.',
              )
            }
          })
        }}
        className="space-y-4 rounded-xl border border-linha p-4"
      >
        <fieldset className="space-y-3 rounded-lg border border-linha p-3" disabled={bloqueado}>
          <legend className="px-1 text-sm text-texto/80">Origem</legend>
          {origemTravada ? (
            <p className="text-sm text-texto/70">
              {origem === 'plano'
                ? 'A partir de um plano (não dá para trocar a origem depois de registrado).'
                : 'Avulso (não dá para trocar a origem depois de registrado).'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="origem"
                  checked={origem === 'avulso'}
                  onChange={() => {
                    setOrigem('avulso')
                    setPlanoChave('')
                    setLinhas([])
                    setBaseline([])
                    setPagamentoManual(false)
                  }}
                  className="size-4 accent-acento"
                />
                Avulso
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="origem"
                  checked={origem === 'plano'}
                  disabled={!temPlanos}
                  onChange={() => setOrigem('plano')}
                  className="size-4 accent-acento disabled:opacity-50"
                />
                A partir de um plano
                {!temPlanos ? (
                  <span className="text-xs text-texto/50">(nenhum plano nesta ficha)</span>
                ) : null}
              </label>
            </div>
          )}

          {origem === 'plano' ? (
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Plano</span>
              <select
                name="plano"
                required
                value={planoChave}
                disabled={origemTravada || bloqueado}
                onChange={(e) => aplicarPlano(e.target.value)}
                className={`${CAMPO} disabled:opacity-50`}
              >
                <option value="" disabled>
                  Escolha o plano
                </option>
                {planosBotox.map((p) => (
                  <option key={`botox:${p.id}`} value={`botox:${p.id}`}>
                    Toxina · {p.rotulo}
                  </option>
                ))}
                {planosFiller.map((p) => (
                  <option key={`filler:${p.id}`} value={`filler:${p.id}`}>
                    Preenchimento · {p.rotulo}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>

        {origem === 'plano' && planoChave ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {statusPlano ? (
                  <span
                    className={
                      statusPlano === 'completo'
                        ? 'rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300'
                        : 'rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-300'
                    }
                  >
                    {statusPlano === 'completo' ? 'Completo' : 'Parcial'}
                  </span>
                ) : null}
                {totais ? (
                  <span className="text-sm text-texto/70">
                    Planejado {formatarMoeda(totais.planejado_centavos)} · Feito{' '}
                    {formatarMoeda(totais.feito_centavos)}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className={BOTAO_SECUNDARIO}
                onClick={adicionarLinhaExtra}
                disabled={pendente || bloqueado}
              >
                + Linha
              </button>
            </div>

            <p className="text-xs text-texto/50">
              Remover ou incluir linha afeta só este atendimento — o plano na ficha não muda.
            </p>

            <div className="overflow-x-auto rounded-lg border border-linha">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="border-b border-linha text-xs text-texto/60">
                  <tr>
                    <th className="px-3 py-2 font-medium">Linha</th>
                    <th className="px-3 py-2 font-medium">Planejado</th>
                    <th className="px-3 py-2 font-medium">Feito</th>
                    <th className="px-3 py-2 font-medium">Procedimento</th>
                    <th className="px-3 py-2 font-medium text-right">R$</th>
                    <th className="px-3 py-2 font-medium">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-sm text-texto/60">
                        Nenhuma linha neste atendimento. Use &ldquo;+ Linha&rdquo; para registrar
                        o que foi feito além do plano, ou escolha outro plano.
                      </td>
                    </tr>
                  ) : (
                    linhas.map((linha) => (
                      <tr key={linha.idLocal} className="border-b border-linha/60 last:border-0">
                        <td className="px-3 py-2">
                          {linha.doPlano ? (
                            <span>{linha.rotulo || '—'}</span>
                          ) : (
                            <input
                              type="text"
                              aria-label="Rótulo da linha extra"
                              placeholder="Opcional (ex.: músculo)"
                              value={linha.rotulo}
                              disabled={bloqueado}
                              onChange={(e) => atualizarRotulo(linha.idLocal, e.target.value)}
                              className={`${CAMPO} min-w-[8rem]`}
                            />
                          )}
                          {!linha.doPlano ? (
                            <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-texto/45">
                              Extra
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-texto/70">
                          {linha.planejado_qtd} {linha.unidade === 'U' ? 'U' : 'mL'}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Feito — ${linha.rotulo || 'linha'}`}
                            value={formatarQtd(linha.feito_qtd)}
                            disabled={bloqueado}
                            onChange={(e) => atualizarFeito(linha.idLocal, e.target.value)}
                            className={`${CAMPO} max-w-[6rem]`}
                          />
                        </td>
                        <td className="px-3 py-2 text-texto/70">
                          {linha.doPlano ? (
                            nomeProcedimento(procedimentos, linha.procedimento_id)
                          ) : (
                            <select
                              aria-label="Procedimento da linha extra"
                              value={linha.procedimento_id ?? ''}
                              disabled={bloqueado}
                              onChange={(e) =>
                                atualizarProcedimentoLinha(linha.idLocal, e.target.value)
                              }
                              className={CAMPO}
                              required
                            >
                              <option value="" disabled>
                                Escolha
                              </option>
                              {procedimentos.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nome}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatarMoeda(linha.feito_centavos)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className={BOTAO_PERIGO}
                            onClick={() => removerLinha(linha.idLocal)}
                            disabled={pendente || bloqueado}
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={bloqueado}>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Procedimento realizado</span>
            <select
              name="procedimento"
              required
              value={procedimentoId}
              onChange={(evento) => {
                const id = evento.target.value
                setProcedimentoId(id)
                if (!retornoTravado) {
                  setDias(padraoDoProcedimento(procedimentos, id).dias)
                }
              }}
              className={CAMPO}
            >
              <option value="" disabled>
                Escolha o procedimento
              </option>
              {procedimentos.map((procedimento) => (
                <option key={procedimento.id} value={procedimento.id}>
                  {procedimento.nome}
                </option>
              ))}
            </select>
            {origem === 'plano' ? (
              <span className="block text-xs text-texto/50">
                Pré-preenchido pela 1ª linha do plano (retorno e lembretes).
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Consulta da agenda (opcional)</span>
            <select
              name="consulta"
              value={consultaId}
              onChange={(evento) => setConsultaId(evento.target.value)}
              className={CAMPO}
            >
              <option value="">Sem vínculo com a agenda</option>
              {consultas.map((consulta) => (
                <option key={consulta.id} value={consulta.id}>
                  {consulta.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Região tratada</span>
            <input
              name="regiao"
              value={regiaoTratada}
              onChange={(evento) => setRegiaoTratada(evento.target.value)}
              placeholder="Terço superior, malar direito…"
              className={CAMPO}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Quantidade</span>
            {origem === 'plano' ? (
              <p className="rounded-lg border border-linha px-3 py-2 text-sm text-texto/80">
                {quantidadeAuto || '—'}
                <span className="mt-0.5 block text-xs text-texto/50">
                  Resumo automático das linhas feitas.
                </span>
              </p>
            ) : (
              <input
                name="quantidade"
                value={quantidade}
                onChange={(evento) => setQuantidade(evento.target.value)}
                placeholder="20 U, 1,5 ml…"
                className={CAMPO}
              />
            )}
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Produto utilizado</span>
            <input
              name="produto"
              value={produto}
              onChange={(evento) => setProduto(evento.target.value)}
              placeholder="Nome comercial / marca"
              className={CAMPO}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Lote</span>
            <input
              name="lote"
              value={lote}
              onChange={(evento) => setLote(evento.target.value)}
              placeholder="Lote ou nº de série"
              className={CAMPO}
            />
          </label>
        </fieldset>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">
            Evolução / intercorrências / observações
          </span>
          <textarea
            name="observacoes"
            rows={3}
            value={observacoes}
            disabled={bloqueado}
            onChange={(evento) => setObservacoes(evento.target.value)}
            className={CAMPO}
          />
        </label>

        <label className="flex items-start gap-2 text-sm text-texto/80">
          <input
            name="termoAssinado"
            type="checkbox"
            checked={termoAssinado}
            disabled={bloqueado}
            onChange={(evento) => setTermoAssinado(evento.target.checked)}
            className="mt-0.5 size-4 accent-acento"
          />
          <span>
            Termo de consentimento lido e assinado em papel.
            <span className="block text-xs text-texto/50">
              O scan do termo vai na aba Pasta. Assinatura ICP-Brasil fica fora desta entrega.
            </span>
          </span>
        </label>

        <fieldset className="space-y-3 rounded-lg border border-linha p-3" disabled={bloqueado}>
          <legend className="px-1 text-sm text-texto/80">Pagamento</legend>
          <label className="flex items-center gap-2 text-sm text-texto/80">
            <input
              type="checkbox"
              checked={incluirPagamento}
              disabled={bloqueado || (editando && cobrancaIni != null)}
              onChange={(e) => {
                const on = e.target.checked
                setIncluirPagamento(on)
                if (on && !pagamentoManual && totais) {
                  setTotalTexto(campoCentavos(totais.feito_centavos))
                  setEntradaTexto(campoCentavos(totais.feito_centavos))
                }
              }}
              className="size-4 accent-acento"
            />
            Registrar cobrança neste atendimento
            {editando && cobrancaIni != null ? (
              <span className="text-xs text-texto/50">(já existe — edite os valores abaixo)</span>
            ) : null}
          </label>

          {incluirPagamento ? (
            <div className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-sm text-texto/80">Total (R$)</span>
                  <input
                    value={totalTexto}
                    onChange={(e) => {
                      setPagamentoManual(true)
                      setTotalTexto(mascararMoedaAoDigitar(e.target.value))
                    }}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={CAMPO}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-texto/80">Entrada (R$)</span>
                  <input
                    value={entradaTexto}
                    onChange={(e) => {
                      setPagamentoManual(true)
                      setEntradaTexto(mascararMoedaAoDigitar(e.target.value))
                    }}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={CAMPO}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-texto/80">Forma da entrada</span>
                  <select
                    value={formaEntrada}
                    onChange={(e) => setFormaEntrada(e.target.value as FormaEntrada | '')}
                    className={CAMPO}
                  >
                    <option value="">Não informado</option>
                    {FORMAS_ENTRADA.map((f) => (
                      <option key={f.valor} value={f.valor}>
                        {f.rotulo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-texto/80">Forma do restante</span>
                  <select
                    value={formaRestante}
                    onChange={(e) =>
                      aplicarFormaRestante(e.target.value as FormaRestante | '')
                    }
                    className={CAMPO}
                  >
                    <option value="">Não informado</option>
                    {FORMAS_RESTANTE.map((f) => (
                      <option key={f.valor} value={f.valor}>
                        {f.rotulo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-texto/80">Próxima consulta (R$)</span>
                  <input
                    value={proximaTexto}
                    readOnly
                    inputMode="decimal"
                    placeholder="0,00"
                    className={`${CAMPO} bg-linha/20 text-texto/80`}
                    aria-describedby={`${idGerador}-proxima-ajuda`}
                    title={
                      restandoEhCartao
                        ? 'No cartão o restante vai para o parcelado (próxima fica zerada)'
                        : 'Calculado automaticamente: total − entrada (restante em PIX)'
                    }
                  />
                </label>
                {restandoEhCartao ? (
                  <>
                    <label className="block space-y-1">
                      <span className="text-sm text-texto/80">Parcelado (R$)</span>
                      <input
                        value={parceladoTexto}
                        readOnly
                        inputMode="decimal"
                        placeholder="0,00"
                        className={`${CAMPO} bg-linha/20 text-texto/80`}
                        title="Restante após a entrada — parcelado no cartão"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-sm text-texto/80">Nº de parcelas</span>
                      <select
                        value={String(qtdParcelas)}
                        disabled={parceladoCentavos <= 0 || parcelasTravadas}
                        onChange={(e) => {
                          setPagamentoManual(true)
                          setParcelasQtd(e.target.value)
                        }}
                        className={`${CAMPO} disabled:opacity-50`}
                      >
                        {Array.from({ length: MAX_PARCELAS_MAQUININHA }, (_, i) => i + 1).map(
                          (n) => (
                            <option key={n} value={n}>
                              {n}×
                              {taxaMaquininhaPercentual(n, 'credito') != null
                                ? ` · ${String(taxaMaquininhaPercentual(n, 'credito')).replace('.', ',')}%`
                                : ''}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    {parceladoCentavos > 0 ? (
                      <label className="block space-y-1">
                        <span className="text-sm text-texto/80">1ª parcela em</span>
                        <input
                          type="date"
                          value={primeiroVencimento}
                          disabled={parcelasTravadas}
                          onChange={(e) => setPrimeiroVencimento(e.target.value)}
                          className={`${CAMPO} disabled:opacity-50`}
                        />
                      </label>
                    ) : null}
                    <label className="block space-y-1">
                      <span className="text-sm text-texto/80">Juros maquininha (R$)</span>
                      <input
                        value={campoCentavos(jurosCentavos)}
                        readOnly
                        inputMode="decimal"
                        className={`${CAMPO} bg-linha/20 text-texto/80`}
                        title={
                          taxaPercentual != null
                            ? `Taxa crédito ${qtdParcelas}×: ${String(taxaPercentual).replace('.', ',')}% sobre o restante no cartão`
                            : 'Calculado pela taxa da maquininha'
                        }
                      />
                    </label>
                  </>
                ) : null}
              </div>

              {restandoEhCartao ? (
                <label className="flex items-center gap-2 text-sm text-texto/80">
                  <input
                    type="checkbox"
                    checked={jurosRepassados}
                    onChange={(e) => {
                      setPagamentoManual(true)
                      setJurosRepassados(e.target.checked)
                    }}
                    className="size-4 accent-acento"
                  />
                  Juros repassados ao cliente
                </label>
              ) : null}

              {restandoEhCartao && taxaPercentual != null ? (
                <p className="text-xs text-texto/50">
                  Taxa crédito {qtdParcelas}×: {String(taxaPercentual).replace('.', ',')}%
                  {jurosRepassados
                    ? ' — valor no cartão inclui gross-up para a clínica liquidar o clínico.'
                    : ' — custo da maquininha (clínica absorve); marque repasse para cobrar da paciente.'}
                </p>
              ) : null}

              <p id={`${idGerador}-proxima-ajuda`} className="text-xs text-texto/50">
                {restandoEhCartao
                  ? 'A entrada de hoje e o parcelado no cartão precisam somar o total do atendimento'
                  : 'A entrada de hoje e o que fica para a próxima (PIX) precisam somar o total do atendimento'}
                {restandoEhCartao && jurosRepassados ? ' (com os juros repassados)' : ''}. O
                restante preenche sozinho conforme a forma escolhida.
              </p>

              {alertaPagamento ? (
                <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
                  {alertaPagamento}
                </p>
              ) : null}

              {parcelasTravadas ? (
                <p className="text-xs text-texto/50">
                  Há parcela já paga — a grade de parcelas não é regenerada. Valores de
                  entrada/total/próxima ainda podem ser ajustados; baixas ficam no Financeiro.
                </p>
              ) : null}

              {previewParcelas.length > 0 ? (
                <ul className="rounded-lg border border-linha p-3 text-xs text-texto/70">
                  {previewParcelas.map((p) => (
                    <li key={p.numero}>
                      Parcela {p.numero}: {formatarMoeda(p.valor_centavos)} · vence{' '}
                      {formatarDataExtensaComAno(p.vencimento)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <fieldset
          className="space-y-3 rounded-lg border border-linha p-3"
          disabled={bloqueado || retornoTravado}
        >
          <legend className="px-1 text-sm text-texto/80">Retorno</legend>
          {retornoTravado ? (
            <p className="text-xs text-texto/50">
              Retorno e lembretes automáticos ficam como no registro original. Mudar a data
              depois criaria conflito com jobs já enfileirados (chave sem a data nova).
            </p>
          ) : (
            <p className="text-xs text-texto/50">
              Os controles valem de baixo para cima: a data escolhida vence o intervalo em dias, e
              &ldquo;não precisa de retorno&rdquo; vence os dois.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Retornar em (dias)</span>
              <input
                name="dias"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={dias}
                disabled={semRetorno || retornoTravado}
                onChange={(evento) => setDias(evento.target.value)}
                className={`${CAMPO} disabled:opacity-50`}
              />
              <span className="block text-xs text-texto/50">
                {padraoDias == null
                  ? 'Este procedimento não tem retorno padrão no catálogo.'
                  : `Padrão do catálogo: ${padraoDias} dias.`}
              </span>
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Ou escolher a data</span>
              <input
                name="data"
                type="date"
                value={data}
                disabled={semRetorno || retornoTravado}
                onChange={(evento) => setData(evento.target.value)}
                className={`${CAMPO} disabled:opacity-50`}
              />
              <span className="block text-xs text-texto/50">
                Preenchida, esta data vence o intervalo em dias.
              </span>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-texto/80">
            <input
              name="semRetorno"
              type="checkbox"
              checked={semRetorno}
              disabled={retornoTravado}
              onChange={(evento) => setSemRetorno(evento.target.checked)}
              className="size-4 accent-acento"
            />
            Esta paciente não precisa de retorno
          </label>

          <p aria-live="polite" className="text-sm">
            {previsto ? (
              <>
                Retorno previsto:{' '}
                <strong className="font-medium">
                  {formatarDataExtensaComAno(dataDoDiaDeCalendario(previsto))}
                </strong>
              </>
            ) : (
              <span className="text-texto/60">Sem retorno previsto — não entra na fila.</span>
            )}
          </p>
        </fieldset>

        {!bloqueado ? (
          <button type="submit" disabled={pendente || !procedimentoId} className={BOTAO_PRINCIPAL}>
            {pendente
              ? editando
                ? 'Salvando…'
                : 'Registrando…'
              : editando
                ? 'Salvar alterações'
                : 'Registrar atendimento'}
          </button>
        ) : null}
      </form>
    </section>
  )
}
