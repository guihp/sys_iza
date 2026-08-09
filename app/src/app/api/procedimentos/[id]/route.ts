/**
 * GET /api/procedimentos/[id]
 */

import { NextResponse } from 'next/server'
import { autenticarPedidoApi } from '@/lib/api/autenticar-pedido'
import { obterProcedimentoApi } from '@/lib/api/procedimentos'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  contexto: { params: Promise<{ id: string }> },
) {
  const auth = await autenticarPedidoApi(request)
  if (!auth.ok) return auth.resposta

  const { id } = await contexto.params
  const resultado = await obterProcedimentoApi(auth.pedido.supabase, id)
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, erro: resultado.erro },
      { status: resultado.status },
    )
  }
  return NextResponse.json({ ok: true, procedimento: resultado.procedimento })
}
