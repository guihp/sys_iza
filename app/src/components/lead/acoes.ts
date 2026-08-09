'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSessao } from '@/auth/session'
import { vincularAtribuicaoAoPaciente } from '@/lib/conversoes'
import { normalizarTelefone } from '@/lib/phone'
import { createServerClient } from '@/lib/supabase/server'
import type { ProcedimentoParaLead, ResultadoDoLead } from './tipos'

/** Violação de índice único no Postgres. Aqui só pode ser o telefone. */
const TELEFONE_DUPLICADO = '23505'

const schema = z.object({
  nome: z.string().trim().min(1, 'O nome é obrigatório.').max(120, 'Nome longo demais.'),
  telefone: z.string().trim().max(40).optional(),
  origem: z.string().trim().max(80).optional(),
  procedimentoInteresseId: z.uuid().nullable().optional(),
})

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
 * Sem checagem de papel de propósito: receber o lead e digitar nome e telefone
 * é o trabalho da secretária, e a policy "equipe cria pacientes" da 0004 diz
 * exatamente isso. O que existe é validação — Server Action é endpoint público,
 * então o `requireSessao()` e o zod estão aqui e não no formulário.
 *
 * O telefone é normalizado para E.164 antes de descer. É o que faz o índice
 * único de `patients.telefone` funcionar: sem isso, "(11) 98765-4321" e
 * "11987654321" entrariam como duas pacientes, e a segunda receberia lembrete
 * de consulta que não é dela. O estágio não é passado — o `default 'lead'` da
 * tabela é a única definição de onde um lead começa.
 */
export async function criarLead(formData: FormData): Promise<ResultadoDoLead> {
  const sessao = await requireSessao()

  const procedimentoBruto = String(formData.get('procedimento_interesse_id') ?? '').trim()
  const analise = schema.safeParse({
    nome: formData.get('nome') ?? '',
    telefone: formData.get('telefone') ?? undefined,
    origem: formData.get('origem') ?? undefined,
    procedimentoInteresseId: procedimentoBruto === '' ? null : procedimentoBruto,
  })
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

  const supabase = await createServerClient()

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
    // A mensagem do Postgres pode carregar detalhe de esquema; não vai à tela.
    return { ok: false, erro: 'Não foi possível cadastrar. Tente de novo.' }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'lead:criado',
    entidade: 'patients',
    registro_id: data.id,
  })

  // O sentido mais comum do vínculo: a mensagem do anúncio chegou ANTES do
  // cadastro, o n8n gravou a atribuição com o telefone e `patient_id` nulo, e
  // agora a secretária acabou de digitar a mesma pessoa. Ligar aqui é o que
  // permite o primeiro movimento do funil dela já sair creditado ao anúncio.
  //
  // Best-effort e não lança: `vincularAtribuicaoAoPaciente` devolve resultado.
  // Lead cadastrado é o dado que importa, e nada de marketing pode derrubá-lo.
  // O caminho contrário — cadastro primeiro, mensagem depois — é resolvido pelo
  // próprio `enfileirarConversoes`, que revincula a cada movimento do funil.
  await vincularAtribuicaoAoPaciente(data.id, e164)

  // Layout inteiro, e não só `/crm`: o contador de leads ativos na sidebar é
  // renderizado no layout protegido, e o botão NOVO LEAD é apertado de qualquer
  // tela. Revalidar só o funil deixaria o número da lateral mentindo até a
  // próxima navegação completa.
  revalidatePath('/', 'layout')
  return { ok: true, pacienteId: data.id }
}
