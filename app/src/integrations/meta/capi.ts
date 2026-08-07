/**
 * Adaptador da Conversions API da Meta.
 *
 * ---------------------------------------------------------------------------
 * Recurso opcional, desligado por padrão
 * ---------------------------------------------------------------------------
 * Igual ao Google Agenda, e pela mesma razão: hoje não existe dataset nem token
 * de CAPI, e o sistema inteiro — cadastro, agenda, kanban, lembretes — precisa
 * rodar assim indefinidamente. Por isso a fábrica devolve `null` em vez de um
 * cliente que falha: quem chama trata "desligado" como caminho normal, sem log
 * de erro e sem linha vermelha na tela.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo faz e o que ele NÃO faz
 * ---------------------------------------------------------------------------
 * Ele FAZ: traduzir a descrição neutra de um evento para o corpo que a Meta
 * espera, mandar o POST, e classificar a falha com a taxonomia de
 * `@/integrations/envio`.
 *
 * Ele NÃO faz: decidir QUAIS eventos existem. Isso é
 * `src/domain/marketing/plan-conversions.ts`, que já barra o envio sem
 * consentimento e sem `ctwa_clid` — as duas travas da LGPD — e cuja entrada
 * sequer tem campo para nome de procedimento ou observação clínica.
 *
 * A tradução aqui não pode reintroduzir o que o domínio manteve de fora, e isso
 * é testado: `montarEventoDaCapi` recebe um tipo fechado com sete campos e não
 * tem acesso a mais nada.
 *
 * ---------------------------------------------------------------------------
 * O FORMATO DO PAYLOAD — o que foi conferido e o que não foi
 * ---------------------------------------------------------------------------
 * A API de mensagens da Meta muda com frequência. O que está abaixo foi
 * conferido contra a documentação vigente em agosto de 2026; o que NÃO deu para
 * confirmar está marcado em cada campo, com o nome do que confere de verdade:
 * Gerenciador de Eventos → dataset → aba **Teste de Eventos**. Nada aqui é dado
 * como funcionando sem aparecer lá.
 *
 * Por isso a montagem do corpo é UMA função pura e pequena
 * (`montarEventoDaCapi`), com teste próprio: quando o formato mudar, o conserto
 * é num lugar só.
 *
 * ---------------------------------------------------------------------------
 * Servidor e worker apenas
 * ---------------------------------------------------------------------------
 * `META_CAPI_TOKEN` escreve conversões no dataset da clínica. Ver
 * `garantirServidor()`.
 */

import {
  ErroDeEnvio,
  TIMEOUT_PADRAO_MS,
  classificarStatus,
  descreverCausa,
  ehInterrupcaoPorTempo,
  garantirServidor,
  sanitizarMensagem,
  sinalDeTimeout,
  type MotivoDeFalha,
} from '@/integrations/envio'
import { serverEnv } from '@/lib/env'
import type { EventoMeta } from '@/domain/marketing/plan-conversions'

export { ErroDeEnvio } from '@/integrations/envio'
export type { MotivoDeFalha } from '@/integrations/envio'

const PROVEDOR = 'Meta Conversions API'

/**
 * Versão da Graph API usada na URL.
 *
 * v25.0 é a corrente (lançada em fevereiro de 2026). A Meta mantém cada versão
 * por cerca de dois anos, então fixar é seguro — e é melhor do que não fixar: a
 * URL sem versão segue a mais nova automaticamente, e uma mudança de contrato
 * lá quebraria o envio sem nenhum deploy nosso. `META_GRAPH_API_VERSION`
 * sobrescreve sem precisar de deploy no dia em que esta expirar.
 */
export const VERSAO_PADRAO_DA_API = 'v25.0'

const BASE_GRAPH = 'https://graph.facebook.com'

