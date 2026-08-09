'use server'

import { requireSessao } from '@/auth/session'
import type { PatientStage } from './estagios'
import { executarMoverEstagio } from '@/lib/leads/mover-estagio'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Move o paciente de estágio no funil.
 *
 * A regra mora em `@/lib/leads/mover-estagio` (também usada pela API HTTP).
 * Continua lançando em falha para a UI do kanban, que espera exceção.
 */
export async function moverEstagio(pacienteId: string, estagio: PatientStage) {
  const sessao = await requireSessao()
  const resultado = await executarMoverEstagio(
    await createServerClient(),
    { pacienteId, estagio },
    sessao.userId,
  )
  if (!resultado.ok) {
    throw new Error(resultado.erro)
  }
}
