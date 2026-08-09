'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirDra, ErroDePermissao } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import type { ResultadoSalvarPlano } from './tipos'

async function sessaoDra() {
  try {
    return exigirDra(await getSessao())
  } catch (erro) {
    if (erro instanceof ErroDePermissao) return null
    throw erro
  }
}

const anotacaoSchema = z
  .object({
    versao: z.literal(1),
    tracos: z.array(
      z.object({
        pontos: z.array(z.object({ x: z.number(), y: z.number() })),
        cor: z.string().max(40),
        espessura: z.number().positive().max(64),
        ferramenta: z.enum(['caneta', 'borracha']),
      }),
    ),
  })
  .nullable()

const itemBotoxSchema = z.object({
  musculo: z.string().trim().max(200),
  diluicao_seringa: z.string().trim().max(200).nullable(),
  quantidade_unidades: z.number().nonnegative().nullable(),
  total_unidades: z.number().nonnegative().nullable(),
  procedimento_id: z.uuid().nullable(),
  ordem: z.number().int().nonnegative(),
})

const planoBotoxSchema = z.object({
  id: z.uuid().nullable(),
  pacienteId: z.uuid(),
  realizado_em: z.iso.date(),
  produto_nome: z.string().trim().max(200).nullable(),
  validade: z.iso.date().nullable(),
  lote: z.string().trim().max(120).nullable(),
  marca: z.string().trim().max(120).nullable(),
  anotacao_json: anotacaoSchema,
  itens: z.array(itemBotoxSchema),
})

const itemFillerSchema = z.object({
  produto: z.string().trim().max(200),
  regiao: z.string().trim().max(200).nullable(),
  camada: z.string().trim().max(200).nullable(),
  tecnica: z.string().trim().max(200).nullable(),
  quantidade_ml: z.number().nonnegative().nullable(),
  procedimento_id: z.uuid().nullable(),
  ordem: z.number().int().nonnegative(),
})

const planoFillerSchema = z.object({
  id: z.uuid().nullable(),
  pacienteId: z.uuid(),
  realizado_em: z.iso.date(),
  produto_nome: z.string().trim().max(200).nullable(),
  validade: z.iso.date().nullable(),
  lote: z.string().trim().max(120).nullable(),
  marca: z.string().trim().max(120).nullable(),
  anotacao_json: anotacaoSchema,
  itens: z.array(itemFillerSchema),
})

/**
 * Cria ou atualiza plano de toxina (vários por paciente).
 * Itens são substituídos por completo a cada gravação.
 */