/**
 * Quantos dias para trás a Meta ainda aceita um `event_time`.
 *
 * Sete, e é documentado ("A Unix timestamp in seconds indicating when the actual
 * event occurred", aceito até 7 dias no passado). Importa porque a fila pode
 * represar: um job parado por mais de uma semana — worker caído, token expirado
 * sem ninguém olhar — seria recusado para sempre, e insistir nele só esconderia
 * os eventos novos atrás de retentativas mortas. Quem age sobre isso é o
 * despacho (`worker/despacho-conversoes.ts`); aqui a constante é a fonte.
 */
export const JANELA_DE_EVENTO_DIAS = 7

// ---------------------------------------------------------------------------
// A descrição neutra do evento — a entrada deste adaptador
// ---------------------------------------------------------------------------

/**
 * O que o adaptador precisa saber para montar um evento. Nada além disto.
 *
 * É de propósito um espelho reduzido de `ConversaoPlanejada`: só o que atravessa
 * a fronteira para a Meta. O `patientId` fica de fora — ele identifica a
 * paciente e não tem por que existir neste arquivo, já que o que a Meta usa para
 * deduplicar é o `eventId`, que é o hash dele.
 */
export type EventoDeConversao = {
  evento: EventoMeta
  /** `event_id`: SHA-256 estável de `{patientId}:{evento}`. Deduplica lá. */
  eventId: string
  ocorridoEm: Date
  /** Chave de atribuição, em claro — é assim que a Meta a espera. */
  ctwaClid: string
  /** SHA-256 do telefone em E.164 sem `+`, ou nulo. Nunca o número em claro. */
  telefoneHash: string | null
  /** Só no `Purchase`, já arredondado à centena por `domain/marketing/valor`. */
  valor: number | null
  moeda: 'BRL' | null
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export type ConfigMeta = {
  /** ID do dataset do Gerenciador de Eventos. */
  datasetId: string
  /** Token de acesso do dataset. Segredo. */
  token: string
  /** Padrão: `VERSAO_PADRAO_DA_API`. */
  versaoApi?: string
  /** Ver a nota em `montarEventoDaCapi`. Opcional. */
  wabaId?: string
  /** Código da aba Teste de Eventos. Preenchido, nada conta como conversão. */
  testEventCode?: string
  /** Tempo máximo de espera. Padrão: `TIMEOUT_PADRAO_MS`. */
  timeoutMs?: number
}

type EnvDaMeta = {
  META_DATASET_ID?: string
  META_CAPI_TOKEN?: string
  META_WHATSAPP_BUSINESS_ACCOUNT_ID?: string
  META_GRAPH_API_VERSION?: string
  META_TEST_EVENT_CODE?: string
}

/**
 * Lê a configuração do ambiente. `null` quando o envio está desligado.
 *
 * Exige o dataset E o token juntos, pelo mesmo argumento do Google: meia
 * configuração ligaria o envio para ele falhar em todo evento, enchendo a coluna
 * `erro` — que a equipe lê — de ruído sobre um recurso que ninguém pediu.
 *
 * As outras três não são interruptores. Sem elas o envio acontece igual: a
 * versão cai no padrão, o WABA some do `user_data` e o evento vale como
 * produção em vez de teste.
 */
export function configuracaoDaMeta(env: EnvDaMeta): ConfigMeta | null {
  const { META_DATASET_ID, META_CAPI_TOKEN } = env
  if (!META_DATASET_ID || !META_CAPI_TOKEN) return null

  return {
    datasetId: META_DATASET_ID,
    token: META_CAPI_TOKEN,
    versaoApi: env.META_GRAPH_API_VERSION,
    wabaId: env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
    testEventCode: env.META_TEST_EVENT_CODE,
  }
}

// ---------------------------------------------------------------------------
// Função pura: o corpo do evento
// ---------------------------------------------------------------------------

export type EventoDaCapi = {
  event_name: EventoMeta
  event_time: number
  event_id: string
  action_source: 'business_messaging'
  messaging_channel: 'whatsapp'
  user_data: {
    ctwa_clid: string
    ph?: string[]
    whatsapp_business_account_id?: string
  }
  custom_data?: { value: number; currency: 'BRL' }
}

export type CorpoDaRequisicao = {
  data: EventoDaCapi[]
  test_event_code?: string
}

/**
 * Descrição neutra do evento → o corpo que a Meta espera.
 *
 * ESTE É O ÚNICO LUGAR do projeto que conhece o formato da CAPI. Quando a Meta
 * mudar o contrato — e ela muda —, o conserto é aqui e em nenhum outro arquivo.
 *
 * ---------------------------------------------------------------------------
 * Campo a campo: o que está confirmado e o que é suposição
 * ---------------------------------------------------------------------------
 * CONFIRMADO na documentação de parâmetros de evento de servidor da Meta:
 *
 *   - `event_name`: nome de evento padrão, usado também para deduplicar;
 *   - `event_time`: Unix timestamp em SEGUNDOS. Milissegundos aqui jogam o
 *     evento para o ano 56000 e a Meta descarta — mesma pegadinha que o fluxo do
 *     n8n tem do outro lado, ao contrário;
 *   - `event_id`: "qualquer string única escolhida pelo anunciante", recomendada
 *     para deduplicação. É o que faz uma retentativa não virar duas conversões;
 *   - `action_source`: `'business_messaging'` é valor permitido e está descrito
 *     como "conversão feita a partir de anúncios de clique para Messenger,
 *     Instagram ou WhatsApp". É exatamente o nosso caso;
 *   - `user_data.ph`: SHA-256 obrigatório. Já vem hasheado de
 *     `domain/marketing/hash.ts`, que aplica a normalização que a Meta exige;
 *   - `user_data.ctwa_clid`: descrito como "Click ID gerado pela Meta para
 *     anúncios que clicam para o WhatsApp", e é dos poucos campos de `user_data`
 *     que a documentação manda NÃO hashear;
 *   - `custom_data.value` / `custom_data.currency`: o par padrão do `Purchase`.
 *
 * NÃO CONFIRMADO — conferir no Teste de Eventos antes de dar por certo:
 *
 *   - `messaging_channel: 'whatsapp'` no nível do evento. Aparece assim em toda
 *     integração de terceiros de CTWA que dá para ler, e a função dele é
 *     distinguir WhatsApp de Messenger e de Instagram Direct dentro do mesmo
 *     `action_source`. Não foi possível abrir a página da Meta que o define: a
 *     URL do guia de CAPI para mensagens respondeu 404 na conferência;
 *   - `user_data.whatsapp_business_account_id`. NÃO consta da lista oficial de
 *     parâmetros de informação do cliente, e aparece em todas as integrações de
 *     terceiros. Por isso é opcional aqui: com `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
 *     o campo vai, sem ela o evento sai sem ele. Se o Teste de Eventos acusar
 *     falta de identificação do canal, é o primeiro a preencher;
 *   - `ph` como LISTA de um elemento. A documentação usa lista nos exemplos e a
 *     API aceita string solta em vários pontos; a lista foi escolhida por ser a
 *     forma dos exemplos oficiais.
 *
 * ---------------------------------------------------------------------------
 * O que NÃO entra, e é o ponto da restrição legal
 * ---------------------------------------------------------------------------
 * Nome de procedimento, evolução clínica, observação, nome da paciente, telefone
 * em claro, o uuid interno dela. Nada disso tem campo aqui — a entrada é
 * `EventoDeConversao`, que não os carrega. A garantia é do tipo, não da memória
 * de quem edita o arquivo depois.
 */
export function montarEventoDaCapi(
  evento: EventoDeConversao,
  opcoes: { wabaId?: string } = {},
): EventoDaCapi {
  return {
    event_name: evento.evento,
    // Divisão inteira: a Meta quer segundos, e um decimal vindo de um Date com
    // milissegundos é recusado como formato inválido.
    event_time: Math.floor(evento.ocorridoEm.getTime() / 1000),
    event_id: evento.eventId,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      ctwa_clid: evento.ctwaClid,
      // Campo omitido, e não enviado vazio: hash de string vazia é um valor de
      // 64 caracteres perfeitamente válido, que a Meta tentaria casar com
      // alguém. Ver `hashTelefone`.
      ...(evento.telefoneHash ? { ph: [evento.telefoneHash] } : {}),
      ...(opcoes.wabaId ? { whatsapp_business_account_id: opcoes.wabaId } : {}),
    },
    // `value` e `currency` andam juntos ou nenhum vai: a Meta recusa um `value`
    // sem moeda, e um `Purchase` recusado é pior do que um sem valor.
    ...(evento.valor !== null && evento.moeda
      ? { custom_data: { value: evento.valor, currency: evento.moeda } }
      : {}),
  }
}

