// @vitest-environment node
/**
 * Adaptador da Conversions API da Meta.
 *
 * Nenhum teste toca a rede — não há dataset nem token, e não vai haver antes de
 * a Dra. criar os dois. O `fetch` é injetado, e é isso que permite conferir
 * offline as quatro coisas que não dá para conferir em produção sem risco:
 *
 *   1. o envio é DESLIGÁVEL, e está desligado enquanto não houver credencial;
 *   2. o corpo do evento sai no formato combinado, e NADA de prontuário entra
 *      nele;
 *   3. o token nunca aparece numa mensagem de erro — a coluna `erro` é lida pela
 *      equipe inteira na tela;
 *   4. a falha é classificada com a mesma taxonomia dos envios ao paciente,
 *      incluindo o caso que só a Meta tem: o 400 que é transitório.
 */
import { describe, expect, it, vi } from 'vitest'
import { ErroDeEnvio } from '@/integrations/envio'
import {
  JANELA_DE_EVENTO_DIAS,
  VERSAO_PADRAO_DA_API,
  classificarErroDaMeta,
  configuracaoDaMeta,
  criarMetaCapiClient,
  montarCorpoDaRequisicao,
  montarEventoDaCapi,
  type ConfigMeta,
  type EventoDeConversao,
} from '@/integrations/meta/capi'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

const TOKEN = 'EAAG0zsecretodetesteQWERTY1234567890'

const config: ConfigMeta = { datasetId: '1234567890', token: TOKEN }

const evento: EventoDeConversao = {
  evento: 'Schedule',
  eventId: 'a'.repeat(64),
  ocorridoEm: new Date('2026-08-20T17:00:00.123Z'),
  ctwaClid: 'ARBc-clid-de-teste',
  telefoneHash: 'b'.repeat(64),
  valor: null,
  moeda: null,
}

type Chamada = { url: string; metodo: string; corpo: string }
type Manipulador = (url: string, init: RequestInit) => Response | Promise<Response>