export async function salvarPlanoBotox(entrada: unknown): Promise<ResultadoSalvarPlano> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. grava planos clínicos.' }

  const analise = planoBotoxSchema.safeParse(entrada)
  if (!analise.success) return { ok: false, erro: 'Confira os campos do plano de toxina.' }
  const dados = analise.data

  const supabase = await createServerClient()
  const campos = {
    produto_nome: dados.produto_nome,
    validade: dados.validade,
    lote: dados.lote,
    marca: dados.marca,
    realizado_em: dados.realizado_em,
    anotacao_json: dados.anotacao_json,
  }

  let planoId = dados.id

  if (planoId) {
    const { data: existente, error: erroBusca } = await supabase
      .from('botox_plans')
      .select('id')
      .eq('id', planoId)
      .eq('patient_id', dados.pacienteId)
      .maybeSingle()
    if (erroBusca || !existente) {
      return { ok: false, erro: 'Plano não encontrado para este paciente.' }
    }
    const { error } = await supabase.from('botox_plans').update(campos).eq('id', planoId)
    if (error) return { ok: false, erro: 'Não foi possível atualizar o plano. Tente de novo.' }

    const { data: antigos } = await supabase
      .from('botox_plan_items')
      .select('id')
      .eq('plan_id', planoId)

    if (dados.itens.length > 0) {
      const { error: erroItens } = await supabase.from('botox_plan_items').insert(
        dados.itens.map((item) => ({
          plan_id: planoId,
          musculo: item.musculo,
          diluicao_seringa: item.diluicao_seringa,
          quantidade_unidades: item.quantidade_unidades,
          total_unidades: item.total_unidades,
          procedimento_id: item.procedimento_id,
          ordem: item.ordem,
        })),
      )
      if (erroItens) {
        return { ok: false, erro: 'Plano gravado, mas as linhas falharam. Tente de novo.' }
      }
      if (antigos && antigos.length > 0) {
        const { error: erroApaga } = await supabase
          .from('botox_plan_items')
          .delete()
          .in(
            'id',
            antigos.map((a) => a.id),
          )
        if (erroApaga) return { ok: false, erro: 'Não foi possível atualizar as linhas.' }
      }
    } else {
      if (antigos && antigos.length > 0) {
        const { error: erroApaga } = await supabase
          .from('botox_plan_items')
          .delete()
          .eq('plan_id', planoId)
        if (erroApaga) return { ok: false, erro: 'Não foi possível atualizar as linhas.' }
      }
    }
  } else {
    const { data: plano, error } = await supabase
      .from('botox_plans')
      .insert({
        patient_id: dados.pacienteId,
        registrado_por: sessao.userId,
        ...campos,
      })
      .select('id')
      .single()
    if (error || !plano) {
      return { ok: false, erro: 'Não foi possível salvar o plano. Tente de novo.' }
    }
    planoId = plano.id

    if (dados.itens.length > 0) {
      const { error: erroItens } = await supabase.from('botox_plan_items').insert(
        dados.itens.map((item) => ({
          plan_id: planoId,
          musculo: item.musculo,
          diluicao_seringa: item.diluicao_seringa,
          quantidade_unidades: item.quantidade_unidades,
          total_unidades: item.total_unidades,
          procedimento_id: item.procedimento_id,
          ordem: item.ordem,
        })),
      )
      if (erroItens) {
        return { ok: false, erro: 'Plano gravado, mas as linhas falharam. Tente de novo.' }
      }
    }
  }

  if (!planoId) {
    return { ok: false, erro: 'Não foi possível salvar o plano. Tente de novo.' }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: dados.id ? 'plano_botox:atualizado' : 'plano_botox:criado',
    entidade: 'botox_plans',
    registro_id: planoId,
  })

  // Sem revalidatePath aqui: o editor de Planos guarda visao/rascunho em
  // useState; revalidar a ficha remonta o client e volta para a galeria.
  // A galeria atualiza via router.refresh() ao sair do editor.
  return { ok: true, id: planoId }
}

