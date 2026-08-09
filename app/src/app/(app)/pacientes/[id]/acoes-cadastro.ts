'use server'

import { z } from 'zod'
import { requireSessao } from '@/auth/session'
import { normalizarTelefone } from '@/lib/phone'
import { createServerClient } from '@/lib/supabase/server'
import { booleanoDoForm, textoOpcional } from '../campos'
import type { ResultadoDaAcao } from './tipos'

const TELEFONE_DUPLICADO = '23505'

const schema = z.object({
  pacienteId: z.uuid(),
  nome_completo: z.string().trim().min(1).max(200),
  como_prefere_ser_chamado: z.string().trim().max(120).nullable(),
  nascimento: z.iso.date().nullable().optional(),
  sexo: z.string().trim().max(40).nullable(),
  telefone: z.string().trim().max(40).nullable(),
  cpf: z.string().trim().max(20).nullable(),
  nacionalidade: z.string().trim().max(80).nullable(),
  naturalidade: z.string().trim().max(80).nullable(),
  email: z.string().trim().max(200).nullable(),
  endereco: z.string().trim().max(400).nullable(),
  lead_source: z.string().trim().max(120).nullable(),
  procedimento_interesse_id: z.uuid().nullable(),
  contato_emergencia_nome: z.string().trim().max(120).nullable(),
  contato_emergencia_parentesco: z.string().trim().max(80).nullable(),
  contato_emergencia_telefone: z.string().trim().max(40).nullable(),
  profissao: z.string().trim().max(120).nullable(),
  observacoes: z.string().trim().max(4000).nullable(),
  aceita_whatsapp: z.boolean(),
  aceita_email: z.boolean(),
})

/**
 * Atualiza identificação do paciente. Equipe inteira (cadastro, não clínico).
 */
export async function salvarCadastro(formData: FormData): Promise<ResultadoDaAcao> {
  const sessao = await requireSessao()

  const emailBruto = textoOpcional(formData.get('email'))
  if (emailBruto && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBruto)) {
    return { ok: false, erro: 'E-mail inválido.' }
  }

  const procedimentoBruto = textoOpcional(formData.get('procedimento_interesse_id'))

  const analise = schema.safeParse({
    pacienteId: formData.get('pacienteId'),
    nome_completo: formData.get('nome_completo') ?? '',
    como_prefere_ser_chamado: textoOpcional(formData.get('como_prefere_ser_chamado')),
    nascimento: textoOpcional(formData.get('nascimento')),
    sexo: textoOpcional(formData.get('sexo')),
    telefone: textoOpcional(formData.get('telefone')),
    cpf: textoOpcional(formData.get('cpf')),
    nacionalidade: textoOpcional(formData.get('nacionalidade')),
    naturalidade: textoOpcional(formData.get('naturalidade')),
    email: emailBruto,
    endereco: textoOpcional(formData.get('endereco')),
    lead_source: textoOpcional(formData.get('lead_source')),
    procedimento_interesse_id: procedimentoBruto,
    contato_emergencia_nome: textoOpcional(formData.get('contato_emergencia_nome')),
    contato_emergencia_parentesco: textoOpcional(formData.get('contato_emergencia_parentesco')),
    contato_emergencia_telefone: textoOpcional(formData.get('contato_emergencia_telefone')),
    profissao: textoOpcional(formData.get('profissao')),
    observacoes: textoOpcional(formData.get('observacoes')),
    aceita_whatsapp: booleanoDoForm(formData.get('aceita_whatsapp')),
    aceita_email: booleanoDoForm(formData.get('aceita_email')),
  })

  if (!analise.success) {
    return { ok: false, erro: 'Confira os campos do cadastro.' }
  }

  const dados = analise.data
  let telefone: string | null = null
  if (dados.telefone) {
    telefone = normalizarTelefone(dados.telefone)
    if (!telefone) {
      return { ok: false, erro: 'Telefone inválido. Use DDD + número.' }
    }
  }

  const supabase = await createServerClient()

  if (dados.procedimento_interesse_id) {
    const { data: proc } = await supabase
      .from('procedures')
      .select('id')
      .eq('id', dados.procedimento_interesse_id)
      .eq('ativo', true)
      .maybeSingle()
    if (!proc) {
      return { ok: false, erro: 'Procedimento inválido ou inativo.' }
    }
  }

  const { error } = await supabase
    .from('patients')
    .update({
      nome_completo: dados.nome_completo,
      como_prefere_ser_chamado: dados.como_prefere_ser_chamado,
      nascimento: dados.nascimento ?? null,
      sexo: dados.sexo,
      telefone,
      cpf: dados.cpf,
      nacionalidade: dados.nacionalidade,
      naturalidade: dados.naturalidade,
      email: dados.email,
      endereco: dados.endereco,
      lead_source: dados.lead_source,
      procedimento_interesse_id: dados.procedimento_interesse_id,
      contato_emergencia_nome: dados.contato_emergencia_nome,
      contato_emergencia_parentesco: dados.contato_emergencia_parentesco,
      contato_emergencia_telefone: dados.contato_emergencia_telefone,
      profissao: dados.profissao,
      observacoes: dados.observacoes,
      aceita_whatsapp: dados.aceita_whatsapp,
      aceita_email: dados.aceita_email,
    })
    .eq('id', dados.pacienteId)

  if (error) {
    if (error.code === TELEFONE_DUPLICADO) {
      return { ok: false, erro: 'Já existe uma paciente com esse telefone.' }
    }
    return { ok: false, erro: 'Não foi possível salvar o cadastro.' }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'paciente:cadastro_atualizado',
    entidade: 'patients',
    registro_id: dados.pacienteId,
  })

  // Sem revalidatePath aqui: remonta a ficha no meio da digitação e perde o
  // cursor / estado dirty. A troca de aba já recarrega o server component.
  return { ok: true }
}
