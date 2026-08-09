/**
 * Atualização parcial de lead/paciente (campos de CRM, não prontuário).
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarTelefone } from '@/lib/phone'

const TELEFONE_DUPLICADO = '23505'
const CAMINHO_FUNIL = '/crm'

export const schemaAtualizarLead = z
  .object({
    nome: z.string().trim().min(1).max(120).optional(),
    telefone: z.string().trim().max(40).nullable().optional(),
    origem: z.string().trim().max(80).nullable().optional(),
    procedimentoInteresseId: z.uuid().nullable().optional(),
    email: z.string().trim().max(200).nullable().optional(),
    aceitaWhatsapp: z.boolean().optional(),
    aceitaEmail: z.boolean().optional(),
  })
  .refine(
    (dados) =>
      dados.nome !== undefined ||
      dados.telefone !== undefined ||
      dados.origem !== undefined ||
      dados.procedimentoInteresseId !== undefined ||
      dados.email !== undefined ||
      dados.aceitaWhatsapp !== undefined ||
      dados.aceitaEmail !== undefined,
    { message: 'Informe ao menos um campo para atualizar.' },
  )

export type ResultadoAtualizarLead = { ok: true; pacienteId: string } | { ok: false; erro: string }

export async function executarAtualizacaoDeLead(
  supabase: SupabaseClient,
  pacienteId: string,
  entrada: unknown,
  atorId: string | null,
): Promise<ResultadoAtualizarLead> {
  const idOk = z.uuid().safeParse(pacienteId)
  if (!idOk.success) {
    return { ok: false, erro: 'pacienteId inválido.' }
  }

  const analise = schemaAtualizarLead.safeParse(entrada)
  if (!analise.success) {
    return {
      ok: false,
      erro: analise.error.issues[0]?.message ?? 'Dados inválidos.',
    }
  }
  const dados = analise.data

  if (dados.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) {
      return { ok: false, erro: 'E-mail inválido.' }
    }
  }

  let telefone: string | null | undefined = undefined
  if (dados.telefone !== undefined) {
    if (dados.telefone === null || dados.telefone.trim() === '') {
      telefone = null
    } else {
      const e164 = normalizarTelefone(dados.telefone)
      if (!e164) {
        return { ok: false, erro: 'Telefone inválido. Use DDD + número.' }
      }
      telefone = e164
    }
  }

  if (dados.procedimentoInteresseId) {
    const { data: proc } = await supabase
      .from('procedures')
      .select('id')
      .eq('id', dados.procedimentoInteresseId)
      .eq('ativo', true)
      .maybeSingle()
    if (!proc) {
      return { ok: false, erro: 'Procedimento inválido ou inativo.' }
    }
  }

  const patch: Record<string, unknown> = {}
  if (dados.nome !== undefined) patch.nome_completo = dados.nome
  if (telefone !== undefined) patch.telefone = telefone
  if (dados.origem !== undefined) patch.lead_source = dados.origem
  if (dados.procedimentoInteresseId !== undefined) {
    patch.procedimento_interesse_id = dados.procedimentoInteresseId
  }
  if (dados.email !== undefined) patch.email = dados.email
  if (dados.aceitaWhatsapp !== undefined) patch.aceita_whatsapp = dados.aceitaWhatsapp
  if (dados.aceitaEmail !== undefined) patch.aceita_email = dados.aceitaEmail

  const { data, error } = await supabase
    .from('patients')
    .update(patch)
    .eq('id', pacienteId)
    .select('id')

  if (error) {
    if (error.code === TELEFONE_DUPLICADO) {
      return { ok: false, erro: 'Já existe uma paciente com esse telefone.' }
    }
    return { ok: false, erro: 'Não foi possível atualizar. Tente de novo.' }
  }
  if (!data || data.length === 0) {
    return { ok: false, erro: 'Paciente não encontrado.' }
  }

  await supabase.from('audit_log').insert({
    ator: atorId,
    acao: 'lead:atualizado',
    entidade: 'patients',
    registro_id: pacienteId,
  })

  revalidatePath(CAMINHO_FUNIL)
  revalidatePath('/', 'layout')
  return { ok: true, pacienteId }
}
