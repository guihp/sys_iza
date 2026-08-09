/**
 * Movimento de estágio no funil — compartilhado pela Server Action e pela API.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ESTAGIOS, type PatientStage } from '@/app/(app)/crm/estagios'
import { enfileirarConversoes } from '@/lib/conversoes'

const CAMINHO = '/crm'

export const schemaMoverEstagio = z.object({
  pacienteId: z.uuid(),
  estagio: z.enum(ESTAGIOS),
})

export type ResultadoMoverEstagio =
  | { ok: true; pacienteId: string; estagio: PatientStage }
  | { ok: false; erro: string }

export async function executarMoverEstagio(
  supabase: SupabaseClient,
  entrada: unknown,
  atorId: string | null,
): Promise<ResultadoMoverEstagio> {
  const analise = schemaMoverEstagio.safeParse(entrada)
  if (!analise.success) {
    return {
      ok: false,
      erro: `Informe pacienteId e estagio válido (${ESTAGIOS.join(', ')}).`,
    }
  }
  const dados = analise.data

  const { data: antes } = await supabase
    .from('patients')
    .select('stage')
    .eq('id', dados.pacienteId)
    .single()

  const { data, error } = await supabase
    .from('patients')
    .update({ stage: dados.estagio })
    .eq('id', dados.pacienteId)
    .select('id')

  if (error) {
    return { ok: false, erro: `Não foi possível mover o paciente: ${error.message}` }
  }
  if (!data || data.length === 0) {
    return { ok: false, erro: 'Paciente não encontrado ou movimentação não permitida.' }
  }

  await supabase.from('audit_log').insert({
    ator: atorId,
    acao: `estagio:${dados.estagio}`,
    entidade: 'patients',
    registro_id: dados.pacienteId,
  })

  await enfileirarConversoes(supabase, {
    patientId: dados.pacienteId,
    estagioAnterior: (antes as { stage: string } | null)?.stage ?? null,
    estagioNovo: dados.estagio,
  })

  revalidatePath(CAMINHO)
  return { ok: true, pacienteId: dados.pacienteId, estagio: dados.estagio }
}
