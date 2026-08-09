/**
 * POST /api/agenda/remarcar — move horário (e opcionalmente procedimento).
 */

import { NextResponse } from 'next/server'
import { autenticarPedidoApi } from '@/lib/api/autenticar-pedido'
import { lerJsonDoPedido } from '@/lib/api/ler-json'
import { executarRemarcacao } from '@/lib/agenda/remarcar'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await autenticarPedidoApi(request)
  if (!auth.ok) return auth.resposta

  const corpo = await lerJsonDoPedido(request)
  if (!corpo.ok) return corpo.resposta

  const resultado = await executarRemarcacao(
    auth.pedido.supabase,
    corpo.corpo,
    auth.pedido.atorId,
  )

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 422 })
  }
  return NextResponse.json(resultado)
}
