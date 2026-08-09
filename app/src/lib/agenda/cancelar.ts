/**
 * Cancelamento de consulta — compartilhado pela API HTTP (e futura UI).
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sincronizarConsultaNoGoogle } from '@/lib/google-agenda'
import { cancelarLembretesPendentesDaConsulta } from '@/lib/lembretes'

const CAMINHO_AGENDA = '/agenda'

export const schemaCancelamento = z.object({
  consultaId: z.uuid(),
})

export type ResultadoDeCancelamento = { ok: true; id: string } | { ok: false; erro: string }

/**
 * Marca a consulta como `cancelado`, cancela lembretes pendentes e remove o
 * evento no Google (quando a sincronia estiver ligada).
 *
 * Não apaga a linha: o rastro na agenda e no audit_log fica.
 */
export async function executarCancelamento(
  supabase: SupabaseClient,
  entrada: unknown,
  atorId: string | null,
): Promise<ResultadoDeCancelamento> {
  const analise = schemaCancelamento.safeParse(entrada)
  if (!analise.success) {
    return { ok: false, erro: 'Informe consultaId (UUID da consulta).' }
  }
  const { consultaId } = analise.data

  const { data: consulta, error: erroConsulta } = await supabase
    .from('appointments')
    .select('id, status')
    .eq('id', consultaId)
    .single()

  if (erroConsulta || !consulta) {
    return { ok: false, erro: 'Consulta não encontrada.' }
  }
  if (consulta.status === 'cancelado') {
    return { ok: true, id: consultaId }
  }

  const cancelamento = await cancelarLembretesPendentesDaConsulta(supabase, consultaId)
  if (!cancelamento.ok) {
    return { ok: false, erro: 'Não foi possível cancelar os lembretes. Tente de novo.' }
  }

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelado' })
    .eq('id', consultaId)

  if (error) {
    return { ok: false, erro: 'Não foi possível cancelar a consulta. Tente de novo.' }
  }

  await supabase.from('audit_log').insert({
    ator: atorId,
    acao: 'cancelou',
    entidade: 'appointments',
    registro_id: consultaId,
  })

  await sincronizarConsultaNoGoogle(supabase, consultaId)

  revalidatePath(CAMINHO_AGENDA)
  return { ok: true, id: consultaId }
}
