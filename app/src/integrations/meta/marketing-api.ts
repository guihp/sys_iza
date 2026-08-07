/**
 * Adaptador da Marketing API da Meta — o lado que só LÊ.
 *
 * ---------------------------------------------------------------------------
 * O que ele é, e o que ele não é
 * ---------------------------------------------------------------------------
 * Irmão de `capi.ts`, e o contrário dele: a CAPI escreve conversão no dataset,
 * este aqui lê gasto da conta de anúncios. Dois tokens diferentes, dois escopos
 * diferentes, dois interruptores independentes — ligar um não liga o outro.
 *
 * **Somente leitura, e isso é decisão do dono, não limitação técnica.** Pausar
 * anúncio e mexer em orçamento continua no Gerenciador. Nenhuma função deste
 * arquivo faz POST, e não é para ganhar uma: a página que o consome mostra
 * número, não opera campanha.
 *
 * ---------------------------------------------------------------------------
 * Recurso opcional, desligado por padrão
 * ---------------------------------------------------------------------------
 * Mesmo desenho do Google Agenda e da CAPI: sem `META_ADS_TOKEN` a fábrica
 * devolve `null` em vez de um cliente que falha. Quem chama trata "desligado"
 * como caminho normal — sem log de pânico, sem linha vermelha na tela. Hoje o
 * token não existe e o sistema roda inteiro assim.
 *
 * ---------------------------------------------------------------------------
 * O FORMATO DA RESPOSTA — o que foi conferido e o que não foi
 * ---------------------------------------------------------------------------
 * CONFIRMADO na documentação de Insights da Marketing API:
 *
 *   - o endpoint é `/{versao}/act_{conta}/insights`, e o `act_` faz parte do id
 *     do nó — sem ele a Graph API responde 400;
 *   - `level=ad` é o que quebra o resultado por anúncio. Sem ele a resposta vem
 *     agregada pela conta inteira e o cruzamento por `ad_id` fica sem chave;
 *   - **os números vêm como STRING.** `"spend": "179.96"`, `"impressions":
 *     "12345"`. É a pegadinha desta API: `linha.impressions + 1` devolve
 *     `"123451"` em vez de `12346`. Tudo passa por `numero()` e `centavos()`;
 *   - `spend` está na moeda da conta, que é BRL nesta (levantado no plano);
 *   - `actions` é lista de `{ action_type, value }`, e o tipo de ação que
 *     interessa aqui é conversa iniciada por anúncio de clique-para-WhatsApp.
 *
 * NÃO CONFIRMADO — não há credencial para conferir, e não vai haver antes de o
 * dono gerar o token:
 *
 *   - QUAL dos nomes de ação de conversa a conta devolve. A Meta já usou pelo
 *     menos três rótulos para a mesma coisa, e eles convivem. Por isso
 *     `CONVERSAS_INICIADAS` é uma LISTA em ordem de preferência, e não uma
 *     constante: a primeira que aparecer na resposta vence, e acrescentar um
 *     nome novo é uma linha;
 *   - o formato de `/{dataset}/stats`. Ver `estadoDoDataset`, que degrada para
 *     `null` em qualquer surpresa em vez de derrubar a página.
 *
 * ---------------------------------------------------------------------------
 * Servidor apenas
 * ---------------------------------------------------------------------------
 * `META_ADS_TOKEN` dá acesso de leitura à conta de anúncios inteira. Ver
 * `garantirServidor()`.
 */

import {
  ErroDeEnvio,
  TIMEOUT_PADRAO_MS,
  descreverCausa,
  ehInterrupcaoPorTempo,
  garantirServidor,
  sanitizarMensagem,
  sinalDeTimeout,
} from '@/integrations/envio'
import { classificarErroDaMeta, VERSAO_PADRAO_DA_API } from '@/integrations/meta/capi'
import { serverEnv } from '@/lib/env'

export { ErroDeEnvio } from '@/integrations/envio'

