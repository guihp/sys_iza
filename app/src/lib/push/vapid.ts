/**
 * Credenciais VAPID — interruptor opcional do Web Push (só servidor).
 *
 * Mesmo desenho do Google/Meta: sem as chaves o sistema sobe e funciona;
 * só o push fica desligado. A pública também existe como NEXT_PUBLIC_* para
 * o browser assinar; a privada nunca sai do servidor.
 */

import { serverEnv } from '@/lib/env'

export type ConfiguracaoVapid = {
  publicKey: string
  privateKey: string
  subject: string
}

/**
 * Ligado só com pública + privada. Subject tem default se VAPID_SUBJECT
 * estiver vazio — alguns push services exigem um `mailto:` ou URL.
 */
export function configuracaoVapid(): ConfiguracaoVapid | null {
  const env = serverEnv()
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null

  const subject = env.VAPID_SUBJECT ?? 'mailto:dono@clinicaizadora.local'
  return { publicKey, privateKey, subject }
}
