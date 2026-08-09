'use server'

import { requireSessao } from '@/auth/session'
import { executarCriacaoDeLead } from '@/lib/leads/criar'
import { createServerClient } from '@/lib/supabase/server'
import type { ProcedimentoParaLead, ResultadoDoLead } from './tipos'

/** Catálogo ativo para o select do NOVO LEAD (e ficha). */
export async function listarProcedimentosParaLead(): Promise<ProcedimentoParaLead[]> {
  await requireSessao()
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('procedures')
    .select('id, nome, preco_centavos')
    .eq('ativo', true)
    .order('nome')
  return (data ?? []) as ProcedimentoParaLead[]
}

/**
 * Cria um lead a partir do botão NOVO LEAD da barra superior.
 *
 * A regra de negócio mora em `@/lib/leads/criar` (também usada pela API HTTP).
 */
export async function criarLead(formData: FormData): Promise<ResultadoDoLead> {
  const sessao = await requireSessao()

  const procedimentoBruto = String(formData.get('procedimento_interesse_id') ?? '').trim()
  const resultado = await executarCriacaoDeLead(
    await createServerClient(),
    {
      nome: formData.get('nome') ?? '',
      telefone: formData.get('telefone') || undefined,
      origem: formData.get('origem') || undefined,
      procedimentoInteresseId: procedimentoBruto === '' ? null : procedimentoBruto,
    },
    sessao.userId,
  )
  return resultado
}
