import { NextResponse } from 'next/server'

/** Lê o corpo JSON ou devolve 400. */
export async function lerJsonDoPedido(
  request: Request,
): Promise<{ ok: true; corpo: unknown } | { ok: false; resposta: NextResponse }> {
  try {
    const corpo: unknown = await request.json()
    return { ok: true, corpo }
  } catch {
    return {
      ok: false,
      resposta: NextResponse.json(
        { ok: false, erro: 'JSON inválido no corpo do pedido.' },
        { status: 400 },
      ),
    }
  }
}
