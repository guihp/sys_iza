/**
 * Adaptador do Resend — o e-mail da clínica.
 *
 * Mesma forma e MESMA classificação de erro do adaptador da Evolution, por
 * construção: os dois delegam a `postarJson` de `@/integrations/envio`. O worker
 * trata WhatsApp e e-mail pelo mesmo caminho de retentativa, e isso só se
 * sustenta se "o que é transitório" tiver uma definição única.
 *
 * Servidor e worker apenas. A `RESEND_API_KEY` não pode chegar ao browser.
 */

import { serverEnv } from '@/lib/env'
import {
  ErroDeEnvio,
  TIMEOUT_PADRAO_MS,
  garantirServidor,
  postarJson,
  sanitizarMensagem,
} from '@/integrations/envio'

export { ErroDeEnvio } from '@/integrations/envio'
export type { MotivoDeFalha } from '@/integrations/envio'

const PROVEDOR = 'Resend'
const ENDPOINT = 'https://api.resend.com/emails'

/**
 * Checagem mínima de endereço, e mínima de propósito. Validar e-mail por regex
 * "completa" é folclore: a regra real é o servidor do outro lado aceitar. O que
 * esta linha evita é gastar uma requisição — e uma tentativa da fila — com um
 * campo obviamente vazio ou digitado como texto livre.
 */
const ENDERECO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type ConfigEmail = {
  apiKey: string
  remetente: string
  /** Tempo máximo de espera. Padrão: `TIMEOUT_PADRAO_MS`. */
  timeoutMs?: number
}

export type MensagemDeEmail = { para: string; assunto: string; html: string }

/** O que o worker precisa para preencher `reminder_jobs.provider_message_id`. */
export type ResultadoDeEnvio = { providerMessageId: string }

/** Ver a nota sobre injeção em `criarEvolutionClient`: vale igual aqui. */
export function criarEmailClient(config?: ConfigEmail, fetchImpl: typeof fetch = fetch) {
  garantirServidor(PROVEDOR)

  const cfg: ConfigEmail =
    config ??
    (() => {
      const env = serverEnv()
      return { apiKey: env.RESEND_API_KEY, remetente: env.EMAIL_FROM }
    })()

  const timeoutMs = cfg.timeoutMs ?? TIMEOUT_PADRAO_MS

  return {
    async enviar({ para, assunto, html }: MensagemDeEmail): Promise<ResultadoDeEnvio> {
      if (!ENDERECO.test(para.trim())) {
        throw new ErroDeEnvio(
          `E-mail inválido para envio: ${sanitizarMensagem(para, [])}`,
          'destinatario',
        )
      }

      // Assunto vazio é tratado como spam pelos provedores, e corpo vazio é
      // template quebrado. Nos dois casos o envio é inútil, então falha aqui em
      // vez de queimar uma tentativa da fila.
      if (assunto.trim().length === 0) {
        throw new ErroDeEnvio('E-mail sem assunto: os provedores tratam como spam', 'requisicao')
      }
      if (html.trim().length === 0) {
        throw new ErroDeEnvio(
          'Corpo vazio: o template renderizado não produziu conteúdo',
          'requisicao',
        )
      }

      const dados = await postarJson({
        provedor: PROVEDOR,
        url: ENDPOINT,
        cabecalhos: { Authorization: `Bearer ${cfg.apiKey}` },
        corpo: { from: cfg.remetente, to: [para.trim()], subject: assunto, html },
        fetchImpl,
        timeoutMs,
        segredos: [cfg.apiKey],
      })

      const id = (dados as { id?: string } | null)?.id
      return { providerMessageId: id ?? '' }
    },
  }
}

export type EmailClient = ReturnType<typeof criarEmailClient>
