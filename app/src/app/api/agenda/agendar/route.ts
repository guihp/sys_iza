/**
 * POST /api/agenda/agendar — cria consulta e dispara o mesmo push da UI.
 *
 * Autenticação (uma das duas):
 *   1. Cookie de sessão da equipe (usuário logado no app)
 *   2. `AGENDA_API_KEY` via `Authorization: Bearer …` ou `x-api-key`
 *
 * Sem sessão e sem chave válida → 401. Sem `AGENDA_API_KEY` no ambiente, o
 * caminho por chave fica desligado (não há endpoint aberto).
 */

import { NextResponse } from 'next/server'
import { getSessao } from '@/auth/session'
import { executarAgendamento } from '@/lib/agenda/agendar'
import { chaveApiBate, extrairChaveDoPedido } from '@/lib/agenda/autenticar-api'
import { serverEnv } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const sessao = await getSessao()
  const chaveFornecida = extrairChaveDoPedido(request.headers)
  const chaveEsperada = serverEnv().AGENDA_API_KEY
  const viaApiKey = chaveApiBate(chaveFornecida, chaveEsperada)

  if (!sessao && !viaApiKey) {
    return NextResponse.json(
      { ok: false, erro: 'Não autorizado. Use sessão logada ou AGENDA_API_KEY.' },
      { status: 401 },
    )
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, erro: 'JSON inválido no corpo do pedido.' },
      { status: 400 },
    )
  }

  // API key: service role (sem cookie). Sessão: client com RLS do usuário.
  const supabase = viaApiKey ? createAdminClient() : await createServerClient()
  const atorId = sessao?.userId ?? null

  const resultado = await executarAgendamento(supabase, corpo, atorId)

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 422 })
  }
  return NextResponse.json(resultado, { status: 201 })
}
