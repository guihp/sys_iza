/**
 * Adaptador do Google Agenda.
 *
 * ---------------------------------------------------------------------------
 * Recurso opcional, desligado por padrão
 * ---------------------------------------------------------------------------
 * A agenda de verdade da clínica é a tabela `appointments`. O Google Agenda é
 * um espelho de conveniência, para a Dra. ver os horários no celular junto com
 * o resto da vida dela. Nada do sistema depende dele.
 *
 * Por isso a fábrica devolve `null` — e não um cliente que falha — quando não
 * há credencial: quem chama trata "desligado" como um caminho normal, sem log
 * de erro e sem mensagem na tela. Hoje a clínica não tem projeto no Google
 * Cloud, e o sistema precisa rodar inteiro assim, indefinidamente.
 *
 * ---------------------------------------------------------------------------
 * Autenticação: conta de serviço, não OAuth de usuário
 * ---------------------------------------------------------------------------
 * O plano original previa OAuth com a conta da Dra. e `refresh_token` guardado
 * no banco. A conta de serviço foi escolhida no lugar, por três motivos:
 *
 *   1. um app OAuth não verificado fica em "Testing" no Google Cloud, e nesse
 *      estado o Google EXPIRA o refresh token em 7 dias. A sincronia quebraria
 *      toda semana até alguém passar pelo processo de verificação do Google —
 *      que exige política de privacidade publicada e revisão manual, para um
 *      sistema interno de duas pessoas;
 *   2. não há segredo de usuário para guardar. Sem `refresh_token` no banco,
 *      não é preciso tabela nova, nem migration, nem policy de RLS protegendo
 *      um token que dá acesso à conta Google inteira da Dra.;
 *   3. não há rota de callback pública, que hoje nem existiria — o app ainda
 *      não tem domínio fixo, e um `redirect_uri` errado é a causa número um de
 *      OAuth quebrado em produção.
 *
 * O custo é uma etapa manual: a Dra. compartilha a agenda dela com o e-mail da
 * conta de serviço, dando "Fazer alterações em eventos". É um clique, feito uma
 * vez, e está descrito na tela `/configuracoes/google`.
 *
 * A troca de credencial por `access_token` é a do fluxo JWT-bearer: assinamos
 * um JWT com a chave privada da conta de serviço e o trocamos por um token de
 * uma hora. São ~40 linhas com `node:crypto` — a alternativa seria arrastar
 * `googleapis` (dezenas de megabytes, todas as APIs do Google) para dentro do
 * container por causa de um POST.
 *
 * ---------------------------------------------------------------------------
 * Servidor e worker apenas
 * ---------------------------------------------------------------------------
 * A `GOOGLE_PRIVATE_KEY` é o segredo mais forte do projeto: quem a tem escreve
 * na agenda da Dra. para sempre. Ver `garantirServidor()`.
 */

import { createSign } from 'node:crypto'
import {
  ErroDeEnvio,
  TIMEOUT_PADRAO_MS,
  classificarStatus,
  descreverCausa,
  ehInterrupcaoPorTempo,
  garantirServidor,
  sanitizarMensagem,
  sinalDeTimeout,
} from '@/integrations/envio'
import { serverEnv } from '@/lib/env'
import { FUSO_CLINICA } from '@/lib/datetime'

export { ErroDeEnvio } from '@/integrations/envio'
export type { MotivoDeFalha } from '@/integrations/envio'

const PROVEDOR = 'Google Agenda'

/** Endpoint de troca do JWT por `access_token`. Exportado para os testes. */
export const ENDPOINT_TOKEN = 'https://oauth2.googleapis.com/token'

const BASE_CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars'

/**
 * Escopo mínimo. `calendar.events` escreve eventos e nada mais: não lista
 * outras agendas, não lê contatos, não toca no Drive. Pedir `calendar` inteiro
 * seria dar à clínica poder de apagar agendas da Dra.
 */
const ESCOPO = 'https://www.googleapis.com/auth/calendar.events'

