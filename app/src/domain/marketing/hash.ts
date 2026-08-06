/**
 * Hash dos identificadores que vão para a Meta.
 *
 * Módulo puro: só `node:crypto`. Sem Supabase, sem React, sem Next.
 *
 * A Meta não aceita telefone nem e-mail em claro na Conversions API — o
 * `user_data` vai com SHA-256. Isso é bom para nós antes de ser exigência dela:
 * é o que impede que um bug de payload transforme a fila de conversões num
 * vazamento de agenda telefônica de pacientes de uma clínica de estética.
 *
 * O hash só serve para alguma coisa se as duas pontas normalizarem igual. A Meta
 * hasheia o que ela tem depois de aplicar as regras dela; se normalizarmos
 * diferente, os dois hashes não batem, a correspondência (EMQ) despenca e o
 * sintoma é "os eventos chegam mas não casam com ninguém" — que não parece um bug
 * de formatação. Daí este arquivo ser separado, pequeno e com vetor de teste
 * fixo.
 *
 * As regras aplicadas aqui:
 *
 *   - telefone: só dígitos, com código do país, SEM o `+` e sem espaço, traço ou
 *     parêntese. `+5511987654321` vira `5511987654321`.
 *   - e-mail: minúsculas, sem espaço nas bordas.
 *   - texto em geral (nome, cidade): minúsculas, sem espaço nas bordas.
 *
 * O que NÃO é feito de propósito: remover pontos e o que vem depois do `+` no
 * usuário do e-mail (o truque do Gmail). Isso é normalização de provedor
 * específico, a Meta não pede, e aplicá-la só de um lado quebraria a
 * correspondência em vez de melhorá-la.
 */

import { createHash } from 'node:crypto'

/** Minúsculas e sem espaço nas bordas — a regra geral da Meta para texto. */
export function normalizarTexto(valor: string): string {
  return valor.trim().toLowerCase()
}

/**
 * E.164 → só dígitos.
 *
 * Aceita qualquer coisa que já esteja em E.164 (o formato garantido pelo check
 * de `patients.telefone` e de `lead_attribution.telefone`) e devolve os dígitos.
 * Não normaliza número brasileiro solto: para isso existe `normalizarTelefone`
 * em `src/lib/phone.ts`, que é quem sabe distinguir o DDD 55 do código de país.
 * Chamar aqui um número não normalizado devolve dígitos, sim — mas os dígitos
 * errados, e é por isso que o hash sai de quem já passou por lá.
 */
export function normalizarTelefoneParaHash(e164: string): string {
  return e164.replace(/\D/g, '')
}

/** SHA-256 em hexadecimal minúsculo, que é o formato que a Meta espera. */
export function sha256(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex')
}

/**
 * Telefone em E.164 → SHA-256 pronto para o `user_data.ph`.
 *
 * `null` para entrada vazia, e não hash de string vazia: o hash de `''` é um
 * valor perfeitamente válido de 64 caracteres que a Meta aceitaria e tentaria
 * casar com alguém. Mandar o mesmo hash constante para toda paciente sem
 * telefone é pior do que não mandar campo nenhum.
 */
export function hashTelefone(e164: string | null | undefined): string | null {
  if (!e164) return null
  const digitos = normalizarTelefoneParaHash(e164)
  return digitos === '' ? null : sha256(digitos)
}

/** E-mail → SHA-256 pronto para o `user_data.em`. Mesma regra do `null`. */
export function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const limpo = normalizarTexto(email)
  return limpo === '' ? null : sha256(limpo)
}
