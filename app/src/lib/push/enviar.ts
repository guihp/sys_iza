/**
 * Envio Web Push para a equipe após um agendamento.
 *
 * Best-effort: falha aqui não desfaz a consulta. Endpoints mortos (404/410)
 * são apagados para não insistir em device que desinstalou o PWA.
 */

import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  formatarPayloadDeAgendamento,
  type DadosDoAgendamentoParaPush,
} from '@/lib/push/payload'
import { configuracaoVapid } from '@/lib/push/vapid'

type LinhaDeSubscription = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Avisa dra + secretaria com subscription ativa.
 *
 * Usa service role para listar subscriptions de toda a equipe (RLS só deixa
 * cada um ver a própria). Sem VAPID configurado, sai calado.
 */
export async function avisarEquipeDeNovoAgendamento(
  dados: DadosDoAgendamentoParaPush,
): Promise<void> {
  try {
    const vapid = configuracaoVapid()
    if (!vapid) return

    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

    const admin = createAdminClient()
    const { data: perfis, error: erroPerfis } = await admin
      .from('profiles')
      .select('id')
      .eq('ativo', true)
      .in('role', ['dra', 'secretaria'])

    if (erroPerfis || !perfis?.length) return

    const ids = perfis.map((p) => p.id)
    const { data: subs, error: erroSubs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', ids)

    if (erroSubs || !subs?.length) return

    const payload = formatarPayloadDeAgendamento(dados)
    const corpo = JSON.stringify(payload)

    await Promise.all(
      (subs as LinhaDeSubscription[]).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            corpo,
          )
        } catch (erro: unknown) {
          const status =
            erro && typeof erro === 'object' && 'statusCode' in erro
              ? Number((erro as { statusCode: number }).statusCode)
              : null
          // 404/410 = endpoint morto (PWA desinstalado ou permissão revogada).
          if (status === 404 || status === 410) {
            await admin.from('push_subscriptions').delete().eq('id', sub.id)
          }
        }
      }),
    )
  } catch {
    // Qualquer falha de env/rede: o agendamento já está gravado.
  }
}
