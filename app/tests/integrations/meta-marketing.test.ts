// @vitest-environment node
/**
 * Adaptador da Marketing API da Meta — o lado que só lê.
 *
 * Nenhum teste toca a rede: não existe token de `ads_read` e não vai existir
 * antes de o dono criar o usuário do sistema no Business. O `fetch` é injetado,
 * e é isso que permite conferir offline as cinco coisas que não dá para conferir
 * em produção:
 *
 *   1. a página é DESLIGÁVEL, e está desligada enquanto não houver token;
 *   2. os números da Meta chegam como STRING e viram número de verdade —
 *      `"179.96"` precisa virar 17996 centavos, não `NaN` nem 17995;
 *   3. o token nunca aparece numa mensagem de erro, nem quando a própria Meta o
 *      ecoa de volta no corpo da resposta;
 *   4. cada classe de falha é classificada com a taxonomia do projeto, incluindo
 *      o 400 da Graph API que na verdade é limite de requisições;
 *   5. a saúde do dataset degrada para `null` em vez de derrubar a página.
 */
import { describe, expect, it } from 'vitest'
import { ErroDeEnvio } from '@/integrations/envio'
import { VERSAO_PADRAO_DA_API } from '@/integrations/meta/capi'
import {
  CONTA_DE_ANUNCIOS_PADRAO,
  configuracaoDaMarketingApi,
  conversasDaLinha,
  criarMarketingApiClient,
  interpretarEstadoDoDataset,
  interpretarInsights,
  type ConfigMarketing,
} from '@/integrations/meta/marketing-api'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

const TOKEN = 'EAAGsecretodeanunciosQWERTY1234567890'

const config: ConfigMarketing = { token: TOKEN, contaId: '1526237358668434' }

const PERIODO = { desde: '2026-07-08', ate: '2026-08-06' }

type Manipulador = (url: string, init: RequestInit) => Response | Promise<Response>

