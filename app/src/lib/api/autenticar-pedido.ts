/**
 * Autenticação compartilhada das rotas `/api/*`.
 *
 * Aceita sessão da equipe (cookie) OU chave HTTP:
 * - `API_KEY` / `AGENDA_API_KEY` no env (Coolify), ou
 * - hash em `clinic_settings.api_key_hash` (gerada no painel).
 *
 * Cabeçalhos: Bearer ou `x-api-key`. Sem os dois → 401.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSessao } from '@/auth/session'
import { chaveApiBate, extrairChaveDoPedido } from '@/lib/agenda/autenticar-api'
import { hashDaChaveApiBate } from '@/lib/api/chave-api-hash'
import { chaveDaApiHttp, serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export type PedidoAutenticado = {
  supabase: SupabaseClient
  atorId: string | null
  viaApiKey: boolean
}

export type ResultadoAuthPedido =
  | { ok: true; pedido: PedidoAutenticado }
  | { ok: false; resposta: NextResponse }

/**
 * Resolve quem chama a API e qual cliente Supabase usar.
 *
 * Chave válida → service role (sem cookie). Sessão → client com RLS do usuário.
 */
export async function autenticarPedidoApi(request: Request): Promise<ResultadoAuthPedido> {
  const sessao = await getSessao()
  const chaveFornecida = extrairChaveDoPedido(request.headers)
  const viaApiKey = await chaveHttpValida(chaveFornecida)

  if (!sessao && !viaApiKey) {
    return {
      ok: false,
      resposta: NextResponse.json(
        {
          ok: false,
          erro: 'Não autorizado. Use sessão logada ou API_KEY (Authorization: Bearer … / x-api-key).',
        },
        { status: 401 },
      ),
    }
  }

  const supabase = viaApiKey ? createAdminClient() : await createServerClient()
  return {
    ok: true,
    pedido: {
      supabase,
      atorId: sessao?.userId ?? null,
      viaApiKey,
    },
  }
}

/**
 * Env primeiro (barato); se não bater, confere hash no banco via service role.
 */
export async function chaveHttpValida(fornecida: string | null): Promise<boolean> {
  if (!fornecida) return false

  const chaveEsperada = chaveDaApiHttp(serverEnv())
  if (chaveApiBate(fornecida, chaveEsperada)) return true

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('clinic_settings')
      .select('api_key_hash')
      .eq('id', true)
      .maybeSingle()

    if (error || !data?.api_key_hash) return false
    return hashDaChaveApiBate(fornecida, data.api_key_hash as string)
  } catch {
    return false
  }
}
