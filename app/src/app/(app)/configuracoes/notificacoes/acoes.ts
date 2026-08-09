'use server'

import { z } from 'zod'
import { requireSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'

const schemaSubscription = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().max(500).optional(),
})

export type ResultadoPush = { ok: true } | { ok: false; erro: string }

/**
 * Upsert da subscription deste device para o usuário logado.
 *
 * Só equipe (qualquer sessão válida): pacientes não usam o app. A RLS garante
 * user_id = auth.uid().
 */
export async function salvarPushSubscription(entrada: unknown): Promise<ResultadoPush> {
  const sessao = await requireSessao()
  const analise = schemaSubscription.safeParse(entrada)
  if (!analise.success) {
    return { ok: false, erro: 'Subscription de push inválida.' }
  }

  const dados = analise.data
  const supabase = await createServerClient()
  const agora = new Date().toISOString()

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: sessao.userId,
      endpoint: dados.endpoint,
      p256dh: dados.p256dh,
      auth: dados.auth,
      user_agent: dados.userAgent ?? null,
      atualizado_em: agora,
    },
    { onConflict: 'endpoint' },
  )

  if (error) {
    return { ok: false, erro: 'Não foi possível salvar a inscrição de notificação.' }
  }
  return { ok: true }
}

/**
 * Remove a subscription deste endpoint (toggle off / logout / endpoint morto).
 */
export async function removerPushSubscription(endpoint: unknown): Promise<ResultadoPush> {
  const sessao = await requireSessao()
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return { ok: false, erro: 'Endpoint inválido.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', sessao.userId)
    .eq('endpoint', endpoint.trim())

  if (error) {
    return { ok: false, erro: 'Não foi possível remover a inscrição.' }
  }
  return { ok: true }
}
