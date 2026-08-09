/**
 * Criação de lead — compartilhada pela Server Action e pela API HTTP.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { vincularAtribuicaoAoPaciente } from '@/lib/conversoes'
import { normalizarTelefone } from '@/lib/phone'

const TELEFONE_DUPLICADO = '23505'

export const schemaCriarLead = z.object({
  nome: z.string().trim().min(1, 'O nome é obrigatório.').max(120, 'Nome longo demais.'),
  telefone: z.string().trim().max(40).optional(),
  origem: z.string().trim().max(80).optional(),
  procedimentoInteresseId: z.uuid().nullable().optional(),
})

export type ResultadoCriarLead = { ok: true; pacienteId: string } | { ok: false; erro: string }

export async function executarCriacaoDeLead(
  supabase: SupabaseClient,
  entrada: unknown,
  atorId: string | null,
): Promise<ResultadoCriarLead> {
  const analise = schemaCriarLead.safeParse(entrada)
  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  const { nome, telefone, origem, procedimentoInteresseId } = analise.data

  let e164: string | null = null
  if (telefone) {
    e164 = normalizarTelefone(telefone)
    if (!e164) {
      return { ok: false, erro: 'Telefone inválido. Use DDD + número, como (11) 98765-4321.' }
    }
  }

  if (procedimentoInteresseId) {
    const { data: proc } = await supabase
      .from('procedures')
      .select('id')
      .eq('id', procedimentoInteresseId)
      .eq('ativo', true)
      .maybeSingle()
    if (!proc) {
      return { ok: false, erro: 'Procedimento inválido ou inativo.' }
    }
  }

  const { data, error } = await supabase
    .from('patients')
    .insert({
      nome_completo: nome,
      telefone: e164,
      lead_source: origem || null,
      procedimento_interesse_id: procedimentoInteresseId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === TELEFONE_DUPLICADO) {
      return { ok: false, erro: 'Já existe uma paciente com esse telefone.' }
    }
    return { ok: false, erro: 'Não foi possível cadastrar. Tente de novo.' }
  }

  await supabase.from('audit_log').insert({
    ator: atorId,
    acao: 'lead:criado',
    entidade: 'patients',
    registro_id: data.id,
  })

  await vincularAtribuicaoAoPaciente(data.id, e164)

  revalidatePath('/', 'layout')
  return { ok: true, pacienteId: data.id }
}
