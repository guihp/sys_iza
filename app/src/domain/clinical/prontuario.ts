/**
 * Validação e helpers puros do prontuário clínico.
 *
 * Sem I/O, sem Supabase, sem React, sem Next — o que permite cobrir as bordas
 * (autoconfiança 0–10, idade a partir do nascimento, totais do plano de toxina)
 * com teste unitário sem banco.
 */

/** Escala do PDF: impacto na autoconfiança, 0 a 10 inclusive. */
export function validarAutoconfianca(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(String(valor).trim())
  if (!Number.isInteger(n) || n < 0 || n > 10) return null
  return n
}

/**
 * Idade em anos completos no dia de calendário da clínica.
 *
 * `nascimento` e `hoje` em `YYYY-MM-DD`. Devolve null se a data for inválida ou
 * estiver no futuro.
 */
export function idadeEmAnos(nascimento: string, hoje: string): number | null {
  const nasc = parseIsoDate(nascimento)
  const ref = parseIsoDate(hoje)
  if (!nasc || !ref) return null
  if (nasc.getTime() > ref.getTime()) return null

  let idade = ref.getUTCFullYear() - nasc.getUTCFullYear()
  const mes = ref.getUTCMonth() - nasc.getUTCMonth()
  if (mes < 0 || (mes === 0 && ref.getUTCDate() < nasc.getUTCDate())) {
    idade -= 1
  }
  return idade
}

function parseIsoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  const data = new Date(Date.UTC(y, m - 1, d))
  if (
    data.getUTCFullYear() !== y ||
    data.getUTCMonth() !== m - 1 ||
    data.getUTCDate() !== d
  ) {
    return null
  }
  return data
}

/** Soma unidades das linhas do plano de toxina (ignora vazios/ inválidos). */
export function totalUnidadesBotox(
  itens: ReadonlyArray<{ quantidade_unidades?: number | null; total_unidades?: number | null }>,
): number {
  return itens.reduce((acc, item) => {
    const valor = item.total_unidades ?? item.quantidade_unidades
    if (valor == null || !Number.isFinite(valor) || valor < 0) return acc
    return acc + valor
  }, 0)
}

/** Soma ml das linhas do plano de preenchimento. */
export function totalMlFiller(
  itens: ReadonlyArray<{ quantidade_ml?: number | null }>,
): number {
  return itens.reduce((acc, item) => {
    const valor = item.quantidade_ml
    if (valor == null || !Number.isFinite(valor) || valor < 0) return acc
    return acc + valor
  }, 0)
}

export const ABAS_DA_FICHA = [
  'cadastro',
  'anamnese',
  'avaliacao',
  'planos',
  'atendimentos',
  'pasta',
] as const

export type AbaDaFicha = (typeof ABAS_DA_FICHA)[number]

export const ROTULOS_DAS_ABAS: Record<AbaDaFicha, string> = {
  cadastro: 'Cadastro',
  anamnese: 'Anamnese',
  avaliacao: 'Avaliação',
  planos: 'Planos',
  atendimentos: 'Atendimentos',
  pasta: 'Pasta',
}

/** Guarda de tipo para `?aba=` vindo da URL. */
export function abaDaUrl(bruto: string | string[] | undefined): AbaDaFicha {
  const valor = Array.isArray(bruto) ? bruto[0] : bruto
  if (valor && (ABAS_DA_FICHA as readonly string[]).includes(valor)) {
    return valor as AbaDaFicha
  }
  return 'cadastro'
}

export const ANGULOS_FOTO = [
  'frontal',
  'perfil_direito',
  'perfil_esquerdo',
  'obliquo',
  'detalhe',
] as const

export type AnguloFoto = (typeof ANGULOS_FOTO)[number]

export const ROTULOS_ANGULO: Record<AnguloFoto, string> = {
  frontal: 'Frontal',
  perfil_direito: 'Perfil direito',
  perfil_esquerdo: 'Perfil esquerdo',
  obliquo: 'Oblíquo',
  detalhe: 'Detalhe',
}

export function ehAnguloFoto(valor: unknown): valor is AnguloFoto {
  return typeof valor === 'string' && (ANGULOS_FOTO as readonly string[]).includes(valor)
}