/**
 * O envelope da requisição.
 *
 * `data` é lista porque a CAPI aceita lote. Enviamos um evento por requisição
 * mesmo assim: cada linha de `meta_conversion_jobs` tem status próprio, e um
 * lote em que a Meta recusa o terceiro evento não diz qual dos cinco jobs marcar
 * como falho. O volume desta clínica é de dezenas de eventos por mês — não há o
 * que otimizar.
 */
export function montarCorpoDaRequisicao(
  eventos: EventoDaCapi[],
  opcoes: { testEventCode?: string } = {},
): CorpoDaRequisicao {
  return {
    data: eventos,
    // Fora do payload de produção de propósito: com este código preenchido, a
    // Meta trata TUDO como teste e nada conta como conversão real.
    ...(opcoes.testEventCode ? { test_event_code: opcoes.testEventCode } : {}),
  }
}

// ---------------------------------------------------------------------------
// Classificação de falha
// ---------------------------------------------------------------------------

/**
 * Códigos de erro da Graph API que significam "está caindo em cima de você".
 *
 * A Graph API devolve limite de requisições como HTTP **400**, não como 429. Sem
 * este mapa, `classificarStatus` leria 400 como `requisicao` — permanente — e o
 * worker desistiria de um evento que passaria sozinho no ciclo seguinte.
 */
