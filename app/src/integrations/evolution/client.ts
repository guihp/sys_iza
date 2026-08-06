/**
 * Adaptador da Evolution API — o WhatsApp da clínica.
 *
 * Fino de propósito: monta a requisição, valida o que dá para validar sem rede
 * e traduz a resposta para o contrato de `@/integrations/envio`. Nenhuma regra
 * de negócio mora aqui — quem decide o que enviar, para quem e quando é
 * `src/domain/reminders/`, e quem persiste é o worker.
 *
 * Servidor e worker apenas. A `EVOLUTION_API_KEY` não pode chegar ao browser:
 * ver `garantirServidor()`.
 */

import { serverEnv } from '@/lib/env'
import { normalizarTelefone } from '@/lib/phone'
import {
  ErroDeEnvio,
  TIMEOUT_PADRAO_MS,
  garantirServidor,
  postarJson,
  sanitizarMensagem,
} from '@/integrations/envio'

// Reexportado porque o adaptador é a porta de entrada natural de quem despacha
// WhatsApp: quem importa o cliente precisa do erro para classificá-lo.
export { ErroDeEnvio } from '@/integrations/envio'
export type { MotivoDeFalha } from '@/integrations/envio'

const PROVEDOR = 'Evolution API'

export type ConfigEvolution = {
  url: string
  apiKey: string
  instancia: string
  /** Tempo máximo de espera. Padrão: `TIMEOUT_PADRAO_MS`. */
  timeoutMs?: number
}

export type MensagemDeTexto = { telefone: string; texto: string }

/** O que o worker precisa para preencher `reminder_jobs.provider_message_id`. */
export type ResultadoDeEnvio = { providerMessageId: string }

/**
 * Cria o cliente.
 *
 * `config` e `fetchImpl` são injetáveis com valor padrão, e isso não é
 * cerimônia: sem eles o adaptador só seria testável com rede de verdade ou
 * remendando o `globalThis.fetch`, e a classificação de erro — a parte que
 * importa — só apareceria em produção, no dia em que a Evolution devolvesse um
 * 429. Com a injeção, cada classe de falha vira um teste offline.
 */
export function criarEvolutionClient(
  config?: ConfigEvolution,
  fetchImpl: typeof fetch = fetch,
) {
  garantirServidor(PROVEDOR)

  const cfg: ConfigEvolution =
    config ??
    (() => {
      const env = serverEnv()
      return {
        url: env.EVOLUTION_URL,
        apiKey: env.EVOLUTION_API_KEY,
        instancia: env.EVOLUTION_INSTANCE,
      }
    })()

  // A barra final vem com frequência da variável de ambiente copiada do painel,
  // e `.../ /message/sendText` daria 404 — que seria classificado como erro
  // permanente e faria a fila desistir de toda mensagem, para sempre.
  const base = cfg.url.replace(/\/+$/, '')
  const endpoint = `${base}/message/sendText/${encodeURIComponent(cfg.instancia)}`
  const timeoutMs = cfg.timeoutMs ?? TIMEOUT_PADRAO_MS

  return {
    async enviarTexto({ telefone, texto }: MensagemDeTexto): Promise<ResultadoDeEnvio> {
      // A verdade sobre o que é um telefone válido mora em `lib/phone.ts`, o
      // mesmo módulo que grava o número no cadastro. Revalidar por aqui com
      // outra regra criaria a possibilidade de um número aceito no cadastro ser
      // recusado no envio — ou o contrário.
      const e164 = normalizarTelefone(telefone)
      if (!e164) {
        throw new ErroDeEnvio(
          `Telefone inválido para envio no WhatsApp: ${sanitizarMensagem(telefone, [])}`,
          'destinatario',
        )
      }

      if (texto.trim().length === 0) {
        throw new ErroDeEnvio(
          'Mensagem vazia: o template renderizado não produziu texto',
          'requisicao',
        )
      }

      const dados = await postarJson({
        provedor: PROVEDOR,
        url: endpoint,
        cabecalhos: { apikey: cfg.apiKey },
        // A Evolution quer o número só em dígitos, sem o `+` do E.164.
        corpo: { number: e164.slice(1), text: texto },
        fetchImpl,
        timeoutMs,
        segredos: [cfg.apiKey],
      })

      // Id ausente não invalida o envio: a mensagem saiu, só não dá para
      // rastreá-la do lado de lá. Falhar aqui faria o worker retentar um envio
      // que já aconteceu.
      const id = (dados as { key?: { id?: string } } | null)?.key?.id
      return { providerMessageId: id ?? '' }
    },
  }
}

export type EvolutionClient = ReturnType<typeof criarEvolutionClient>
