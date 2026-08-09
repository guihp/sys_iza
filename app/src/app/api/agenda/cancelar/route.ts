/**
 * POST /api/agenda/cancelar — marca consulta como cancelada.
 */

import { NextResponse } from 'next/server'
import { autenticarPedidoApi } from '@/lib/api/autenticar-pedido'
import { lerJsonDoPedido } from '@/lib/api/ler-json'
import { executarCancelamento } from '@/lib/agenda/cancelar'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await autenticarPedidoApi(request)
  if (!auth.ok) return auth.resposta

  const corpo = await lerJsonDoPedido(request)
  if (!corpo.ok) return corpo.resposta

  const resultado = await executarCancelamento(
    auth.pedido.supabase,
    corpo.corpo,
    auth.pedido.atorId,
  )

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 422 })
  }
  return NextResponse.json(resultado)
}
