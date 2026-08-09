/**
 * POST /api/leads — cria lead (mesmo caminho do botão NOVO LEAD).
 */

import { NextResponse } from 'next/server'
import { autenticarPedidoApi } from '@/lib/api/autenticar-pedido'
import { lerJsonDoPedido } from '@/lib/api/ler-json'
import { executarCriacaoDeLead } from '@/lib/leads/criar'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await autenticarPedidoApi(request)
  if (!auth.ok) return auth.resposta

  const corpo = await lerJsonDoPedido(request)
  if (!corpo.ok) return corpo.resposta

  const resultado = await executarCriacaoDeLead(
    auth.pedido.supabase,
    corpo.corpo,
    auth.pedido.atorId,
  )

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 422 })
  }
  return NextResponse.json(resultado, { status: 201 })
}
