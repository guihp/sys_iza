/**
 * PATCH /api/leads/[id] — atualiza campos de CRM do lead/paciente.
 */

import { NextResponse } from 'next/server'
import { autenticarPedidoApi } from '@/lib/api/autenticar-pedido'
import { lerJsonDoPedido } from '@/lib/api/ler-json'
import { executarAtualizacaoDeLead } from '@/lib/leads/atualizar'

export const runtime = 'nodejs'

export async function PATCH(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
) {
  const auth = await autenticarPedidoApi(request)
  if (!auth.ok) return auth.resposta

  const corpo = await lerJsonDoPedido(request)
  if (!corpo.ok) return corpo.resposta

  const { id } = await contexto.params
  const resultado = await executarAtualizacaoDeLead(
    auth.pedido.supabase,
    id,
    corpo.corpo,
    auth.pedido.atorId,
  )

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 422 })
  }
  return NextResponse.json(resultado)
}
