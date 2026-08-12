'use server'

import { requireSessao } from '@/auth/session'
import {
  executarAgendamento,
  type ResultadoDeAgendamento,
} from '@/lib/agenda/agendar'
import {
  executarCancelamento,
  type ResultadoDeCancelamento,
} from '@/lib/agenda/cancelar'
import {
  executarRemarcacao,
  type ResultadoDeRemarcacao,
} from '@/lib/agenda/remarcar'
import { createServerClient } from '@/lib/supabase/server'

export type { ResultadoDeAgendamento, ResultadoDeCancelamento, ResultadoDeRemarcacao }

/**
 * Marca uma consulta (UI / Server Action).
 *
 * Autenticação por sessão. A lógica compartilhada com a API HTTP mora em
 * `@/lib/agenda/agendar` — inclusive o push à equipe.
 */
export async function agendarConsulta(entrada: unknown): Promise<ResultadoDeAgendamento> {
  const sessao = await requireSessao()
  const supabase = await createServerClient()
  return executarAgendamento(supabase, entrada, sessao.userId)
}

/** Remarca horário e/ou procedimento (UI). */
export async function remarcarConsulta(entrada: unknown): Promise<ResultadoDeRemarcacao> {
  const sessao = await requireSessao()
  const supabase = await createServerClient()
  return executarRemarcacao(supabase, entrada, sessao.userId)
}

/** Cancela consulta viva (UI). */
export async function cancelarConsulta(entrada: unknown): Promise<ResultadoDeCancelamento> {
  const sessao = await requireSessao()
  const supabase = await createServerClient()
  return executarCancelamento(supabase, entrada, sessao.userId)
}
