/**
 * Hash e comparação da chave da API HTTP persistida em `clinic_settings`.
 *
 * Padrão webhook-secret: SHA-256 do plaintext + compare timing-safe.
 * O plaintext nunca vai para o banco — só o hex do digest.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Gera chave aleatória (64 chars hex) para mostrar uma vez na UI. */
export function gerarPlaintextDaChaveApi(): string {
  return randomBytes(32).toString('hex')
}

/** SHA-256 hex da chave (armazenamento). */
export function hashDaChaveApi(chave: string): string {
  return createHash('sha256').update(chave, 'utf8').digest('hex')
}

/** Prefixo curto para status no painel (não autentica). */
export function prefixoDaChaveApi(chave: string, tamanho = 8): string {
  return chave.slice(0, tamanho)
}

/**
 * Confere se a chave fornecida bate com o hash persistido.
 * Hash inválido / comprimentos diferentes → false (sem throw).
 */
export function hashDaChaveApiBate(chave: string, hashHex: string | null | undefined): boolean {
  if (!chave || !hashHex) return false
  const esperado = hashHex.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(esperado)) return false

  const a = Buffer.from(hashDaChaveApi(chave), 'hex')
  const b = Buffer.from(esperado, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
