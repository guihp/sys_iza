/**
 * Tipos do lead — fora de `'use server'`.
 */

export type ResultadoDoLead = { ok: true; pacienteId: string } | { ok: false; erro: string }

export type ProcedimentoParaLead = {
  id: string
  nome: string
  preco_centavos: number
}