export async function salvarPlanoFiller(entrada: unknown): Promise<ResultadoSalvarPlano> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. grava planos clínicos.' }

  const analise = planoFillerSchema.safeParse(entrada)
  if (!analise.success) {
    return { ok: false, erro: 'Confira os campos do plano de preenchimento.' }
  }
  const dados = analise.data

  const supabase = await createServerClient()
  const campos = {
    produto_nome: dados.produto_nome,
    validade: dados.validade,
    lote: dados.lote,
    marca: dados.marca,
    realizado_em: dados.realizado_em,
    anotacao_json: dados.anotacao_json,
  }

  let planoId = dados.id

  if (planoId) {
    const { data: existente, error: erroBusca } = await supabase
      .from('filler_plans')
      .select('id')
      .eq('id', planoId)
      .eq('patient_id', dados.pacienteId)
      .maybeSingle()
    if (erroBusca || !existente) {
      return { ok: false, erro: 'Plano não encontrado para este paciente.' }
    }
    const { error } = await supabase.from('filler_plans').update(campos).eq('id', planoId)
    if (error) return { ok: false, erro: 'Não foi possível atualizar o plano. Tente de novo.' }

    const { data: antigos } = await supabase
      .from('filler_plan_items')
      .select('id')
      .eq('plan_id', planoId)

    if (dados.itens.length > 0) {
      const { error: erroItens } = await supabase.from('filler_plan_items').insert(
        dados.itens.map((item) => ({
          plan_id: planoId,
          produto: item.produto,
          regiao: item.regiao,
          camada: item.camada,
          tecnica: item.tecnica,
          quantidade_ml: item.quantidade_ml,
          procedimento_id: item.procedimento_id,
          ordem: item.ordem,
        })),
      )
      if (erroItens) {
        return { ok: false, erro: 'Plano gravado, mas as linhas falharam. Tente de novo.' }
      }
      if (antigos && antigos.length > 0) {
        const { error: erroApaga } = await supabase
          .from('filler_plan_items')
          .delete()
          .in(
            'id',
            antigos.map((a) => a.id),
          )
        if (erroApaga) return { ok: false, erro: 'Não foi possível atualizar as linhas.' }
      }
    } else if (antigos && antigos.length > 0) {
      const { error: erroApaga } = await supabase
        .from('filler_plan_items')
        .delete()
        .eq('plan_id', planoId)
      if (erroApaga) return { ok: false, erro: 'Não foi possível atualizar as linhas.' }
    }
  } else {
    const { data: plano, error } = await supabase
      .from('filler_plans')
      .insert({
        patient_id: dados.pacienteId,
        registrado_por: sessao.userId,
        ...campos,
      })
      .select('id')
      .single()
    if (error || !plano) {
      return { ok: false, erro: 'Não foi possível salvar o plano. Tente de novo.' }
    }
    planoId = plano.id

    if (dados.itens.length > 0) {
      const { error: erroItens } = await supabase.from('filler_plan_items').insert(
        dados.itens.map((item) => ({
          plan_id: planoId,
          produto: item.produto,
          regiao: item.regiao,
          camada: item.camada,
          tecnica: item.tecnica,
          quantidade_ml: item.quantidade_ml,
          procedimento_id: item.procedimento_id,
          ordem: item.ordem,
        })),
      )
      if (erroItens) {
        return { ok: false, erro: 'Plano gravado, mas as linhas falharam. Tente de novo.' }
      }
    }
  }

  if (!planoId) {
    return { ok: false, erro: 'Não foi possível salvar o plano. Tente de novo.' }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: dados.id ? 'plano_filler:atualizado' : 'plano_filler:criado',
    entidade: 'filler_plans',
    registro_id: planoId,
  })

  // Sem revalidatePath — ver salvarPlanoBotox (editor não pode remountar).
  return { ok: true, id: planoId }
}

export async function apagarPlanoBotox(entrada: unknown): Promise<ResultadoSalvarPlano> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. apaga planos clínicos.' }

  const analise = z.object({ id: z.uuid(), pacienteId: z.uuid() }).safeParse(entrada)
  if (!analise.success) return { ok: false, erro: 'Plano inválido.' }

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('botox_plans')
    .delete()
    .eq('id', analise.data.id)
    .eq('patient_id', analise.data.pacienteId)
  if (error) return { ok: false, erro: 'Não foi possível apagar o plano.' }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'plano_botox:apagado',
    entidade: 'botox_plans',
    registro_id: analise.data.id,
  })

  revalidatePath(`/pacientes/${analise.data.pacienteId}`)
  return { ok: true, id: analise.data.id }
}

export async function apagarPlanoFiller(entrada: unknown): Promise<ResultadoSalvarPlano> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. apaga planos clínicos.' }

  const analise = z.object({ id: z.uuid(), pacienteId: z.uuid() }).safeParse(entrada)
  if (!analise.success) return { ok: false, erro: 'Plano inválido.' }

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('filler_plans')
    .delete()
    .eq('id', analise.data.id)
    .eq('patient_id', analise.data.pacienteId)
  if (error) return { ok: false, erro: 'Não foi possível apagar o plano.' }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'plano_filler:apagado',
    entidade: 'filler_plans',
    registro_id: analise.data.id,
  })

  revalidatePath(`/pacientes/${analise.data.pacienteId}`)
  return { ok: true, id: analise.data.id }
}
