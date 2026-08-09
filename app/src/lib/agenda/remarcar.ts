/**
 * Remarcação de consulta — compartilhada pela API HTTP (e futura UI).
 *
 * Fora de `'use server'`: exporta schema Zod + resultado tipado.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { detectarConflito, type Slot } from '@/domain/scheduling/conflict'
import { validarHorarioDeAtendimento } from '@/domain/scheduling/working-hours'
import { dataDaClinica, deslocarData, horaDaClinica, instanteDaClinica } from '@/lib/datetime'
import { sincronizarConsultaNoGoogle } from '@/lib/google-agenda'
import {
  cancelarLembretesPendentesDaConsulta,
  planejarLembretesDaConsulta,
} from '@/lib/lembretes'

const CAMINHO_AGENDA = '/agenda'
const SOBREPOSICAO = '23P01'

export const schemaRemarcacao = z.object({
  consultaId: z.uuid(),
  /** Instante absoluto ISO 8601 com `Z` — mesmo contrato de `schemaAgendamento`. */
  inicio: z.iso.datetime(),
  /** Se omitido, mantém o procedimento atual. */
  procedimentoId: z.uuid().optional(),
})

export type ResultadoDeRemarcacao = { ok: true; id: string } | { ok: false; erro: string }

/**
 * Move o horário (e opcionalmente o procedimento) de uma consulta viva.
 *
 * Cancela lembretes pendentes, atualiza início/fim, replaneja lembretes e
 * sincroniza o Google. Não inventa regra de funil — estágio do paciente fica.
 */
export async function executarRemarcacao(
  supabase: SupabaseClient,
  entrada: unknown,
  atorId: string | null,
): Promise<ResultadoDeRemarcacao> {
  const analise = schemaRemarcacao.safeParse(entrada)
  if (!analise.success) {
    return { ok: false, erro: 'Informe consultaId e o novo horário (inicio ISO com Z).' }
  }
  const dados = analise.data

  const { data: consulta, error: erroConsulta } = await supabase
    .from('appointments')
    .select('id, patient_id, procedure_id, status')
    .eq('id', dados.consultaId)
    .single()

  if (erroConsulta || !consulta) {
    return { ok: false, erro: 'Consulta não encontrada.' }
  }
  if (consulta.status === 'cancelado') {
    return { ok: false, erro: 'Consulta cancelada não pode ser remarcada.' }
  }

  const procedimentoId = dados.procedimentoId ?? consulta.procedure_id
  const { data: procedimento, error: erroProcedimento } = await supabase
    .from('procedures')
    .select('id, duracao_minutos')
    .eq('id', procedimentoId)
    .single()

  if (erroProcedimento || !procedimento) {
    return { ok: false, erro: 'Procedimento não encontrado no catálogo.' }
  }

  const inicio = new Date(dados.inicio)
  const fim = new Date(inicio.getTime() + procedimento.duracao_minutos * 60_000)

  const expediente = validarHorarioDeAtendimento({ inicio, fim })
  if (!expediente.ok) return { ok: false, erro: expediente.motivo }

  const diaNaClinica = dataDaClinica(inicio)
  const janelaInicio = new Date(instanteDaClinica(diaNaClinica, 0).getTime() - 12 * 3_600_000)
  const janelaFim = instanteDaClinica(deslocarData(diaNaClinica, 1), 0)

  const { data: doDia, error: erroAgenda } = await supabase
    .from('appointments')
    .select('id, inicio, fim, status')
    .gte('inicio', janelaInicio.toISOString())
    .lt('inicio', janelaFim.toISOString())

  if (erroAgenda) {
    return { ok: false, erro: 'Não foi possível conferir a agenda. Tente de novo.' }
  }

  const existentes: Slot[] = (doDia ?? []).map((linha) => ({
    id: linha.id,
    inicio: new Date(linha.inicio),
    fim: new Date(linha.fim),
    cancelado: linha.status === 'cancelado',
  }))

  const conflito = detectarConflito({ id: dados.consultaId, inicio, fim }, existentes)
  if (conflito) {
    return {
      ok: false,
      erro: `Já existe consulta das ${horaDaClinica(conflito.inicio)} às ${horaDaClinica(conflito.fim)} nesse horário.`,
    }
  }

  const cancelamento = await cancelarLembretesPendentesDaConsulta(supabase, dados.consultaId)
  if (!cancelamento.ok) {
    return { ok: false, erro: 'Não foi possível atualizar os lembretes. Tente de novo.' }
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      procedure_id: procedimentoId,
    })
    .eq('id', dados.consultaId)

  if (error) {
    if (error.code === SOBREPOSICAO) {
      return { ok: false, erro: 'Esse horário acabou de ser ocupado. Escolha outro.' }
    }
    return { ok: false, erro: 'Não foi possível remarcar. Tente de novo.' }
  }

  await supabase.from('audit_log').insert({
    ator: atorId,
    acao: 'remarcou',
    entidade: 'appointments',
    registro_id: dados.consultaId,
  })

  await planejarLembretesDaConsulta(supabase, {
    appointmentId: dados.consultaId,
    patientId: consulta.patient_id,
    inicio,
  })

  await sincronizarConsultaNoGoogle(supabase, dados.consultaId)

  revalidatePath(CAMINHO_AGENDA)
  return { ok: true, id: dados.consultaId }
}