const CODIGOS_DE_LIMITE: ReadonlySet<number> = new Set([4, 17, 32, 613, 80004])

/** Códigos de token: expirado, revogado, sem permissão no dataset. */
const CODIGOS_DE_CREDENCIAL: ReadonlySet<number> = new Set([102, 190, 200, 10])

type ErroDaGraph = {
  error?: {
    code?: number
    error_subcode?: number
    is_transient?: boolean
    message?: string
  }
}

/**
 * Status HTTP + corpo da Meta → motivo.
 *
 * Delega a `classificarStatus` (a taxonomia é uma só no projeto inteiro) e só
 * intervém no caso que ela não tem como saber: o 400 da Graph API que na verdade
 * é transitório. A própria Meta marca isso com `error.is_transient`.
 *
 * O corpo pode não ser JSON — proxy respondendo HTML, resposta truncada. Nesse
 * caso a função não tem opinião e o status decide.
 */
export function classificarErroDaMeta(status: number, corpo: string): MotivoDeFalha {
  const padrao = classificarStatus(status)

  let dados: ErroDaGraph | null = null
  try {
    dados = JSON.parse(corpo) as ErroDaGraph
  } catch {
    return padrao
  }

  const erro = dados?.error
  if (!erro) return padrao

  if (typeof erro.code === 'number') {
    if (CODIGOS_DE_LIMITE.has(erro.code)) return 'limite'
    if (CODIGOS_DE_CREDENCIAL.has(erro.code)) return 'credencial'
  }

  // `is_transient` é a própria Meta dizendo "tente de novo". Fica por último
  // para não sobrepor um 190 (token morto) que viesse marcado assim por engano —
  // repetir com token morto não resolve.
  if (erro.is_transient === true) return 'indisponivel'

  return padrao
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

export type MetaCapiClient = {
  /** Envia um evento. Lança `ErroDeEnvio` classificado em qualquer falha. */
  enviarConversao(evento: EventoDeConversao): Promise<{ eventosRecebidos: number }>
}

/**
 * Cria o cliente, ou devolve `null` quando o envio está desligado.
 *
 * `config` e `fetchImpl` injetáveis pelo mesmo motivo dos outros adaptadores:
 * sem eles, a classificação de erro só apareceria contra a Meta de verdade — que
 * é exatamente o que não dá para chamar sem dataset. Passar `null`
 * explicitamente força o caminho "desligado" no teste; omitir lê o ambiente.
 */
export function criarMetaCapiClient(
  config?: ConfigMeta | null,
  fetchImpl: typeof fetch = fetch,
): MetaCapiClient | null {
  garantirServidor(PROVEDOR)

  const cfg = config === undefined ? configuracaoDaMeta(serverEnv()) : config
  if (!cfg) return null

  const timeoutMs = cfg.timeoutMs ?? TIMEOUT_PADRAO_MS
  const versao = cfg.versaoApi?.trim() || VERSAO_PADRAO_DA_API

  // O token vai na querystring porque é assim que a Meta documenta o endpoint.
  // A URL, portanto, CONTÉM O SEGREDO — e é por isso que nenhuma mensagem de
  // erro daqui inclui a URL, só o nome do provedor e o status. A lista
  // `segredos` é a segunda linha: o corpo de erro da Meta às vezes ecoa a
  // requisição inteira.
  const url =
    `${BASE_GRAPH}/${encodeURIComponent(versao)}/${encodeURIComponent(cfg.datasetId)}/events` +
    `?access_token=${encodeURIComponent(cfg.token)}`

  const segredos = [cfg.token]

  return {
    async enviarConversao(evento) {
      if (!evento.ctwaClid.trim()) {
        // Não deveria chegar aqui: o domínio já zera a lista sem `ctwa_clid`.
        // A checagem existe porque este adaptador também é chamado a partir da
        // fila, cujo conteúdo foi gravado noutro momento — e um evento sem chave
        // de atribuição não otimiza nada e ainda entrega a um terceiro o hash do
        // telefone de uma paciente por nada.
        throw new ErroDeEnvio(
          'Evento sem ctwa_clid: sem a chave de atribuição ele não é enviado',
          'requisicao',
        )
      }

      const corpo = montarCorpoDaRequisicao([montarEventoDaCapi(evento, { wabaId: cfg.wabaId })], {
        testEventCode: cfg.testEventCode,
      })

      let resposta: Response
      try {
        resposta = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: sinalDeTimeout(timeoutMs),
        })
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
        // `text()` e não `json()`: em falha o corpo pode ser HTML de proxy. Ler
        // como JSON trocaria o erro real da Meta por um erro de parse, e é do
        // texto que `classificarErroDaMeta` tira o `error.code`.
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

      let dados: unknown
      try {
        dados = await resposta.json()
      } catch {
        throw new ErroDeEnvio(
          `${PROVEDOR} respondeu ${resposta.status} com um corpo que não é JSON. ` +
            'O evento pode ter sido registrado, então ele não será reenviado automaticamente.',
          'resposta',
          { status: resposta.status },
        )
      }

      const recebidos = (dados as { events_received?: number } | null)?.events_received

      // Zero eventos recebidos com HTTP 200 é o desfecho traiçoeiro desta API: a
      // requisição "deu certo" e nada foi registrado. Tratado como permanente
      // porque a causa é sempre de payload — campo obrigatório faltando, evento
      // fora da janela de 7 dias —, e repetir produz o mesmo zero.
      if (recebidos === 0) {
        throw new ErroDeEnvio(
          `${PROVEDOR} aceitou a requisição mas registrou 0 eventos — confira o payload no Teste de Eventos`,
          'requisicao',
          { status: resposta.status },
        )
      }

      // Contagem ausente não invalida o envio: o 200 já diz que a Meta aceitou, e
      // falhar aqui faria o worker reenviar um evento que já chegou. Ver a mesma
      // decisão sobre `providerMessageId` no adaptador da Evolution.
      return { eventosRecebidos: recebidos ?? 1 }
    },
  }
}
