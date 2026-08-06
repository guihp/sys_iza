/**
 * Contrato comum dos adaptadores que falam com o mundo externo para entregar
 * uma mensagem ao paciente — hoje a Evolution API (WhatsApp) e o Resend
 * (e-mail).
 *
 * Este módulo existe por um motivo só, e ele é a razão de ser da Task 10:
 * **classificar a falha**. O worker de despacho (Task 11) precisa decidir, a
 * cada erro, entre duas coisas muito diferentes:
 *
 *   - tentar de novo daqui a pouco — a rede caiu, o provedor engasgou, batemos
 *     no limite de requisições. Nada de errado com a mensagem;
 *   - desistir e marcar `falhou` — a chave está errada, o número não existe no
 *     WhatsApp, o e-mail é inválido. Repetir só gasta tentativa e atrasa a fila.
 *
 * Errar essa decisão custa caro nos dois sentidos: classificar um 500 como
 * permanente faz a paciente não receber a confirmação da consulta de amanhã por
 * causa de um deploy do provedor; classificar um 400 como transitório enche a
 * fila de retentativas que nunca vão dar certo e escondem as falhas reais.
 *
 * Por isso a classificação não é `status >= 400 && status < 500`. Três dos
 * códigos 4xx (408, 425, 429) são explicitamente "tente de novo", e dois deles
 * (401, 403) merecem destaque próprio porque não são erro de mensagem, são erro
 * de configuração do sistema — a equipe não consegue resolver relendo o cadastro
 * da paciente.
 *
 * Módulo de servidor/worker. Nada aqui pode ser importado por Client Component:
 * ver `garantirServidor()` no fim do arquivo.
 */

/**
 * Por que a mensagem não saiu. Existe para dar ao erro um nome estável, legível
 * na coluna `reminder_jobs.erro` e verificável em teste — em vez de obrigar
 * quem lê a interpretar um número HTTP.
 */
export type MotivoDeFalha =
  /** A requisição não chegou ao provedor: DNS, conexão recusada, TLS. */
  | 'rede'
  /** O provedor não respondeu dentro do tempo, ou devolveu 408. */
  | 'timeout'
  /** Limite de requisições do provedor (429/425). */
  | 'limite'
  /** O provedor está fora do ar ou instável (5xx). */
  | 'indisponivel'
  /** Chave/credencial recusada (401, 403, 407). Retentar não resolve. */
  | 'credencial'
  /** Destinatário inválido — telefone ou e-mail que não dá para entregar. */
  | 'destinatario'
  /** A requisição está errada: payload recusado, instância inexistente. */
  | 'requisicao'
  /** O provedor respondeu algo que não dá para interpretar. */
  | 'resposta'

/**
 * Os motivos em que repetir a mesma chamada, com os mesmos dados, produz
 * exatamente o mesmo resultado.
 *
 * `resposta` mora aqui e o motivo é sutil: quando o provedor responde 200 com
 * um corpo ilegível, a mensagem provavelmente FOI enviada — só não conseguimos
 * ler o id. Retentar nesse caso não corrige nada e ainda arrisca mandar a mesma
 * mensagem duas vezes para a paciente, que é o pior erro que este sistema pode
 * cometer. Melhor parar, registrar e deixar alguém olhar.
 */
const MOTIVOS_PERMANENTES: ReadonlySet<MotivoDeFalha> = new Set<MotivoDeFalha>([
  'credencial',
  'destinatario',
  'requisicao',
  'resposta',
])

/**
 * Falha de envio já classificada.
 *
 * `permanente` é derivado de `motivo` no construtor, e não recebido pronto: se
 * fossem dois parâmetros independentes, um `new ErroDeEnvio('429...', true)`
 * digitado errado em algum ponto faria a fila desistir de um erro que ia passar
 * sozinho, e o teste do adaptador não pegaria.
 *
 * A exceção original NÃO é anexada como `cause`. É deliberado: o erro termina
 * na coluna `erro` de `reminder_jobs`, que a equipe lê na tela, e um objeto de
 * erro do runtime pode arrastar junto a requisição inteira — cabeçalhos
 * inclusive, e é ali que mora a chave da API. O que interessa da causa já vem
 * na mensagem, sanitizado.
 */
export class ErroDeEnvio extends Error {
  /** true quando repetir não vai adiantar (número inválido, chave recusada). */
  readonly permanente: boolean
  readonly motivo: MotivoDeFalha
  /** Status HTTP, quando houve resposta. Ausente em falha de rede ou timeout. */
  readonly status?: number

