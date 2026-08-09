/**
 * Execução clínica de um atendimento a partir de um plano (toxina/filler).
 *
 * Puro: sem I/O. Reusa `centavosLinhaToxina` / `centavosLinhaFiller` /
 * `somarCentavos` de planos-calc para o preço do catálogo no momento do registro.
 */

import {
  centavosLinhaFiller,
  centavosLinhaToxina,
  somarCentavos,
} from '@/domain/clinical/planos-calc'

export type UnidadeExecucao = 'U' | 'ml'

/** Status quando o atendimento veio de um plano. Avulso usa `nao_aplicavel` no banco. */
export type StatusExecucaoPlano = 'completo' | 'parcial'

export type LinhaExecucao = {
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

export type ItemPlanoBotoxEntrada = {
  musculo: string
  quantidade_unidades?: number | null
  total_unidades?: number | null
  procedimento_id: string | null
  ordem?: number
}

export type ItemPlanoFillerEntrada = {
  produto: string
  quantidade_ml?: number | null
  procedimento_id: string | null
  ordem?: number
}

export type PrecoCatalogo = { id: string; preco_centavos: number }

function mapaPrecos(
  catalogo: ReadonlyMap<string, number> | ReadonlyArray<PrecoCatalogo>,
): Map<string, number> {
  if (catalogo instanceof Map) return new Map(catalogo)
  const m = new Map<string, number>()
  for (const p of catalogo as ReadonlyArray<PrecoCatalogo>) {
    m.set(p.id, p.preco_centavos)
  }
  return m
}

function qtdNaoNegativa(valor: number | null | undefined): number {
  if (valor == null || !Number.isFinite(valor) || valor < 0) return 0
  return valor
}

/**
 * Monta linhas de execução a partir do plano de toxina.
 * Default: `feito_qtd = planejado_qtd` (assumir completo; a Dra. reduz se parcial).
 */
export function montarLinhasBotox(
  itens: ReadonlyArray<ItemPlanoBotoxEntrada>,
  catalogo: ReadonlyMap<string, number> | ReadonlyArray<PrecoCatalogo>,
): LinhaExecucao[] {
  const precos = mapaPrecos(catalogo)
  return itens.map((item, idx) => {
    const planejado = qtdNaoNegativa(item.total_unidades ?? item.quantidade_unidades)
    const procedimentoId = item.procedimento_id || null
    const preco = procedimentoId ? (precos.get(procedimentoId) ?? 0) : 0
    const planejadoCentavos = centavosLinhaToxina(planejado, preco)
    return {
      ordem: item.ordem ?? idx,
      rotulo: (item.musculo ?? '').trim(),
      unidade: 'U' as const,
      procedimento_id: procedimentoId,
      preco_centavos: preco,
      planejado_qtd: planejado,
      feito_qtd: planejado,
      planejado_centavos: planejadoCentavos,
      feito_centavos: planejadoCentavos,
    }
  })
}

/**
 * Monta linhas de execução a partir do plano de preenchimento.
 * Default: `feito_qtd = planejado_qtd`.
 */
export function montarLinhasFiller(
  itens: ReadonlyArray<ItemPlanoFillerEntrada>,
  catalogo: ReadonlyMap<string, number> | ReadonlyArray<PrecoCatalogo>,
): LinhaExecucao[] {
  const precos = mapaPrecos(catalogo)
  return itens.map((item, idx) => {
    const planejado = qtdNaoNegativa(item.quantidade_ml)
    const procedimentoId = item.procedimento_id || null
    const preco = procedimentoId ? (precos.get(procedimentoId) ?? 0) : 0
    const planejadoCentavos = centavosLinhaFiller(planejado, preco)
    return {
      ordem: item.ordem ?? idx,
      rotulo: (item.produto ?? '').trim(),
      unidade: 'ml' as const,
      procedimento_id: procedimentoId,
      preco_centavos: preco,
      planejado_qtd: planejado,
      feito_qtd: planejado,
      planejado_centavos: planejadoCentavos,
      feito_centavos: planejadoCentavos,
    }
  })
}

/**
 * Atualiza `feito_qtd` (e centavos) de uma linha. Quantidade inválida → 0.
 */
export function aplicarFeito(
  linha: LinhaExecucao,
  feitoQtd: number | null | undefined,
): LinhaExecucao {
  const feito = qtdNaoNegativa(feitoQtd)
  const feitoCentavos =
    linha.unidade === 'U'
      ? centavosLinhaToxina(feito, linha.preco_centavos)
      : centavosLinhaFiller(feito, linha.preco_centavos)
  return { ...linha, feito_qtd: feito, feito_centavos: feitoCentavos }
}

/**
 * Completo se toda linha com `planejado_qtd > 0` tem `feito_qtd >= planejado_qtd`.
 * Linhas com planejado 0 (extras deste atendimento) são ignoradas.
 * Sem linhas relevantes → completo.
 *
 * Com `baseline` (snapshot do plano ao carregar): linha planejada ausente
 * ou com feito menor que o planejado original → parcial. Remover linha do
 * atendimento não mexe no plano; só marca a execução como parcial.
 */
export function statusExecucao(
  linhas: ReadonlyArray<Pick<LinhaExecucao, 'planejado_qtd' | 'feito_qtd' | 'ordem'>>,
  baseline?: ReadonlyArray<Pick<LinhaExecucao, 'planejado_qtd' | 'ordem'>>,
): StatusExecucaoPlano {
  if (baseline && baseline.length > 0) {
    const porOrdem = new Map(linhas.map((l) => [l.ordem, l]))
    for (const orig of baseline) {
      const planejado = qtdNaoNegativa(orig.planejado_qtd)
      if (planejado <= 0) continue
      const atual = porOrdem.get(orig.ordem)
      if (!atual || qtdNaoNegativa(atual.feito_qtd) < planejado) {
        return 'parcial'
      }
    }
  }

  const relevantes = linhas.filter((l) => {
    const p = l.planejado_qtd
    return p != null && Number.isFinite(p) && p > 0
  })
  if (relevantes.length === 0) {
    // Baseline tinha trabalho planejado e sumiu tudo → já retornou parcial acima.
    // Só extras (planejado 0) ou lista vazia sem baseline → completo.
    return 'completo'
  }
  const todas = relevantes.every((l) => qtdNaoNegativa(l.feito_qtd) >= l.planejado_qtd)
  return todas ? 'completo' : 'parcial'
}

/**
 * Linha feita além do plano neste atendimento. `planejado_qtd = 0`.
 * Não altera botox_plans / filler_plans.
 */
export function criarLinhaExtra(entrada: {
  ordem: number
  unidade: UnidadeExecucao
  procedimento_id?: string | null
  preco_centavos?: number
  rotulo?: string
  feito_qtd?: number
}): LinhaExecucao {
  const procedimentoId = entrada.procedimento_id || null
  const preco = Math.max(0, entrada.preco_centavos ?? 0)
  const base: LinhaExecucao = {
    ordem: entrada.ordem,
    rotulo: (entrada.rotulo ?? '').trim(),
    unidade: entrada.unidade,
    procedimento_id: procedimentoId,
    preco_centavos: preco,
    planejado_qtd: 0,
    feito_qtd: 0,
    planejado_centavos: 0,
    feito_centavos: 0,
  }
  return aplicarFeito(base, entrada.feito_qtd ?? 0)
}

/**
 * Totais do atendimento.
 *
 * Com `baseline` (snapshot do plano ao carregar): `planejado_centavos` vem só
 * do baseline — remover/adicionar linhas ou editar feito não altera o Planejado.
 * `feito_centavos` sempre soma as linhas atuais da tabela.
 */
export function totaisExecucao(
  linhas: ReadonlyArray<Pick<LinhaExecucao, 'planejado_centavos' | 'feito_centavos'>>,
  baseline?: ReadonlyArray<Pick<LinhaExecucao, 'planejado_centavos'>>,
): { planejado_centavos: number; feito_centavos: number } {
  const fontePlanejado =
    baseline && baseline.length > 0 ? baseline : linhas
  return {
    planejado_centavos: somarCentavos(fontePlanejado.map((l) => l.planejado_centavos)),
    feito_centavos: somarCentavos(linhas.map((l) => l.feito_centavos)),
  }
}

/**
 * Resumo textual da quantidade feita (ex.: `"4 U + 1 U"`, `"2,5 mL"`).
 * Linhas com feito 0 não entram.
 */
export function resumoQuantidadeFeita(
  linhas: ReadonlyArray<Pick<LinhaExecucao, 'feito_qtd' | 'unidade'>>,
): string {
  const partes: string[] = []
  for (const l of linhas) {
    const q = qtdNaoNegativa(l.feito_qtd)
    if (q === 0) continue
    const texto =
      Number.isInteger(q) ? String(q) : String(q).replace('.', ',')
    partes.push(l.unidade === 'U' ? `${texto} U` : `${texto} mL`)
  }
  return partes.join(' + ')
}
