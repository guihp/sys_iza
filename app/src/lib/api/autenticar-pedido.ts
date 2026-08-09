/**
 * Autenticação compartilhada das rotas `/api/*`.
 *
 * Aceita sessão da equipe (cookie) OU chave HTTP (`API_KEY` / `AGENDA_API_KEY`
 * via Bearer ou `x-api-key`). Sem os dois → 401.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSessao } from '@/auth/session'
import { chaveApiBate, extrairChaveDoPedido } from '@/lib/agenda/autenticar-api'
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
  const chaveEsperada = chaveDaApiHttp(serverEnv())
  const viaApiKey = chaveApiBate(chaveFornecida, chaveEsperada)

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
