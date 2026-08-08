'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirDra, ErroDePermissao } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import type { ResultadoDaAcao } from './tipos'

async function sessaoDra() {
  try {
    return exigirDra(await getSessao())
  } catch (erro) {
    if (erro instanceof ErroDePermissao) return null
    throw erro
  }
}

const itemBotoxSchema = z.object({
  musculo: z.string().trim().min(1).max(200),
  diluicao_seringa: z.string().trim().max(200).nullable(),
  quantidade_unidades: z.number().nonnegative().nullable(),
  total_unidades: z.number().nonnegative().nullable(),
  ordem: z.number().int().nonnegative(),
})

const planoBotoxSchema = z.object({
  pacienteId: z.uuid(),
  produto_nome: z.string().trim().max(200).nullable(),
  validade: z.iso.date().nullable(),
  lote: z.string().trim().max(120).nullable(),
  marca: z.string().trim().max(120).nullable(),
  itens: z.array(itemBotoxSchema),
})

const itemFillerSchema = z.object({
  produto: z.string().trim().min(1).max(200),
  regiao: z.string().trim().max(200).nullable(),
  camada: z.string().trim().max(200).nullable(),
  tecnica: z.string().trim().max(200).nullable(),
  quantidade_ml: z.number().nonnegative().nullable(),
  ordem: z.number().int().nonnegative(),
})

const planoFillerSchema = z.object({
  pacienteId: z.uuid(),
  produto_nome: z.string().trim().max(200).nullable(),
  validade: z.iso.date().nullable(),
  lote: z.string().trim().max(120).nullable(),
  marca: z.string().trim().max(120).nullable(),
  itens: z.array(itemFillerSchema),
})

/**
 * Cria um novo plano de toxina (histórico) com itens.
 * O mais recente é o que a UI carrega.
 */
export async function salvarPlanoBotox(entrada: unknown): Promise<ResultadoDaAcao> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. grava planos clínicos.' }

  const analise = planoBotoxSchema.safeParse(entrada)
  if (!analise.success) return { ok: false, erro: 'Confira os campos do plano de toxina.' }
  const dados = analise.data

  const supabase = await createServerClient()
  const { data: plano, error } = await supabase
    .from('botox_plans')
    .insert({
      patient_id: dados.pacienteId,
      produto_nome: dados.produto_nome,
      validade: dados.validade,
      lote: dados.lote,
      marca: dados.marca,
      registrado_por: sessao.userId,
    })
    .select('id')
    .single()

  if (error || !plano) {
    return { ok: false, erro: 'Não foi possível salvar o plano. Tente de novo.' }
  }

  if (dados.itens.length > 0) {
    const { error: erroItens } = await supabase.from('botox_plan_items').insert(
      dados.itens.map((item) => ({
        plan_id: plano.id,
        musculo: item.musculo,
        diluicao_seringa: item.diluicao_seringa,
        quantidade_unidades: item.quantidade_unidades,
        total_unidades: item.total_unidades,
        ordem: item.ordem,
      })),
    )
    if (erroItens) {
      return { ok: false, erro: 'Plano criado, mas as linhas falharam. Tente de novo.' }
    }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'plano_botox:criado',
    entidade: 'botox_plans',
    registro_id: plano.id,
  })

  revalidatePath(`/pacientes/${dados.pacienteId}`)
  return { ok: true }
}

export async function salvarPlanoFiller(entrada: unknown): Promise<ResultadoDaAcao> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. grava planos clínicos.' }

  const analise = planoFillerSchema.safeParse(entrada)
  if (!analise.success) {
    return { ok: false, erro: 'Confira os campos do plano de preenchimento.' }
  }
  const dados = analise.data

  const supabase = await createServerClient()
  const { data: plano, error } = await supabase
    .from('filler_plans')
    .insert({
      patient_id: dados.pacienteId,
      produto_nome: dados.produto_nome,
      validade: dados.validade,
      lote: dados.lote,
      marca: dados.marca,
      registrado_por: sessao.userId,
    })
    .select('id')
    .single()

  if (error || !plano) {
    return { ok: false, erro: 'Não foi possível salvar o plano. Tente de novo.' }
  }

  if (dados.itens.length > 0) {
    const { error: erroItens } = await supabase.from('filler_plan_items').insert(
      dados.itens.map((item) => ({
        plan_id: plano.id,
        produto: item.produto,
        regiao: item.regiao,
        camada: item.camada,
        tecnica: item.tecnica,
        quantidade_ml: item.quantidade_ml,
        ordem: item.ordem,
      })),
    )
    if (erroItens) {
      return { ok: false, erro: 'Plano criado, mas as linhas falharam. Tente de novo.' }
    }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'plano_filler:criado',
    entidade: 'filler_plans',
    registro_id: plano.id,
  })

  revalidatePath(`/pacientes/${dados.pacienteId}`)
  return { ok: true }
}
