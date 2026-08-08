/**
 * Estilos compartilhados dos formulários da ficha — fora de `'use server'`.
 */

export const CAMPO =
  'w-full rounded-lg border border-linha bg-transparent px-3 py-2 text-sm'

export const BOTAO_PRINCIPAL =
  'rounded-lg bg-acento px-4 py-2 text-sm text-white disabled:opacity-60'

export const BOTAO_SECUNDARIO =
  'rounded-lg border border-linha px-4 py-2 text-sm text-texto disabled:opacity-60'

/** Texto vazio do input → null (ausência), não string vazia. */
export function textoOpcional(valor: FormDataEntryValue | null): string | null {
  if (typeof valor !== 'string') return null
  const t = valor.trim()
  return t.length > 0 ? t : null
}

export function booleanoDoForm(valor: FormDataEntryValue | null): boolean {
  return valor === 'on' || valor === 'true' || valor === '1'
}