  constructor(mensagem: string, motivo: MotivoDeFalha, opcoes?: { status?: number }) {
    super(mensagem)
    this.name = 'ErroDeEnvio'
    this.motivo = motivo
    this.permanente = MOTIVOS_PERMANENTES.has(motivo)
    this.status = opcoes?.status
  }
}

/**
 * Status HTTP → motivo.
 *
 * A ordem das checagens importa: os 4xx transitórios precisam ser reconhecidos
 * antes da regra geral de 4xx, senão viram permanentes.
 */
export function classificarStatus(status: number): MotivoDeFalha {
  // 408 Request Timeout e 425 Too Early: o provedor pediu para tentar de novo.
  if (status === 408) return 'timeout'
  if (status === 425 || status === 429) return 'limite'
  // 401/403/407 é chave errada, instância sem autorização, proxy exigindo auth.
  // Separado dos demais 4xx porque a correção é de configuração, não de cadastro.
  if (status === 401 || status === 403 || status === 407) return 'credencial'
  if (status >= 500) return 'indisponivel'
  if (status >= 400) return 'requisicao'
  // 1xx/2xx/3xx caindo aqui significa que `resposta.ok` era falso por outro
  // motivo (um 3xx não seguido, por exemplo). Não sabemos o que aconteceu, e
  // repetir às cegas pode duplicar mensagem: tratamos como permanente.
  return 'resposta'
}

const MASCARA = '[oculto]'
const TAMANHO_MAXIMO = 300

/**
 * Padrões que parecem credencial mesmo quando não sabemos qual é o segredo.
 *
 * A primeira linha de defesa é o segredo literal, passado pelo adaptador. Estes
 * padrões são a segunda: cobrem o caso em que o provedor devolve um token que
 * não é o nosso (um id de sessão, a chave de outra instância) ou em que o
 * segredo aparece numa forma que não bate caractere a caractere.
 */
