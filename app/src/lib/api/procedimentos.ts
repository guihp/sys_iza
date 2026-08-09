/**
 * Listagem / leitura de procedimentos para a API HTTP (n8n).
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const COLUNAS =
  'id, nome, duracao_minutos, preco_centavos, default_return_interval_days, ativo, categoria' as const

export type ProcedimentoApi = {
  id: string
  nome: string
  duracao_minutos: number
  preco_centavos: number
  default_return_interval_days: number | null
  ativo: boolean
  categoria?: string | null
}

export async function listarProcedimentosApi(
  supabase: SupabaseClient,
  opcoes: { soAtivos?: boolean } = {},
): Promise<{ ok: true; procedimentos: ProcedimentoApi[] } | { ok: false; erro: string }> {
  const soAtivos = opcoes.soAtivos ?? true

  let consulta = supabase.from('procedures').select(COLUNAS).order('nome')
  if (soAtivos) consulta = consulta.eq('ativo', true)

  const { data, error } = await consulta

  if (error) {
    // Migration de categoria pode não estar aplicada — cai nas colunas base.
    let fallback = supabase
      .from('procedures')
      .select('id, nome, duracao_minutos, preco_centavos, default_return_interval_days, ativo')
      .order('nome')
    if (soAtivos) fallback = fallback.eq('ativo', true)

    const segundo = await fallback
    if (segundo.error) {
      return { ok: false, erro: 'Não foi possível listar procedimentos.' }
    }
    return { ok: true, procedimentos: (segundo.data ?? []) as ProcedimentoApi[] }
  }

  return { ok: true, procedimentos: (data ?? []) as ProcedimentoApi[] }
}

export async function obterProcedimentoApi(
  supabase: SupabaseClient,
  id: string,
): Promise<
  { ok: true; procedimento: ProcedimentoApi } | { ok: false; erro: string; status: 400 | 404 }
> {
  const idOk = z.uuid().safeParse(id)
  if (!idOk.success) {
    return { ok: false, erro: 'id inválido.', status: 400 }
  }

  const { data, error } = await supabase
    .from('procedures')
    .select(COLUNAS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    const segundo = await supabase
      .from('procedures')
      .select('id, nome, duracao_minutos, preco_centavos, default_return_interval_days, ativo')
      .eq('id', id)
      .maybeSingle()
    if (segundo.error || !segundo.data) {
      return { ok: false, erro: 'Procedimento não encontrado.', status: 404 }
    }
    return { ok: true, procedimento: segundo.data as ProcedimentoApi }
  }

  if (!data) {
    return { ok: false, erro: 'Procedimento não encontrado.', status: 404 }
  }
  return { ok: true, procedimento: data as ProcedimentoApi }
}