function jsonOk(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function criarFetch(manipulador: Manipulador = () => jsonOk({ data: [] })) {
  const chamadas: { url: string; metodo: string }[] = []
  const fn = async (entrada: unknown, init: RequestInit = {}) => {
    chamadas.push({ url: String(entrada), metodo: init.method ?? 'GET' })
    return manipulador(String(entrada), init)
  }
  return { fetchImpl: fn as unknown as typeof fetch, chamadas }
}

/** Uma linha de insights como a Graph API a manda: tudo string. */
const LINHA_DA_META = {
  ad_id: '120210000000000001',
  ad_name: 'Izadora — Botox — vídeo 15s',
  campaign_id: '23850000000000001',
  campaign_name: 'Izadora - Whatsapp - Leads',
  spend: '179.96',
  impressions: '12345',
  clicks: '402',
  actions: [
    { action_type: 'link_click', value: '402' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '24' },
  ],
}

// ---------------------------------------------------------------------------
// Configuração: a página nasce desligada
// ---------------------------------------------------------------------------

describe('configuracaoDaMarketingApi', () => {
  it('devolve null sem token — é o estado da clínica hoje', () => {
    expect(configuracaoDaMarketingApi({})).toBeNull()
  })

  it('trata token em branco como ausente', () => {
    // O Coolify grava variável não preenchida como string vazia. Um token de
    // espaços ligaria a página para ela falhar em toda consulta.
    expect(configuracaoDaMarketingApi({ META_ADS_TOKEN: '   ' })).toBeNull()
  })

  it('liga só com o token, caindo na conta padrão', () => {
    expect(configuracaoDaMarketingApi({ META_ADS_TOKEN: TOKEN })).toEqual({
      token: TOKEN,
      contaId: CONTA_DE_ANUNCIOS_PADRAO,
      versaoApi: undefined,
    })
  })

  it('aceita a conta colada com o prefixo act_ da URL do Gerenciador', () => {
    const cfg = configuracaoDaMarketingApi({
      META_ADS_TOKEN: TOKEN,
      META_AD_ACCOUNT_ID: 'act_999888777',
    })
    // Sem isto a URL viraria `act_act_999888777` e a Meta responderia 400 numa
    // configuração que a pessoa jura ter preenchido certo.
    expect(cfg?.contaId).toBe('999888777')
  })
})

describe('criarMarketingApiClient', () => {
  it('devolve null quando a configuração está desligada', () => {
    expect(criarMarketingApiClient(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tradução da resposta: o número que vem como texto
// ---------------------------------------------------------------------------

describe('interpretarInsights', () => {
  it('converte os números que a Meta manda como string', () => {
    const [linha] = interpretarInsights({ data: [LINHA_DA_META] })

    expect(linha).toEqual({
      adId: '120210000000000001',
      adNome: 'Izadora — Botox — vídeo 15s',
      campanhaId: '23850000000000001',
      campanhaNome: 'Izadora - Whatsapp - Leads',
      gastoCentavos: 17996,
      impressoes: 12345,
      cliques: 402,
      conversas: 24,
    })
  })

  it('arredonda o gasto em vez de truncar', () => {
    // `179.96 * 100` em ponto flutuante é 17995.999999999998. Truncar tiraria um
    // centavo por linha, e a soma da tabela deixaria de bater com o Gerenciador.
    const [linha] = interpretarInsights({ data: [{ ad_id: '1', spend: '179.96' }] })
    expect(linha.gastoCentavos).toBe(17996)
  })

  it('descarta linha sem ad_id — sem a chave ela não cruza com nada', () => {
    expect(interpretarInsights({ data: [{ spend: '10.00' }] })).toEqual([])
  })

  it('não devolve NaN para campo ausente, torto ou nulo', () => {
    const [linha] = interpretarInsights({
      data: [{ ad_id: '1', spend: 'sei lá', impressions: null, clicks: undefined }],
    })
    expect(linha.gastoCentavos).toBe(0)
    expect(linha.impressoes).toBe(0)
    expect(linha.cliques).toBe(0)
    expect(Number.isNaN(linha.gastoCentavos)).toBe(false)
  })

  it('usa o id como rótulo quando o anúncio não tem nome', () => {
    const [linha] = interpretarInsights({ data: [{ ad_id: '99' }] })
    expect(linha.adNome).toBe('Anúncio 99')
  })

  it('devolve lista vazia para corpo inesperado, em vez de lançar', () => {
    expect(interpretarInsights(null)).toEqual([])
    expect(interpretarInsights({})).toEqual([])
    expect(interpretarInsights({ data: 'nada disso' })).toEqual([])
  })
})

describe('conversasDaLinha', () => {
  it('lê o rótulo preferido de conversa iniciada', () => {
    expect(conversasDaLinha(LINHA_DA_META.actions)).toBe(24)
  })

  it('aceita os rótulos alternativos que a Meta usa para a mesma coisa', () => {
    expect(
      conversasDaLinha([{ action_type: 'onsite_conversion.total_messaging_connection', value: '7' }]),
    ).toBe(7)
  })

  it('não soma dois rótulos da mesma coisa — a primeira preferência vence', () => {
    // Somar contaria a mesma conversa duas vezes e derrubaria o custo por
    // conversa pela metade.
    const conversas = conversasDaLinha([
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '24' },
      { action_type: 'onsite_conversion.total_messaging_connection', value: '24' },
    ])
    expect(conversas).toBe(24)
  })

  it('devolve zero quando não há ação de conversa nenhuma', () => {
    expect(conversasDaLinha([{ action_type: 'link_click', value: '402' }])).toBe(0)
    expect(conversasDaLinha(undefined)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// A requisição
// ---------------------------------------------------------------------------

describe('insightsPorAnuncio', () => {
  it('faz GET no nó da conta, no nível do anúncio e no período pedido', async () => {
    const { fetchImpl, chamadas } = criarFetch(() => jsonOk({ data: [LINHA_DA_META] }))
    const cliente = criarMarketingApiClient(config, fetchImpl)!

    const linhas = await cliente.insightsPorAnuncio(PERIODO)

    expect(linhas).toHaveLength(1)
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].metodo).toBe('GET')

    const url = new URL(chamadas[0].url)
    // `act_` faz parte do id do nó: sem ele a Graph API responde 400.
    expect(url.pathname).toBe(`/${VERSAO_PADRAO_DA_API}/act_1526237358668434/insights`)
    // Sem `level=ad` a resposta vem agregada pela conta e o cruzamento fica sem
    // chave — é a linha que sustenta a página inteira.
    expect(url.searchParams.get('level')).toBe('ad')
    expect(url.searchParams.get('fields')).toContain('ad_id')
    expect(url.searchParams.get('time_range')).toBe(
      JSON.stringify({ since: '2026-07-08', until: '2026-08-06' }),
    )
  })

  it('não faz nada além de GET — a página é somente leitura', async () => {
    const { fetchImpl, chamadas } = criarFetch()
    const cliente = criarMarketingApiClient(config, fetchImpl)!

    await cliente.insightsPorAnuncio(PERIODO)
    await cliente.estadoDoDataset('123')

    expect(chamadas.every((chamada) => chamada.metodo === 'GET')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Falha: cada classe, e o token fora de todas elas
// ---------------------------------------------------------------------------

describe('classificação de falha', () => {
  async function falharCom(resposta: Response | Error): Promise<ErroDeEnvio> {
    const { fetchImpl } = criarFetch(() => {
      if (resposta instanceof Error) throw resposta
      return resposta
    })
    const cliente = criarMarketingApiClient(config, fetchImpl)!
    try {
      await cliente.insightsPorAnuncio(PERIODO)
    } catch (causa) {
      return causa as ErroDeEnvio
    }
    throw new Error('esperava falha e não houve')
  }

  it('token expirado ou revogado é credencial — repetir não resolve', async () => {
    const erro = await falharCom(
      new Response(JSON.stringify({ error: { code: 190, message: 'Session expired' } }), {
        status: 400,
      }),
    )
    expect(erro).toBeInstanceOf(ErroDeEnvio)
    expect(erro.motivo).toBe('credencial')
    expect(erro.permanente).toBe(true)
  })

  it('limite de requisições vem como 400 na Graph API e é transitório', async () => {
    // É a armadilha desta API: sem o mapa de códigos, o 400 seria lido como
    // requisição inválida e a página desistiria de um erro que passa sozinho.
    const erro = await falharCom(
      new Response(JSON.stringify({ error: { code: 17, message: 'User request limit reached' } }), {
        status: 400,
      }),
    )
    expect(erro.motivo).toBe('limite')
    expect(erro.permanente).toBe(false)
  })

  it('403 é credencial: token sem acesso à conta de anúncios', async () => {
    const erro = await falharCom(new Response('sem permissão', { status: 403 }))
    expect(erro.motivo).toBe('credencial')
  })

  it('5xx é indisponibilidade', async () => {
    const erro = await falharCom(new Response('<html>502</html>', { status: 502 }))
    expect(erro.motivo).toBe('indisponivel')
    expect(erro.permanente).toBe(false)
  })

  it('400 sem código conhecido continua sendo requisição inválida', async () => {
    const erro = await falharCom(new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 }))
    expect(erro.motivo).toBe('requisicao')
  })

  it('queda de rede vira motivo de rede, com a causa desembrulhada', async () => {
    const queda = new TypeError('fetch failed')
    ;(queda as { cause?: unknown }).cause = new Error('ECONNREFUSED')
    const erro = await falharCom(queda)
    expect(erro.motivo).toBe('rede')
    expect(erro.message).toContain('ECONNREFUSED')
  })

  it('interrupção por tempo vira timeout', async () => {
    const abortado = new Error('abortado')
    abortado.name = 'TimeoutError'
    const erro = await falharCom(abortado)
    expect(erro.motivo).toBe('timeout')
  })

  it('200 com corpo que não é JSON vira resposta ilegível', async () => {
    const erro = await falharCom(
      new Response('não sou json', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    expect(erro.motivo).toBe('resposta')
  })

  it('NUNCA deixa o token vazar para a mensagem, nem quando a Meta o ecoa', async () => {
    // A mensagem termina na tela da Dra. O token está na querystring, e o corpo
    // de erro da Graph API às vezes devolve a requisição inteira.
    const erro = await falharCom(
      new Response(
        JSON.stringify({
          error: { code: 190, message: `Invalid access_token=${TOKEN} for act_1526237358668434` },
        }),
        { status: 401 },
      ),
    )
    expect(erro.message).not.toContain(TOKEN)
    expect(erro.message).toContain('[oculto]')
  })

  it('a mensagem também não carrega a URL, que contém o segredo', async () => {
    const erro = await falharCom(new Response('erro', { status: 500 }))
    expect(erro.message).not.toContain('graph.facebook.com')
    expect(erro.message).not.toContain(TOKEN)
  })
})

// ---------------------------------------------------------------------------
// Saúde do dataset: acessória, nunca fatal
// ---------------------------------------------------------------------------

describe('interpretarEstadoDoDataset', () => {
  it('lê volume por evento, frescor e qualidade de correspondência', () => {
    const estado = interpretarEstadoDoDataset({
      event_match_quality: 7.4,
      data: [
        { event_name: 'Schedule', count: '12', start_time: 1_785_000_000 },
        { event_name: 'Purchase', count: '3', start_time: 1_785_600_000 },
      ],
    })

    expect(estado?.qualidadeDaCorrespondencia).toBe(7.4)
    expect(estado?.volumePorEvento).toEqual([
      { evento: 'Schedule', quantidade: 12 },
      { evento: 'Purchase', quantidade: 3 },
    ])
    // Segundos, não milissegundos: a mesma pegadinha do `event_time` da CAPI, do
    // lado da leitura. Tratar como ms jogaria o último evento para 1970.
    expect(estado?.ultimoEventoEm?.getTime()).toBe(1_785_600_000 * 1000)
  })

  it('devolve null quando não reconhece nada — bloco ausente é melhor que falso', () => {
    expect(interpretarEstadoDoDataset(null)).toBeNull()
    expect(interpretarEstadoDoDataset({})).toBeNull()
    expect(interpretarEstadoDoDataset({ data: [{ sem: 'nada útil' }] })).toBeNull()
  })
})

describe('estadoDoDataset', () => {
  it('devolve null em vez de lançar quando o dataset não existe', async () => {
    const { fetchImpl } = criarFetch(() => new Response('{"error":{"code":803}}', { status: 400 }))
    const cliente = criarMarketingApiClient(config, fetchImpl)!

    // Propagar transformaria "não consegui ler a saúde do dataset" em "a página
    // de marketing está quebrada" — e a página existe para outra coisa.
    await expect(cliente.estadoDoDataset('123')).resolves.toBeNull()
  })

  it('nem consulta quando não há dataset configurado', async () => {
    const { fetchImpl, chamadas } = criarFetch()
    const cliente = criarMarketingApiClient(config, fetchImpl)!

    await expect(cliente.estadoDoDataset('')).resolves.toBeNull()
    expect(chamadas).toHaveLength(0)
  })
})
