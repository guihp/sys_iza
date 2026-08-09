/**
 * POST /api/leads/[id]/estagio — move o cartão no funil.
 */

import { NextResponse } from 'next/server'
import { autenticarPedidoApi } from '@/lib/api/autenticar-pedido'
import { lerJsonDoPedido } from '@/lib/api/ler-json'
import { executarMoverEstagio } from '@/lib/leads/mover-estagio'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
) {
  const auth = await autenticarPedidoApi(request)
  if (!auth.ok) return auth.resposta

  const corpo = await lerJsonDoPedido(request)
  if (!corpo.ok) return corpo.resposta

  const { id } = await contexto.params
  const entrada =
    corpo.corpo && typeof corpo.corpo === 'object'
      ? { ...(corpo.corpo as Record<string, unknown>), pacienteId: id }
      : { pacienteId: id }

  const resultado = await executarMoverEstagio(
    auth.pedido.supabase,
    entrada,
    auth.pedido.atorId,
  )

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 422 })
  }
  return NextResponse.json(resultado)
}
