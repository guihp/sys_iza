/**
 * Taxas da maquininha (MDR Mastercard — recebimento D+1).
 *
 * Fonte: tabela "Minhas taxas e prazos" da adquirente da clínica.
 * Parcelamento no cartão limitado a 4× nesta clínica.
 */

export const MAX_PARCELAS_MAQUININHA = 4

/** Débito à vista (fora do parcelamento crédito). */
export const TAXA_DEBITO_PERCENTUAL = 1.69

/**
 * Crédito por número de parcelas (1 = à vista).
 * Chaves 1–4; fora disso a função de taxa recusa.
 */
export const TAXA_CREDITO_POR_PARCELAS: Readonly<Record<1 | 2 | 3 | 4, number>> = {
  1: 3.86,
  2: 9.86,
  3: 11.24,
  4: 12.59,
}

export type ModalidadeMaquininha = 'credito' | 'debito'

/**
 * Percentual MDR para a combinação parcela × modalidade.
 * `null` se inválido (parcelas fora de 1–4, ou débito com mais de 1×).
 */
export function taxaMaquininhaPercentual(
  parcelasQtd: number,
  modalidade: ModalidadeMaquininha = 'credito',
): number | null {
  if (!Number.isInteger(parcelasQtd) || parcelasQtd < 1 || parcelasQtd > MAX_PARCELAS_MAQUININHA) {
    return null
  }
  if (modalidade === 'debito') {
    return parcelasQtd === 1 ? TAXA_DEBITO_PERCENTUAL : null
  }
  return TAXA_CREDITO_POR_PARCELAS[parcelasQtd as 1 | 2 | 3 | 4] ?? null
}

/**
 * Juros (MDR) em centavos sobre o valor base que vai no cartão
 * (restante clínico, antes do repasse).
 *
 * - Sem repasse: `base × taxa/100` — custo da maquininha (clínica absorve).
 * - Com repasse: `base × taxa/(100 − taxa)` — gross-up para, após a MDR sobre
 *   o valor cobrado, a clínica liquidar próximo do valor clínico.
 *
 * Arredonda para o centavo mais próximo. Base ≤ 0 ou taxa inválida → 0.
 */
export function jurosMaquininhaCentavos(args: {
  valorBaseCentavos: number
  parcelasQtd: number
  repassarAoCliente: boolean
  modalidade?: ModalidadeMaquininha
}): number {
  const base = args.valorBaseCentavos
  if (!Number.isFinite(base) || !Number.isInteger(base) || base <= 0) return 0

  const taxa = taxaMaquininhaPercentual(args.parcelasQtd, args.modalidade ?? 'credito')
  if (taxa == null || !(taxa > 0) || taxa >= 100) return 0

  if (args.repassarAoCliente) {
    return Math.round((base * taxa) / (100 - taxa))
  }
  return Math.round((base * taxa) / 100)
}
