/**
 * GET /api/procedimentos — catálogo ativo (id, nome, duração…).
 */

import { NextResponse } from 'next/server'
import { autenticarPedidoApi } from '@/lib/api/autenticar-pedido'
import { listarProcedimentosApi } from '@/lib/api/procedimentos'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await autenticarPedidoApi(request)
  if (!auth.ok) return auth.resposta

  const url = new URL(request.url)
  const todos = url.searchParams.get('todos') === '1'

  const resultado = await listarProcedimentosApi(auth.pedido.supabase, {
    soAtivos: !todos,
  })
  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 500 })
  }
  return NextResponse.json(resultado)
}