function jsonOk(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function criarFetch(manipulador: Manipulador = () => jsonOk({ events_received: 1 })) {
  const chamadas: Chamada[] = []
  const fn = async (entrada: unknown, init: RequestInit = {}) => {
    chamadas.push({
      url: String(entrada),
      metodo: init.method ?? 'GET',
      corpo: typeof init.body === 'string' ? init.body : '',
    })
    return manipulador(String(entrada), init)
  }
  return { fetchImpl: fn as unknown as typeof fetch, chamadas }
}

// ---------------------------------------------------------------------------
// Configuração: o envio nasce desligado
// ---------------------------------------------------------------------------

describe('configuracaoDaMeta', () => {
  it('devolve null quando não há nenhuma variável da Meta', () => {
    expect(configuracaoDaMeta({})).toBeNull()
  })

  it('devolve null quando falta o dataset ou o token', () => {
    // Meia credencial ligaria o envio para ele falhar em todo evento e encher a
    // coluna `erro`, que a equipe lê, sobre um recurso que ninguém pediu.
    expect(configuracaoDaMeta({ META_DATASET_ID: '123' })).toBeNull()
    expect(configuracaoDaMeta({ META_CAPI_TOKEN: TOKEN })).toBeNull()
  })

  it('liga com dataset e token, e as demais são refinamento', () => {
    const cfg = configuracaoDaMeta({ META_DATASET_ID: '123', META_CAPI_TOKEN: TOKEN })
    expect(cfg).toEqual({
      datasetId: '123',
      token: TOKEN,
      versaoApi: undefined,
      wabaId: undefined,
      testEventCode: undefined,
    })
  })

  it('carrega WABA, versão e código de teste quando estão preenchidos', () => {
    const cfg = configuracaoDaMeta({
      META_DATASET_ID: '123',
      META_CAPI_TOKEN: TOKEN,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: 'waba-1',
      META_GRAPH_API_VERSION: 'v26.0',
      META_TEST_EVENT_CODE: 'TEST1234',
    })
    expect(cfg?.wabaId).toBe('waba-1')
    expect(cfg?.versaoApi).toBe('v26.0')
    expect(cfg?.testEventCode).toBe('TEST1234')
  })
})

describe('criarMetaCapiClient — envio desligado', () => {
  it('devolve null quando não há configuração', () => {
    // Contrato central desta task: sem credencial o cliente não existe, e quem
    // chama trata isso como "não há o que enviar" — não como erro.
    expect(criarMetaCapiClient(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// montarEventoDaCapi — a função pura, o lugar único do formato
// ---------------------------------------------------------------------------

describe('montarEventoDaCapi', () => {
  it('monta o evento no formato de mensagem de negócios', () => {
    expect(montarEventoDaCapi(evento)).toEqual({
      event_name: 'Schedule',
      event_time: 1787245200,
      event_id: 'a'.repeat(64),
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { ctwa_clid: 'ARBc-clid-de-teste', ph: ['b'.repeat(64)] },
    })
  })

  it('manda event_time em SEGUNDOS, truncando os milissegundos', () => {
    // Milissegundos aqui jogam o evento para daqui a milhares de anos e a Meta
    // descarta. O decimal, para ela, é formato inválido.
    const montado = montarEventoDaCapi(evento)
    expect(montado.event_time).toBe(Math.floor(evento.ocorridoEm.getTime() / 1000))
    expect(Number.isInteger(montado.event_time)).toBe(true)
    expect(String(montado.event_time)).toHaveLength(10)
  })

  it('manda o ctwa_clid em claro e o telefone só em hash', () => {
    const montado = montarEventoDaCapi(evento)
    expect(montado.user_data.ctwa_clid).toBe('ARBc-clid-de-teste')
    expect(montado.user_data.ph).toEqual(['b'.repeat(64)])
    expect(JSON.stringify(montado)).not.toContain('+5511')
  })

  it('omite o ph quando não há telefone, em vez de mandar campo vazio', () => {
    // Hash de string vazia é um valor de 64 caracteres perfeitamente válido, que
    // a Meta tentaria casar com alguém.
    const montado = montarEventoDaCapi({ ...evento, telefoneHash: null })
    expect(montado.user_data.ph).toBeUndefined()
    expect(montado.user_data.ctwa_clid).toBe('ARBc-clid-de-teste')
  })

  it('inclui o WABA só quando ele foi configurado', () => {
    expect(montarEventoDaCapi(evento).user_data.whatsapp_business_account_id).toBeUndefined()
    expect(
      montarEventoDaCapi(evento, { wabaId: 'waba-1' }).user_data.whatsapp_business_account_id,
    ).toBe('waba-1')
  })

  it('leva valor e moeda juntos no Purchase', () => {
    const montado = montarEventoDaCapi({
      ...evento,
      evento: 'Purchase',
      valor: 1800,
      moeda: 'BRL',
    })
    expect(montado.event_name).toBe('Purchase')
    expect(montado.custom_data).toEqual({ value: 1800, currency: 'BRL' })
  })

  it('não manda custom_data nos eventos sem valor', () => {
    // `value` sem `currency` é recusado pela Meta, e um `custom_data` vazio num
    // `Schedule` só serviria para confundir quem lesse o Teste de Eventos.
    expect(montarEventoDaCapi(evento).custom_data).toBeUndefined()
    expect(montarEventoDaCapi({ ...evento, valor: 100, moeda: null }).custom_data).toBeUndefined()
  })

  it('RESTRIÇÃO LEGAL: nada de prontuário atravessa a tradução', () => {
    // O domínio já garante isso na fronteira dele — `EntradaDoFunil` não tem
    // campo para procedimento nem para evolução clínica. Este teste é a segunda
    // trava: mesmo que alguém empurre esses campos por aqui, a tradução não os
    // lê, porque `montarEventoDaCapi` só conhece os sete campos declarados.
    const contaminado = {
      ...evento,
      procedimento: 'Toxina botulínica',
      evolucaoClinica: 'paciente relatou dor',
      nomeCompleto: 'Maria Silva',
      telefoneE164: '+5511987654321',
      patientId: '4d9b6f1e-0000-4000-8000-000000000001',
    } as unknown as EventoDeConversao

    const texto = JSON.stringify(montarEventoDaCapi(contaminado, { wabaId: 'waba-1' }))
    expect(texto).not.toContain('Toxina')
    expect(texto).not.toContain('dor')
    expect(texto).not.toContain('Maria')
    expect(texto).not.toContain('5511987654321')
    expect(texto).not.toContain('4d9b6f1e')
  })
})

describe('montarCorpoDaRequisicao', () => {
  it('embrulha os eventos em data', () => {
    const corpo = montarCorpoDaRequisicao([montarEventoDaCapi(evento)])
    expect(corpo.data).toHaveLength(1)
    expect(corpo.test_event_code).toBeUndefined()
  })

  it('só inclui test_event_code quando ele foi configurado', () => {
    // Com este código preenchido, NADA conta como conversão de verdade. Ele não
    // pode vazar para o payload de produção por acidente.
    const corpo = montarCorpoDaRequisicao([montarEventoDaCapi(evento)], {
      testEventCode: 'TEST1234',
    })
    expect(corpo.test_event_code).toBe('TEST1234')
  })
})

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

describe('enviarConversao', () => {
  it('faz POST no dataset com o token e devolve quantos eventos entraram', async () => {
    const { fetchImpl, chamadas } = criarFetch(() => jsonOk({ events_received: 1 }))
    const cliente = criarMetaCapiClient(config, fetchImpl)!

    await expect(cliente.enviarConversao(evento)).resolves.toEqual({ eventosRecebidos: 1 })

    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].metodo).toBe('POST')
    expect(chamadas[0].url).toBe(
      `https://graph.facebook.com/${VERSAO_PADRAO_DA_API}/1234567890/events` +
        `?access_token=${encodeURIComponent(TOKEN)}`,
    )
    expect(JSON.parse(chamadas[0].corpo)).toEqual({ data: [montarEventoDaCapi(evento)] })
  })

  it('usa a versão da Graph API configurada quando há uma', async () => {
    const { fetchImpl, chamadas } = criarFetch()
    await criarMetaCapiClient({ ...config, versaoApi: 'v26.0' }, fetchImpl)!.enviarConversao(evento)
    expect(chamadas[0].url).toContain('/v26.0/')
  })

  it('recusa evento sem ctwa_clid antes de gastar uma requisição', async () => {
    // O domínio já não gera evento sem a chave de atribuição. Aqui é a rede
    // embaixo, porque a fila foi gravada noutro momento: sem clid o evento não
    // otimiza nada e ainda entregaria a um terceiro o hash do telefone de uma
    // paciente por nada.
    const { fetchImpl, chamadas } = criarFetch()
    const cliente = criarMetaCapiClient(config, fetchImpl)!

    await expect(cliente.enviarConversao({ ...evento, ctwaClid: '  ' })).rejects.toMatchObject({
      name: 'ErroDeEnvio',
      motivo: 'requisicao',
      permanente: true,
    })
    expect(chamadas).toHaveLength(0)
  })

  it('trata 200 com zero eventos recebidos como falha permanente', async () => {
    // O desfecho traiçoeiro desta API: a requisição "deu certo" e nada foi
    // registrado. A causa é sempre de payload, e repetir produz o mesmo zero.
    const { fetchImpl } = criarFetch(() => jsonOk({ events_received: 0 }))
    const cliente = criarMetaCapiClient(config, fetchImpl)!

    const erro = await cliente.enviarConversao(evento).catch((e: unknown) => e as ErroDeEnvio)
    expect((erro as ErroDeEnvio).permanente).toBe(true)
    expect((erro as ErroDeEnvio).message).toMatch(/Teste de Eventos/)
  })

  it('aceita o 200 sem contagem em vez de reenviar o que já chegou', async () => {
    const { fetchImpl } = criarFetch(() => jsonOk({ messages: [] }))
    await expect(criarMetaCapiClient(config, fetchImpl)!.enviarConversao(evento)).resolves.toEqual({
      eventosRecebidos: 1,
    })
  })

  it('recusa corpo que não é JSON sem reenviar automaticamente', async () => {
    const { fetchImpl } = criarFetch(() => new Response('<html>proxy</html>', { status: 200 }))
    const cliente = criarMetaCapiClient(config, fetchImpl)!

    const erro = await cliente.enviarConversao(evento).catch((e: unknown) => e as ErroDeEnvio)
    expect((erro as ErroDeEnvio).motivo).toBe('resposta')
    expect((erro as ErroDeEnvio).permanente).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Classificação de falha
// ---------------------------------------------------------------------------

describe('classificarErroDaMeta', () => {
  it('mantém a taxonomia do projeto quando a Meta não diz nada de novo', () => {
    expect(classificarErroDaMeta(503, 'indisponível')).toBe('indisponivel')
    expect(classificarErroDaMeta(401, '{"error":{"message":"x"}}')).toBe('credencial')
    expect(classificarErroDaMeta(400, '{"error":{"code":100}}')).toBe('requisicao')
    expect(classificarErroDaMeta(429, '')).toBe('limite')
  })

  it('reconhece o limite de requisições que a Graph API manda como 400', () => {
    // Sem isto, `classificarStatus` leria 400 como permanente e o worker
    // desistiria de um evento que passaria sozinho no ciclo seguinte.
    for (const code of [4, 17, 32, 613, 80004]) {
      expect(classificarErroDaMeta(400, JSON.stringify({ error: { code } })), String(code)).toBe(
        'limite',
      )
    }
  })

  it('reconhece token morto mesmo quando ele vem como 400', () => {
    for (const code of [102, 190, 200, 10]) {
      expect(classificarErroDaMeta(400, JSON.stringify({ error: { code } })), String(code)).toBe(
        'credencial',
      )
    }
  })

  it('respeita is_transient, mas sem sobrepor o token morto', () => {
    expect(classificarErroDaMeta(400, '{"error":{"code":1,"is_transient":true}}')).toBe(
      'indisponivel',
    )
    expect(classificarErroDaMeta(400, '{"error":{"code":190,"is_transient":true}}')).toBe(
      'credencial',
    )
  })

  it('não tem opinião sobre corpo que não é JSON', () => {
    expect(classificarErroDaMeta(400, '<html>bad request</html>')).toBe('requisicao')
    expect(classificarErroDaMeta(500, '')).toBe('indisponivel')
  })
})

describe('classificação de falha no envio', () => {
  it('5xx da Meta é transitório', async () => {
    const { fetchImpl } = criarFetch(() => new Response('indisponível', { status: 503 }))
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect(erro).toBeInstanceOf(ErroDeEnvio)
    expect((erro as ErroDeEnvio).motivo).toBe('indisponivel')
    expect((erro as ErroDeEnvio).permanente).toBe(false)
  })

  it('token recusado é credencial e não adianta repetir', async () => {
    const { fetchImpl } = criarFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 190, message: 'token expirado' } }), {
          status: 400,
        }),
    )
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect((erro as ErroDeEnvio).motivo).toBe('credencial')
    expect((erro as ErroDeEnvio).permanente).toBe(true)
  })

  it('limite de requisições é transitório mesmo vindo como 400', async () => {
    const { fetchImpl } = criarFetch(
      () => new Response(JSON.stringify({ error: { code: 4 } }), { status: 400 }),
    )
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect((erro as ErroDeEnvio).motivo).toBe('limite')
    expect((erro as ErroDeEnvio).permanente).toBe(false)
  })

  it('payload recusado é permanente', async () => {
    const { fetchImpl } = criarFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 100, message: 'campo inválido' } }), {
          status: 400,
        }),
    )
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect((erro as ErroDeEnvio).motivo).toBe('requisicao')
    expect((erro as ErroDeEnvio).permanente).toBe(true)
  })

  it('falha de rede é transitória', async () => {
    const { fetchImpl } = criarFetch(() => {
      throw new TypeError('fetch failed')
    })
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect((erro as ErroDeEnvio).motivo).toBe('rede')
    expect((erro as ErroDeEnvio).permanente).toBe(false)
  })

  it('timeout é transitório', async () => {
    const { fetchImpl } = criarFetch(() => {
      const causa = new Error('tempo esgotado')
      causa.name = 'TimeoutError'
      throw causa
    })
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect((erro as ErroDeEnvio).motivo).toBe('timeout')
    expect((erro as ErroDeEnvio).permanente).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// O token não vaza
// ---------------------------------------------------------------------------

describe('o token de CAPI nunca chega à coluna erro', () => {
  it('não aparece quando a Meta ecoa a URL inteira no corpo do erro', async () => {
    // O token vai na querystring, que é como a Meta documenta o endpoint. Um
    // proxy mal configurado — ou a própria Meta — pode ecoar a URL no corpo do
    // erro, e daí ele iria direto para `meta_conversion_jobs.erro`, que a equipe
    // inteira lê na tela.
    const { fetchImpl } = criarFetch(
      () =>
        new Response(
          `erro ao processar https://graph.facebook.com/v25.0/1234567890/events?access_token=${TOKEN}`,
          { status: 400 },
        ),
    )
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect((erro as ErroDeEnvio).message).not.toContain(TOKEN)
    expect((erro as ErroDeEnvio).message).toContain('[oculto]')
  })

  it('não aparece quando a falha é de rede e a causa carrega a URL', async () => {
    const { fetchImpl } = criarFetch(() => {
      throw new TypeError(`fetch failed for https://graph.facebook.com/x?access_token=${TOKEN}`)
    })
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect((erro as ErroDeEnvio).message).not.toContain(TOKEN)
  })

  it('a mensagem de erro nunca inclui a URL da chamada', async () => {
    // A defesa de verdade não é a sanitização, é não colocar a URL na mensagem.
    // A sanitização é a rede embaixo.
    const { fetchImpl } = criarFetch(() => new Response('recusado', { status: 400 }))
    const erro = await criarMetaCapiClient(config, fetchImpl)!
      .enviarConversao(evento)
      .catch((e: unknown) => e as ErroDeEnvio)

    expect((erro as ErroDeEnvio).message).not.toContain('access_token')
    expect((erro as ErroDeEnvio).message).not.toContain('graph.facebook.com')
  })
})

// ---------------------------------------------------------------------------
// Guarda de servidor
// ---------------------------------------------------------------------------

describe('guarda de servidor', () => {
  it('recusa existir no browser, com configuração ou sem', () => {
    vi.stubGlobal('window', {})
    try {
      expect(() => criarMetaCapiClient(config)).toThrow(/servidor/i)
      // A guarda vem ANTES da checagem de configuração: importar isto de um
      // Client Component é erro mesmo no modo desligado.
      expect(() => criarMetaCapiClient(null)).toThrow(/servidor/i)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('JANELA_DE_EVENTO_DIAS', () => {
  it('é a janela de sete dias documentada pela Meta', () => {
    expect(JANELA_DE_EVENTO_DIAS).toBe(7)
  })
})
