/**
 * Calculadora dos planos clínicos (toxina e preenchimento).
 *
 * Puro: sem I/O, sem React, sem Next. O preço do catálogo entra em centavos —
 * toxina = R$/U, preenchimento = R$/mL — e a linha multiplica pela quantidade.
 */

/** Rascunho de linha de toxina (campos de formulário em string). */
export type LinhaBotoxRascunho = {
  musculo: string
  diluicao_seringa: string
  quantidade_unidades: string
  total_unidades: string
  procedimento_id: string
}

/** Rascunho de linha de preenchimento (campos de formulário em string). */
export type LinhaFillerRascunho = {
  produto: string
  regiao: string
  camada: string
  tecnica: string
  quantidade_ml: string
  procedimento_id: string
}

/** Texto digitado (aceita vírgula decimal) → número finito ≥ 0, ou null. */
export function parseQuantidade(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0) return null
    return valor
  }
  const bruto = valor.trim()
  if (bruto === '' || bruto.includes('-')) return null
  // pt-BR: vírgula = decimal; ponto só é milhar quando há vírgula ("1.500,5").
  // Sem vírgula, um único ponto é decimal ("1.5").
  const limpo = bruto.includes(',')
    ? bruto.replace(/\./g, '').replace(',', '.')
    : bruto
  const n = Number(limpo)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/**
 * Linha “vale a pena gravar”? Procedimento + U/mL bastam — músculo/produto
 * não são obrigatórios.
 */
export function linhaBotoxTemConteudo(linha: LinhaBotoxRascunho): boolean {
  return Boolean(
    linha.musculo.trim() ||
      linha.diluicao_seringa.trim() ||
      linha.quantidade_unidades.trim() ||
      linha.total_unidades.trim() ||
      linha.procedimento_id,
  )
}

export function linhaFillerTemConteudo(linha: LinhaFillerRascunho): boolean {
  return Boolean(
    linha.produto.trim() ||
      linha.regiao.trim() ||
      linha.camada.trim() ||
      linha.tecnica.trim() ||
      linha.quantidade_ml.trim() ||
      linha.procedimento_id,
  )
}

/**
 * Payload de item de toxina. `musculo` é NOT NULL no banco — vazio do user
 * vira `''` (não copia o nome do procedimento).
 */
export function serializarItemBotox(linha: LinhaBotoxRascunho, ordem: number) {
  return {
    musculo: linha.musculo.trim(),
    diluicao_seringa: linha.diluicao_seringa.trim() || null,
    quantidade_unidades: parseQuantidade(linha.quantidade_unidades),
    total_unidades: parseQuantidade(linha.total_unidades),
    procedimento_id: linha.procedimento_id || null,
    ordem,
  }
}

/**
 * Payload de item de preenchimento. `produto` vazio → `''`, não o catálogo.
 */
export function serializarItemFiller(linha: LinhaFillerRascunho, ordem: number) {
  return {
    produto: linha.produto.trim(),
    regiao: linha.regiao.trim() || null,
    camada: linha.camada.trim() || null,
    tecnica: linha.tecnica.trim() || null,
    quantidade_ml: parseQuantidade(linha.quantidade_ml),
    procedimento_id: linha.procedimento_id || null,
    ordem,
  }
}

/**
 * Se o texto foi preenchido automaticamente com o nome do procedimento
 * (bug antigo do fallback), trata como vazio na UI.
 */
export function limparRotuloHerdadoDoCatalogo(
  texto: string | null | undefined,
  procedimentoId: string | null | undefined,
  catalogo: ReadonlyArray<{ id: string; nome: string }>,
): string {
  const t = (texto ?? '').trim()
  if (!t || t === '—') return ''
  if (!procedimentoId) return t
  const nome = catalogo.find((p) => p.id === procedimentoId)?.nome?.trim()
  if (nome && t === nome) return ''
  return t
}

/**
 * Total da linha de toxina em centavos: unidades × preço por unidade.
 * Valores inválidos ou ausentes → 0 (não contam no plano).
 */
export function centavosLinhaToxina(
  unidades: number | null | undefined,
  precoPorUnidadeCentavos: number | null | undefined,
): number {
  if (
    unidades == null ||
    precoPorUnidadeCentavos == null ||
    !Number.isFinite(unidades) ||
    !Number.isFinite(precoPorUnidadeCentavos) ||
    unidades < 0 ||
    precoPorUnidadeCentavos < 0
  ) {
    return 0
  }
  return Math.round(unidades * precoPorUnidadeCentavos)
}

/**
 * Total da linha de preenchimento em centavos: ml × preço por mL.
 */
export function centavosLinhaFiller(
  ml: number | null | undefined,
  precoPorMlCentavos: number | null | undefined,
): number {
  if (
    ml == null ||
    precoPorMlCentavos == null ||
    !Number.isFinite(ml) ||
    !Number.isFinite(precoPorMlCentavos) ||
    ml < 0 ||
    precoPorMlCentavos < 0
  ) {
    return 0
  }
  return Math.round(ml * precoPorMlCentavos)
}

/** Soma centavos de várias linhas (ignora não-finitos). */
export function somarCentavos(linhas: ReadonlyArray<number>): number {
  return linhas.reduce((acc, valor) => {
    if (!Number.isFinite(valor) || valor < 0) return acc
    return acc + Math.round(valor)
  }, 0)
}