const PROVEDOR = 'Meta Marketing API'

const BASE_GRAPH = 'https://graph.facebook.com'

/**
 * A conta de anúncios da clínica, levantada no plano em 2026-08-06 ("Izadora",
 * business Elonai Automações, BRL).
 *
 * Constante e não variável obrigatória pelo mesmo argumento de
 * `META_MENSAL_CENTAVOS` em `lib/meta.ts`: é um valor que não muda e que, se
 * fosse exigido no ambiente, transformaria "esqueci de preencher" em página
 * quebrada. `META_AD_ACCOUNT_ID` sobrescreve quando a conta mudar.
 */
export const CONTA_DE_ANUNCIOS_PADRAO = '1526237358668434'

/**
 * Teto de anúncios lidos numa chamada.
 *
 * Não há paginação aqui, e é decisão: esta conta tem duas campanhas e um punhado
 * de anúncios. Seguir `paging.next` seria um laço com chamada de rede dentro de
 * um render de página, para um caso que não existe. Se um dia existir, o teto
 * corta os mais recentes primeiro (a API ordena por relevância do período) e a
 * página continua honesta — ela só não mostraria a cauda.
 */
const TETO_DE_ANUNCIOS = 500

/**
 * Nomes de ação que significam "alguém começou uma conversa por causa deste
 * anúncio", em ordem de preferência.
 *
 * A ordem importa: `messaging_conversation_started_7d` é a métrica que o
 * Gerenciador mostra como "conversas iniciadas" em campanha de clique-para-
 * WhatsApp, e é a que o dono viu (24 conversas · R$ 7,50). As outras são os
 * rótulos que a Meta usa em contas mais novas para a mesma ideia. A primeira que
 * aparecer na resposta vence — somar todas contaria a mesma conversa duas vezes.
 */
const CONVERSAS_INICIADAS: readonly string[] = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
  'onsite_conversion.messaging_first_reply',
]

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export type ConfigMarketing = {
  /** Token de usuário do sistema com `ads_read`. Segredo. */
  token: string
  /** Id da conta SEM o prefixo `act_`. */
  contaId: string
  /** Padrão: `VERSAO_PADRAO_DA_API`. */
  versaoApi?: string
  /** Tempo máximo de espera. Padrão: `TIMEOUT_PADRAO_MS`. */
  timeoutMs?: number
}

type EnvDaMarketingApi = {
  META_ADS_TOKEN?: string
  META_AD_ACCOUNT_ID?: string
  META_GRAPH_API_VERSION?: string
}

/**
 * Lê a configuração do ambiente. `null` quando a página está desligada.
 *
 * **O token é o único interruptor.** Ao contrário da CAPI, que exige o par
 * dataset+token, aqui não há segunda metade a faltar: a conta tem padrão. Meia
 * configuração não existe neste adaptador.
 */
export function configuracaoDaMarketingApi(env: EnvDaMarketingApi): ConfigMarketing | null {
  const token = env.META_ADS_TOKEN?.trim()
  if (!token) return null

  return {
    token,
    // `act_` removido se alguém colar o id como aparece na URL do Gerenciador.
    // Duplicar o prefixo (`act_act_123`) daria 400 numa configuração que a
    // pessoa jura ter preenchido certo.
    contaId: (env.META_AD_ACCOUNT_ID?.trim() || CONTA_DE_ANUNCIOS_PADRAO).replace(/^act_/, ''),
    versaoApi: env.META_GRAPH_API_VERSION,
  }
}

// ---------------------------------------------------------------------------
// Funções puras: a resposta da Meta → o que a página usa
// ---------------------------------------------------------------------------

/** Uma linha de `insights` já traduzida. Tudo em número; centavos em inteiro. */
export type InsightDoAnuncio = {
  adId: string
  adNome: string
  campanhaId: string | null
  campanhaNome: string | null
  /** `spend` em centavos. Inteiro — ver `centavos()`. */
  gastoCentavos: number
  impressoes: number
  cliques: number
  /** Conversas iniciadas. Zero quando a conta não devolve nenhuma das ações. */
  conversas: number
}

