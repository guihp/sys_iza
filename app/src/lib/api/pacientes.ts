/**
 * Listagem / leitura de pacientes para a API HTTP (n8n).
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const COLUNAS =
  'id, nome_completo, telefone, email, stage, lead_source, procedimento_interesse_id, criado_em' as const

export type PacienteApi = {
  id: string
  nome_completo: string
  telefone: string | null
  email: string | null
  stage: string
  lead_source: string | null
  procedimento_interesse_id: string | null
  criado_em: string
}

export async function listarPacientesApi(
  supabase: SupabaseClient,
): Promise<{ ok: true; pacientes: PacienteApi[] } | { ok: false; erro: string }> {
  const { data, error } = await supabase
    .from('patients')
    .select(COLUNAS)
    .order('nome_completo')

  if (error) {
    return { ok: false, erro: 'Não foi possível listar pacientes.' }
  }
  return { ok: true, pacientes: (data ?? []) as PacienteApi[] }
}

export async function obterPacienteApi(
  supabase: SupabaseClient,
  id: string,
): Promise<{ ok: true; paciente: PacienteApi } | { ok: false; erro: string; status: 400 | 404 }> {
  const idOk = z.uuid().safeParse(id)
  if (!idOk.success) {
    return { ok: false, erro: 'id inválido.', status: 400 }
  }

  const { data, error } = await supabase.from('patients').select(COLUNAS).eq('id', id).maybeSingle()

  if (error) {
    return { ok: false, erro: 'Não foi possível ler o paciente.', status: 404 }
  }
  if (!data) {
    return { ok: false, erro: 'Paciente não encontrado.', status: 404 }
  }
  return { ok: true, paciente: data as PacienteApi }
}
