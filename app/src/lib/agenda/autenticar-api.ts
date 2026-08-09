/**
 * Autenticação da API HTTP (agenda, leads, listagens) — puro, sem I/O.
 *
 * Aceita `Authorization: Bearer <chave>` ou `x-api-key: <chave>`.
 * Comparação em tempo constante quando os comprimentos batem.
 * A chave esperada vem de `API_KEY` (ou legado `AGENDA_API_KEY`).
 */

import { timingSafeEqual } from 'node:crypto'

/**
 * Extrai a chave candidata dos cabeçalhos do pedido.
 * Preferência: Bearer, depois `x-api-key`.
 */
export function extrairChaveDoPedido(cabecalhos: Headers): string | null {
  const auth = cabecalhos.get('authorization')
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim())
    if (match?.[1]) return match[1].trim()
  }
  const apiKey = cabecalhos.get('x-api-key')
  if (apiKey && apiKey.trim()) return apiKey.trim()
  return null
}

/**
 * Confere a chave fornecida com a esperada (`API_KEY` / `AGENDA_API_KEY`).
 *
 * Sem chave configurada no ambiente, nunca autentica por API key — evita
 * endpoint aberto quando a variável está vazia ou ausente.
 */
export function chaveApiBate(fornecida: string | null, esperada: string | undefined): boolean {
  if (!fornecida || !esperada) return false
  const a = Buffer.from(fornecida)
  const b = Buffer.from(esperada)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