/** Forma bruta de uma linha de `insights`, com os números como a API os manda. */
type LinhaBrutaDeInsight = {
  ad_id?: unknown
  ad_name?: unknown
  campaign_id?: unknown
  campaign_name?: unknown
  spend?: unknown
  impressions?: unknown
  clicks?: unknown
  actions?: unknown
}

/**
 * Texto ou número da Graph API → número finito.
 *
 * Vale por si: `Number(undefined)` é `NaN`, `Number('')` é `0`, e um `NaN`
 * escapando daqui atravessaria a soma inteira e chegaria à tela como `NaN` —
 * que é justamente o que o dono não quer ver. Toda entrada duvidosa vira zero.
 */
function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0
  if (typeof valor !== 'string') return 0
  const limpo = valor.trim()
  if (!limpo) return 0
  const convertido = Number(limpo)
  return Number.isFinite(convertido) ? convertido : 0
}

/**
 * `"179.96"` → `17996`.
 *
 * Arredondado, e não truncado: `179.96 * 100` dá `17995.999999999998` em ponto
 * flutuante, e `Math.trunc` transformaria R$ 179,96 em R$ 179,95 no total da
 * página. Um centavo por linha, somado, é a diferença que faz alguém desconfiar
 * do número inteiro.
 */
function centavos(valor: unknown): number {
  return Math.round(numero(valor) * 100)
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

/**
 * Extrai as conversas iniciadas da lista `actions`.
 *
 * Exportada porque é a parte mais provável de precisar de conserto: é a única
 * que depende de um nome de ação que a Meta pode renomear sem avisar.
 */
export function conversasDaLinha(actions: unknown): number {
  if (!Array.isArray(actions)) return 0

  for (const nome of CONVERSAS_INICIADAS) {
    const encontrada = actions.find(
      (acao) => (acao as { action_type?: unknown } | null)?.action_type === nome,
    )
    if (encontrada) return numero((encontrada as { value?: unknown }).value)
  }
  return 0
}

/**
 * Corpo da resposta → lista de insights.
 *
 * Defensiva de propósito: a página inteira depende desta tradução, e um campo
 * que a Meta pare de mandar não pode virar exceção num Server Component. Linha
 * sem `ad_id` é DESCARTADA — sem a chave ela não cruza com nada e só somaria
 * gasto a um anúncio fantasma.
 */
export function interpretarInsights(corpo: unknown): InsightDoAnuncio[] {
  const dados = (corpo as { data?: unknown } | null)?.data
  if (!Array.isArray(dados)) return []

  const linhas: InsightDoAnuncio[] = []
  for (const bruta of dados as LinhaBrutaDeInsight[]) {
    const adId = texto(bruta?.ad_id)
    if (!adId) continue

    linhas.push({
      adId,
      // Anúncio sem nome existe (rascunho, criativo apagado). O id é o que a
      // Dra. consegue procurar no Gerenciador, então ele vira o rótulo.
      adNome: texto(bruta.ad_name) ?? `Anúncio ${adId}`,
      campanhaId: texto(bruta.campaign_id),
      campanhaNome: texto(bruta.campaign_name),
      gastoCentavos: centavos(bruta.spend),
      impressoes: Math.round(numero(bruta.impressions)),
      cliques: Math.round(numero(bruta.clicks)),
      conversas: Math.round(conversasDaLinha(bruta.actions)),
    })
  }
  return linhas
}

// ---------------------------------------------------------------------------
// Estado do dataset
// ---------------------------------------------------------------------------

/**
 * O que a página mostra sobre a saúde do dataset.
 *
 * Todos os campos são anuláveis, e isso é o desenho: este bloco é informativo,
 * some inteiro quando a Meta não colabora, e nunca é motivo de erro na tela.
 */
export type EstadoDoDataset = {
  /** Qualidade de correspondência (EMQ), 0 a 10, quando a API devolve. */
  qualidadeDaCorrespondencia: number | null
  /** Instante do evento mais recente recebido. Frescor. */
  ultimoEventoEm: Date | null
  /** Volume por evento no período que a Meta agrega. */
  volumePorEvento: { evento: string; quantidade: number }[]
}

/**
 * Corpo de `/{dataset}/stats` → estado do dataset.
 *
 * **O formato deste endpoint NÃO foi conferido contra credencial de verdade** —
 * não existe dataset ainda. Por isso a função aceita as duas formas que a
 * documentação e as integrações de terceiros mostram para o mesmo dado
 * (`event_name` ou `value` para o rótulo; `count` ou `value` para o número) e
 * devolve `null` quando não reconhece nada. Um bloco informativo ausente é um
 * desfecho aceitável; uma página de marketing quebrada por causa dele não é.
 */
export function interpretarEstadoDoDataset(corpo: unknown): EstadoDoDataset | null {
  if (!corpo || typeof corpo !== 'object') return null

  const dados = (corpo as { data?: unknown }).data
  const linhas = Array.isArray(dados) ? (dados as Record<string, unknown>[]) : []

  const volumePorEvento: { evento: string; quantidade: number }[] = []
  let ultimoInstante = 0

  for (const linha of linhas) {
    const evento = texto(linha?.event_name) ?? texto(linha?.event)
    const quantidade = Math.round(numero(linha?.count ?? linha?.value))
    if (evento) volumePorEvento.push({ evento, quantidade })

    const carimbo = numero(linha?.start_time ?? linha?.last_fired_time)
    // A Graph API manda instante em SEGUNDOS. A mesma pegadinha do `event_time`
    // da CAPI, do lado da leitura: tratar como milissegundos jogaria o "último
    // evento" para 1970 e a tela diria que o dataset está morto.
    if (carimbo > 0) ultimoInstante = Math.max(ultimoInstante, carimbo)
  }

  const emq = numero(
    (corpo as { event_match_quality?: unknown; match_quality_score?: unknown })
      .event_match_quality ?? (corpo as { match_quality_score?: unknown }).match_quality_score,
  )

  const estado: EstadoDoDataset = {
    qualidadeDaCorrespondencia: emq > 0 ? emq : null,
    ultimoEventoEm: ultimoInstante > 0 ? new Date(ultimoInstante * 1000) : null,
    volumePorEvento,
  }

  // Nada reconhecido é a mesma coisa que não ter o bloco: melhor não desenhar a
  // seção do que desenhar três travessões e deixar a Dra. achar que o dataset
  // está zerado quando na verdade não foi possível ler.
  if (
    estado.qualidadeDaCorrespondencia === null &&
    estado.ultimoEventoEm === null &&
    estado.volumePorEvento.length === 0
  ) {
    return null
  }

  return estado
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/** Recorte de datas, em dia de calendário da clínica (`YYYY-MM-DD`). */
export type Periodo = { desde: string; ate: string }

export type MarketingApiClient = {
  /** Gasto e entrega por anúncio no período. Lança `ErroDeEnvio` classificado. */
  insightsPorAnuncio(periodo: Periodo): Promise<InsightDoAnuncio[]>
  /**
   * Saúde do dataset de conversões. **Nunca lança**: devolve `null` quando o
   * dataset não existe, quando o token não alcança o nó ou quando o formato não
   * é reconhecido. É bloco informativo, e informação que falta não é falha.
   */
  estadoDoDataset(datasetId: string): Promise<EstadoDoDataset | null>
}

/**
 * Cria o cliente, ou devolve `null` quando a página está desligada.
 *
 * `config` e `fetchImpl` injetáveis pelo mesmo motivo dos outros adaptadores:
 * não há credencial e não vai haver antes de o dono gerar o token, então a única
 * forma de conferir a classificação de erro é offline. Passar `null`
 * explicitamente força o caminho "desligada"; omitir lê o ambiente.
 */
export function criarMarketingApiClient(
  config?: ConfigMarketing | null,
  fetchImpl: typeof fetch = fetch,
): MarketingApiClient | null {
  garantirServidor(PROVEDOR)

  const cfg = config === undefined ? configuracaoDaMarketingApi(serverEnv()) : config
  if (!cfg) return null

  // Desmembrado em constantes locais, e não usado como `cfg.x` lá embaixo: o
  // `buscarJson` é uma declaração de função (içada), e o TypeScript não carrega
  // para dentro dela a garantia de que `cfg` não é nulo.
  const { token, contaId } = cfg
  const timeoutMs = cfg.timeoutMs ?? TIMEOUT_PADRAO_MS
  const versao = cfg.versaoApi?.trim() || VERSAO_PADRAO_DA_API
  const segredos = [token]

  /**
   * GET com o token na querystring — é assim que a Graph API documenta.
   *
   * Consequência direta: **a URL CONTÉM O SEGREDO**, e por isso nenhuma mensagem
   * de erro daqui inclui a URL, só o nome do provedor e o status. A lista
   * `segredos` é a segunda linha, para o corpo de erro da Meta que às vezes ecoa
   * a requisição inteira.
   */
  async function buscarJson(caminho: string, parametros: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams({ ...parametros, access_token: token })
    const url = `${BASE_GRAPH}/${encodeURIComponent(versao)}/${caminho}?${query.toString()}`

    let resposta: Response
    try {
      resposta = await fetchImpl(url, { method: 'GET', signal: sinalDeTimeout(timeoutMs) })
    } catch (causa) {
      if (ehInterrupcaoPorTempo(causa)) {
        throw new ErroDeEnvio(`${PROVEDOR} não respondeu em ${timeoutMs} ms`, 'timeout')
      }
      throw new ErroDeEnvio(
        `Falha de rede ao chamar a ${PROVEDOR}: ` +
          sanitizarMensagem(descreverCausa(causa), segredos),
        'rede',
      )
    }

    if (!resposta.ok) {
      // `text()` e não `json()`: em falha o corpo pode ser HTML de proxy, e é do
      // texto que `classificarErroDaMeta` tira o `error.code` — inclusive o 400
      // que na verdade é limite de requisições.
      let bruto = ''
      try {
        bruto = await resposta.text()
      } catch {
        bruto = ''
      }
      const detalhe = sanitizarMensagem(bruto, segredos)
      throw new ErroDeEnvio(
        `${PROVEDOR} respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : ''}`,
        classificarErroDaMeta(resposta.status, bruto),
        { status: resposta.status },
      )
    }

    try {
      return await resposta.json()
    } catch {
      throw new ErroDeEnvio(
        `${PROVEDOR} respondeu ${resposta.status} com um corpo que não é JSON`,
        'resposta',
        { status: resposta.status },
      )
    }
  }

  return {
    async insightsPorAnuncio(periodo) {
      const corpo = await buscarJson(`act_${encodeURIComponent(contaId)}/insights`, {
        level: 'ad',
        fields: 'ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,actions',
        time_range: JSON.stringify({ since: periodo.desde, until: periodo.ate }),
        limit: String(TETO_DE_ANUNCIOS),
      })
      return interpretarInsights(corpo)
    },

    async estadoDoDataset(datasetId) {
      if (!datasetId.trim()) return null
      try {
        const corpo = await buscarJson(`${encodeURIComponent(datasetId)}/stats`, {
          aggregation: 'event',
        })
        return interpretarEstadoDoDataset(corpo)
      } catch {
        // Engolido de propósito, e é o único `catch` mudo do arquivo. O bloco de
        // dataset é acessório: a página existe para cruzar gasto com desfecho, e
        // isso não depende dele. Propagar transformaria "não consegui ler a
        // saúde do dataset" em "a página de marketing está quebrada".
        return null
      }
    },
  }
}
