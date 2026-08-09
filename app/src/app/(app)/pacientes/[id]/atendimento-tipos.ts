/**
 * Tipos do registro de atendimento (plano + execução + cobrança).
 * Fora de `'use server'` — constantes/tipos quebram o build nesses arquivos.
 */

import type {
  FormaEntrada,
  FormaRestante,
  StatusCobranca,
  StatusParcela,
} from '@/domain/finance/cobranca'
import type { UnidadeExecucao } from '@/domain/clinical/atendimento-execucao'

export type OrigemAtendimento = 'avulso' | 'plano'

export type ItemExecucaoEntrada = {
  ordem: number
  rotulo: string
  unidade: UnidadeExecucao
  procedimento_id: string | null
  preco_centavos: number
  planejado_qtd: number
  feito_qtd: number
}

/**
 * Snapshot do plano ao carregar a tabela.
 * `ordem` + `planejado_qtd` → status parcial se remover / reduzir.
 * `planejado_centavos` opcional no wire (UI congela Planejado R$ localmente).
 */
export type BaselineExecucaoEntrada = {
  ordem: number
  planejado_qtd: number
  planejado_centavos?: number
}

export type CobrancaEntrada = {
  valor_total_centavos: number
  valor_entrada_centavos: number
  valor_proxima_consulta_centavos: number
  valor_parcelado_centavos: number
  parcelas_qtd?: number
  juros_maquininha_centavos: number
  juros_repassados_ao_cliente: boolean
  forma_entrada?: FormaEntrada | null
  /** PIX (próxima) ou cartão (parcelado). Null = não informado. */
  forma_restante?: FormaRestante | null
  /** YYYY-MM-DD — 1ª parcela; demais +1 mês. Obrigatório se parcelado > 0. */
  primeiro_vencimento?: string
}

export type FormaEntradaOpcao = FormaEntrada

export type StatusCobrancaLista = StatusCobranca

/** Resumo de cobrança na lista de atendimentos. */
export type ResumoCobrancaLista = {
  valor_total_centavos: number
  valor_entrada_centavos: number
  status: StatusCobranca
} | null

export type ExecucaoStatusLista = 'completo' | 'parcial' | 'nao_aplicavel'

/** Linha de execução já gravada (editor / carga da ficha). */
export type ItemExecucaoSalvo = {
  id: string
  ordem: number
  rotulo: string
  unidade: UnidadeExecucao
  procedimento_id: string | null
  preco_centavos: number
  planejado_qtd: number
  feito_qtd: number
  planejado_centavos: number
  feito_centavos: number
}

export type ParcelaCobrancaSalva = {
  id: string
  numero: number
  valor_centavos: number
  vencimento: string
  pago_em: string | null
  status: StatusParcela
}

/** Cobrança 1:1 com o atendimento, quando existir. */
export type CobrancaSalva = {
  id: string
  valor_total_centavos: number
  valor_entrada_centavos: number
  valor_proxima_consulta_centavos: number
  valor_parcelado_centavos: number
  parcelas_qtd: number
  juros_maquininha_centavos: number
  juros_repassados_ao_cliente: boolean
  forma_entrada: FormaEntrada | null
  forma_restante: FormaRestante | null
  status: StatusCobranca
  parcelas: ParcelaCobrancaSalva[]
}

/**
 * Atendimento completo para galeria + editor.
 * Retorno fica gravado; na edição clínica o formulário não altera lembretes.
 */
export type AtendimentoCompleto = {
  id: string
  realizado_em: string
  procedure_id: string
  appointment_id: string | null
  regiao_tratada: string | null
  quantidade: string | null
  produto: string | null
  lote: string | null
  observacoes: string | null
  termo_assinado: boolean
  retorno_vencimento: string | null
  sem_retorno: boolean
  retorno_ajuste_dias: number | null
  retorno_data: string | null
  execucao_status: ExecucaoStatusLista
  botox_plan_id: string | null
  filler_plan_id: string | null
  procedures: { nome: string } | null
  itens: ItemExecucaoSalvo[]
  cobranca: CobrancaSalva | null
}
