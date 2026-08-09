/**
 * GET /api/pacientes — lista id, nome, telefone… para n8n.
 */

import { NextResponse } from 'next/server'
import { autenticarPedidoApi } from '@/lib/api/autenticar-pedido'
import { listarPacientesApi } from '@/lib/api/pacientes'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await autenticarPedidoApi(request)
  if (!auth.ok) return auth.resposta

  const resultado = await listarPacientesApi(auth.pedido.supabase)
  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 500 })
  }
  return NextResponse.json(resultado)
}