// ---------------------------------------------------------------------------
// Função pura: o evento
// ---------------------------------------------------------------------------

export type ConsultaParaEvento = {
  pacienteNome: string
  procedimentoNome: string
  inicio: Date
  fim: Date
  observacoes: string | null
}

export type EventoGoogle = {
  summary: string
  description?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

/**
 * Traduz uma consulta para o corpo que a API do Google espera.
 *
 * Pura de propósito: é a única parte desta integração que dá para verificar
 * sem rede, e é onde mora o que a Dra. lê no celular.
 *
 * `dateTime` sai em UTC (`toISOString`) e não no relógio de parede da clínica.
 * A API aceita os dois, mas hora local exige que o `timeZone` esteja certo para
 * ser interpretada — e um instante absoluto não depende de interpretação
 * nenhuma. O `timeZone` continua indo junto porque é ele que o Google usa para
 * exibir e para calcular recorrência.
 *
 * O que NÃO vai para o Google: nada de prontuário. Nome e procedimento já são
 * dado sensível o bastante para sair da nossa infraestrutura — a evolução
 * clínica da 0006 nunca passa por aqui. `observacoes` é o campo de logística da
 * agenda ("vem acompanhada"), não o clínico.
 */
export function montarEvento(consulta: ConsultaParaEvento): EventoGoogle {
  return {
    summary: `${consulta.pacienteNome} — ${consulta.procedimentoNome}`,
    ...(consulta.observacoes ? { description: consulta.observacoes } : {}),
    start: { dateTime: consulta.inicio.toISOString(), timeZone: FUSO_CLINICA },
    end: { dateTime: consulta.fim.toISOString(), timeZone: FUSO_CLINICA },
  }
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export type ConfigGoogle = {
  /** E-mail da conta de serviço (`...@....iam.gserviceaccount.com`). */
  clientEmail: string
  /** Chave privada em PEM, do JSON baixado do Google Cloud. */
  privateKey: string
  /** Agenda de destino — o e-mail da Dra., depois de compartilhada. */
  calendarId: string
  /** Tempo máximo de espera. Padrão: `TIMEOUT_PADRAO_MS`. */
  timeoutMs?: number
}

type EnvDoGoogle = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string
  GOOGLE_PRIVATE_KEY?: string
  GOOGLE_CALENDAR_ID?: string
}

/**
 * Lê a configuração do ambiente. `null` quando a sincronia está desligada.
 *
 * Exige as três variáveis juntas. Meia configuração é pior que nenhuma: ligaria
 * a sincronia para ela falhar em toda consulta marcada, enchendo o log de ruído
 * sem que ninguém tenha pedido a integração.
 *
 * Não há valor padrão para `calendarId`. A documentação do Google usa
 * `'primary'`, mas para uma conta de serviço `primary` é a agenda da PRÓPRIA
 * conta de serviço — que nenhum humano abre. O evento seria criado com sucesso
 * e desapareceria, que é a pior falha possível: silenciosa.
 */
export function configuracaoDoGoogle(env: EnvDoGoogle): ConfigGoogle | null {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID } = env
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_CALENDAR_ID) return null

  return {
    clientEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // O PEM é multilinha e atravessa painel de deploy e `.env` como `\n`
    // escrito. Sem desdobrar, o `node:crypto` recusa a chave — e o erro que ele
    // devolve não diz que o problema é este.
    privateKey: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    calendarId: GOOGLE_CALENDAR_ID,
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function base64url(dado: string | Buffer): string {
  return Buffer.from(dado).toString('base64url')
}

type Pedido = {
  /** Nome do passo, para a mensagem de erro dizer ONDE quebrou. */
  passo: string
  metodo: 'POST' | 'PATCH' | 'DELETE'
  url: string
  cabecalhos: Record<string, string>
  corpo: string
  /** Status que não são falha apesar de `!ok` — ver `removerEvento`. */
  statusTolerados?: readonly number[]
}

/**
 * Uma requisição, com a mesma taxonomia de erro dos envios ao paciente.
 *
 * Não usa `postarJson` de `@/integrations/envio` porque esta integração precisa
 * de três coisas que o envio de mensagem não tem: verbos além de `POST`, corpo
 * `x-www-form-urlencoded` na troca do token, e resposta `204` sem corpo no
 * `DELETE` — que `postarJson` classificaria, corretamente para o caso dele,
 * como "resposta ilegível". O que importa manter idêntico é a CLASSIFICAÇÃO, e
 * essa vem de `classificarStatus`, importado de lá.
 */
async function chamar(
  pedido: Pedido,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  segredos: ReadonlyArray<string | undefined>,
): Promise<unknown> {
  let resposta: Response
  try {
    resposta = await fetchImpl(pedido.url, {
      method: pedido.metodo,
      headers: pedido.cabecalhos,
      body: pedido.metodo === 'DELETE' ? undefined : pedido.corpo,
      signal: sinalDeTimeout(timeoutMs),
    })
  } catch (causa) {
    if (ehInterrupcaoPorTempo(causa)) {
      throw new ErroDeEnvio(
        `${PROVEDOR} não respondeu em ${timeoutMs} ms (${pedido.passo})`,
        'timeout',
      )
    }
    throw new ErroDeEnvio(
      `Falha de rede ao chamar o ${PROVEDOR} (${pedido.passo}): ` +
        sanitizarMensagem(descreverCausa(causa), segredos),
      'rede',
    )
  }

  if (!resposta.ok) {
    if (pedido.statusTolerados?.includes(resposta.status)) return null

    let corpo = ''
    try {
      corpo = await resposta.text()
    } catch {
      corpo = ''
    }
    const detalhe = sanitizarMensagem(corpo, segredos)
    throw new ErroDeEnvio(
      `${PROVEDOR} respondeu ${resposta.status} em ${pedido.passo}${detalhe ? `: ${detalhe}` : ''}`,
      classificarStatus(resposta.status),
      { status: resposta.status },
    )
  }

  // 204 no DELETE: sucesso sem corpo. Ler como JSON daria erro de parse e
  // transformaria todo cancelamento bem-sucedido numa falha registrada.
  if (resposta.status === 204) return null

  try {
    return await resposta.json()
  } catch {
    throw new ErroDeEnvio(
      `${PROVEDOR} respondeu ${resposta.status} em ${pedido.passo} com um corpo que não é JSON`,
      'resposta',
      { status: resposta.status },
    )
  }
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

export type GoogleCalendarClient = {
  criarEvento(evento: EventoGoogle): Promise<{ eventId: string }>
  atualizarEvento(eventId: string, evento: EventoGoogle): Promise<void>
  removerEvento(eventId: string): Promise<void>
}

/** Margem de segurança para não usar um token que expira no meio do voo. */
const MARGEM_DO_TOKEN_MS = 60_000
const VALIDADE_DO_JWT_S = 3600

/**
 * Cria o cliente, ou devolve `null` quando a sincronia está desligada.
 *
 * `config` e `fetchImpl` são injetáveis pelo mesmo motivo dos outros
 * adaptadores (ver `criarEvolutionClient`): sem eles, a classificação de erro só
 * apareceria contra o Google de verdade. Passar `null` explicitamente força o
 * caminho "desligado" no teste; omitir lê o ambiente.
 */
export function criarGoogleCalendarClient(
  config?: ConfigGoogle | null,
  fetchImpl: typeof fetch = fetch,
): GoogleCalendarClient | null {
  garantirServidor(PROVEDOR)

  const cfg = config === undefined ? configuracaoDoGoogle(serverEnv()) : config
  if (!cfg) return null

  const timeoutMs = cfg.timeoutMs ?? TIMEOUT_PADRAO_MS
  const segredos = [cfg.privateKey]
  const eventos = `${BASE_CALENDAR}/${encodeURIComponent(cfg.calendarId)}/events`

  // Cache no fechamento, não em módulo: o token pertence a ESTA credencial. Um
  // cache global entregaria o token de uma configuração a outra no dia em que
  // houver duas (produção e homologação no mesmo processo, por exemplo).
  let token: { valor: string; expiraEm: number } | null = null

  function assinarJwt(agora: number): string {
    const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const reivindicacoes = base64url(
      JSON.stringify({
        iss: cfg!.clientEmail,
        scope: ESCOPO,
        aud: ENDPOINT_TOKEN,
        iat: agora,
        exp: agora + VALIDADE_DO_JWT_S,
      }),
    )
    const assinatura = createSign('RSA-SHA256')
      .update(`${cabecalho}.${reivindicacoes}`)
      .sign(cfg!.privateKey)

    return `${cabecalho}.${reivindicacoes}.${base64url(assinatura)}`
  }

  async function obterToken(): Promise<string> {
    const agoraMs = Date.now()
    if (token && token.expiraEm - MARGEM_DO_TOKEN_MS > agoraMs) return token.valor

    const dados = await chamar(
      {
        passo: 'troca do token',
        metodo: 'POST',
        url: ENDPOINT_TOKEN,
        cabecalhos: { 'Content-Type': 'application/x-www-form-urlencoded' },
        corpo: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: assinarJwt(Math.floor(agoraMs / 1000)),
        }).toString(),
      },
      fetchImpl,
      timeoutMs,
      segredos,
    )

    const resposta = dados as { access_token?: string; expires_in?: number } | null
    if (!resposta?.access_token) {
      throw new ErroDeEnvio(
        `${PROVEDOR} não devolveu access_token na troca do token`,
        'credencial',
      )
    }

    token = {
      valor: resposta.access_token,
      expiraEm: agoraMs + (resposta.expires_in ?? 3600) * 1000,
    }
    return token.valor
  }

  async function autorizado(
    pedido: Omit<Pedido, 'cabecalhos'> & { cabecalhos?: Record<string, string> },
  ): Promise<unknown> {
    const acesso = await obterToken()
    return chamar(
      {
        ...pedido,
        cabecalhos: {
          Authorization: `Bearer ${acesso}`,
          'Content-Type': 'application/json',
          ...pedido.cabecalhos,
        },
      },
      fetchImpl,
      timeoutMs,
      // O access token entra na lista de segredos junto com a chave: ele vale
      // uma hora de escrita na agenda se vazar para um log.
      [...segredos, acesso],
    )
  }

  return {
    async criarEvento(evento) {
      const dados = await autorizado({
        passo: 'criação do evento',
        metodo: 'POST',
        url: eventos,
        corpo: JSON.stringify(evento),
      })

      const id = (dados as { id?: string } | null)?.id
      if (!id) {
        // Diferente do envio de WhatsApp, onde id ausente é tolerável: aqui o
        // id é o que permite remarcar e cancelar depois. Sem ele, o evento
        // existiria na agenda da Dra. sem nenhum vínculo com a consulta — e um
        // cancelamento deixaria o horário fantasma no celular dela.
        throw new ErroDeEnvio(
          `${PROVEDOR} criou o evento mas não devolveu o id`,
          'resposta',
        )
      }
      return { eventId: id }
    },

    async atualizarEvento(eventId, evento) {
      // PATCH e não PUT: a Dra. pode ter mexido no evento pelo celular (um
      // convidado, um alarme). PUT apagaria o que ela fez; PATCH altera só o
      // que veio da consulta.
      await autorizado({
        passo: 'atualização do evento',
        metodo: 'PATCH',
        url: `${eventos}/${encodeURIComponent(eventId)}`,
        corpo: JSON.stringify(evento),
      })
    },

    async removerEvento(eventId) {
      await autorizado({
        passo: 'remoção do evento',
        metodo: 'DELETE',
        url: `${eventos}/${encodeURIComponent(eventId)}`,
        corpo: '',
        // 404/410: alguém já apagou o evento à mão, ou uma tentativa anterior
        // chegou lá. O estado desejado — evento fora da agenda — está valendo,
        // e insistir só produziria erro num caminho que já deu certo.
        statusTolerados: [404, 410],
      })
    },
  }
}