const PADROES_DE_SEGREDO: readonly RegExp[] = [
  // "Bearer xxx", "apikey: xxx", "apikey=xxx", '"api_key":"xxx"'.
  /\b(?:bearer|api[-_]?key|authorization|token)\b["'\s:=]*[A-Za-z0-9._~+/-]{8,}=*/gi,
  // Chave do Resend, que tem prefixo próprio e aparece solta no corpo de erro.
  /\bre_[A-Za-z0-9_-]{8,}/g,
]

function escaparParaRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Deixa a mensagem de erro segura para ir ao banco e à tela.
 *
 * Faz três coisas, nesta ordem:
 *
 *   1. apaga os segredos literais que o adaptador conhece (a própria chave).
 *      Segredo com menos de 8 caracteres é ignorado — mascarar uma "chave" de
 *      um ou dois caracteres transformaria o texto inteiro em `[oculto]` e
 *      destruiria a informação que a equipe precisa ler;
 *   2. apaga o que tem cara de credencial mesmo sendo desconhecido;
 *   3. achata quebras de linha e corta o excesso. Provedor atrás de proxy
 *      responde página HTML inteira em caso de falha, e essa página não pode
 *      virar um parágrafo de lixo na tela de lembretes.
 *
 * O segredo é escapado antes de virar regex: uma chave que contenha `.` ou `+`
 * seria interpretada como padrão e mascararia texto legítimo.
 */
export function sanitizarMensagem(
  texto: string,
  segredos: ReadonlyArray<string | undefined>,
): string {
  let limpo = texto

  for (const segredo of segredos) {
    if (!segredo || segredo.length < 8) continue
    limpo = limpo.replace(new RegExp(escaparParaRegex(segredo), 'gi'), MASCARA)
  }

  for (const padrao of PADROES_DE_SEGREDO) {
    limpo = limpo.replace(padrao, MASCARA)
  }

  limpo = limpo.replace(/\s+/g, ' ').trim()
  return limpo.length > TAMANHO_MAXIMO ? `${limpo.slice(0, TAMANHO_MAXIMO)}…` : limpo
}

/** Tempo máximo de espera por provedor. Ver `postarJson`. */
export const TIMEOUT_PADRAO_MS = 15_000

/**
 * Descreve a exceção do `fetch` sem carregar o objeto junto.
 *
 * O `undici` embrulha a falha real: o que chega é `TypeError: fetch failed` com
 * a causa verdadeira (`ECONNREFUSED`, `ENOTFOUND`) um nível abaixo. Sem
 * desembrulhar, toda falha de rede viraria a mesma mensagem inútil na tela.
 */
function descreverCausa(causa: unknown): string {
  if (causa instanceof Error) {
    const raiz = (causa as { cause?: unknown }).cause
    const detalhe = raiz instanceof Error ? ` (${raiz.message})` : ''
    return `${causa.message}${detalhe}`
  }
  return String(causa)
}

function ehInterrupcaoPorTempo(causa: unknown): boolean {
  const nome = (causa as { name?: string } | null)?.name
  return nome === 'TimeoutError' || nome === 'AbortError'
}

/**
 * `AbortSignal.timeout` existe no Node 18+ e em todo runtime que roda este
 * projeto, mas a checagem evita quebrar num ambiente de teste que substitua os
 * globais: envio sem timeout é pior que envio sem sinal de aborto.
 */
function sinalDeTimeout(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
}

export type PedidoDeEnvio = {
  /** Nome do provedor como aparece para a equipe na tela. */
  provedor: string
  url: string
  cabecalhos: Record<string, string>
  corpo: unknown
  fetchImpl: typeof fetch
  timeoutMs: number
  /** Valores que jamais podem aparecer na mensagem de erro. */
  segredos: ReadonlyArray<string | undefined>
}

/**
 * Faz o POST, classifica tudo que pode dar errado e devolve o JSON da resposta.
 *
 * Está aqui, e não duplicado nos dois adaptadores, porque a taxonomia de erro é
 * a parte que precisa ser idêntica entre WhatsApp e e-mail: é ela que o worker
 * lê para decidir retentar. Dois lugares implementando "o que é transitório"
 * viram, em algum momento, duas respostas diferentes para o mesmo 429.
 */
export async function postarJson(pedido: PedidoDeEnvio): Promise<unknown> {
  const { provedor, segredos } = pedido

  let resposta: Response
  try {
    resposta = await pedido.fetchImpl(pedido.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...pedido.cabecalhos },
      body: JSON.stringify(pedido.corpo),
      signal: sinalDeTimeout(pedido.timeoutMs),
    })
  } catch (causa) {
    if (ehInterrupcaoPorTempo(causa)) {
      throw new ErroDeEnvio(`${provedor} não respondeu em ${pedido.timeoutMs} ms`, 'timeout')
    }
    throw new ErroDeEnvio(
      `Falha de rede ao chamar ${provedor}: ${sanitizarMensagem(descreverCausa(causa), segredos)}`,
      'rede',
    )
  }

  if (!resposta.ok) {
    // `text()` e não `json()`: em falha o corpo pode ser HTML de proxy, texto
    // puro ou nada. Tentar interpretar como JSON aqui trocaria o erro real do
    // provedor por um erro de parse, e a equipe perderia a explicação.
    let corpo = ''
    try {
      corpo = await resposta.text()
    } catch {
      corpo = ''
    }
    const detalhe = sanitizarMensagem(corpo, segredos)
    throw new ErroDeEnvio(
      `${provedor} respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : ''}`,
      classificarStatus(resposta.status),
      { status: resposta.status },
    )
  }

  try {
    return await resposta.json()
  } catch {
    throw new ErroDeEnvio(
      `${provedor} respondeu ${resposta.status} com um corpo que não é JSON. ` +
        'A mensagem pode ter sido entregue, então ela não será reenviada automaticamente — confira com o paciente.',
      'resposta',
      { status: resposta.status },
    )
  }
}

/**
 * Barreira contra importar um adaptador de envio em Client Component.
 *
 * `serverEnv()` já se recusa a rodar no browser, o que protege o caso normal —
 * a chave vem do ambiente. Esta guarda cobre o outro caminho: um adaptador
 * construído com config explícita passaria direto por `serverEnv()` e mandaria
 * a chave junto no bundle do cliente. Chamar isto na criação do cliente faz o
 * erro aparecer no primeiro render, e não no dia em que alguém abrir o DevTools
 * e achar a `EVOLUTION_API_KEY` no JavaScript da página.
 */
export function garantirServidor(provedor: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      `O adaptador do ${provedor} é de servidor/worker — usá-lo no browser vazaria a chave de API`,
    )
  }
}
