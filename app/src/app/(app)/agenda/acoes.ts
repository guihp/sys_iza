'use server'

import { requireSessao } from '@/auth/session'
import {
  executarAgendamento,
  type ResultadoDeAgendamento,
} from '@/lib/agenda/agendar'
import { createServerClient } from '@/lib/supabase/server'

export type { ResultadoDeAgendamento }

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
