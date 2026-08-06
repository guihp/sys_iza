// @vitest-environment node
/**
 * Adaptador do Google Agenda.
 *
 * Três coisas precisam ser verdade aqui, e nenhuma delas dá para conferir em
 * produção sem risco:
 *
 *   1. a sincronia é DESLIGÁVEL, e está desligada enquanto não houver
 *      credencial. Sem isso, um sistema sem conta no Google Cloud — que é o
 *      estado de hoje — passaria a registrar erro a cada consulta marcada;
 *   2. a chave privada da conta de serviço nunca aparece numa mensagem de erro.
 *      Ela é o segredo mais forte do projeto: quem a tem escreve na agenda da
 *      Dra. para sempre;
 *   3. a falha é classificada com a MESMA taxonomia dos envios ao paciente
 *      (`@/integrations/envio`), porque quem chama precisa distinguir "o Google
 *      engasgou" de "a credencial está errada".
 *
 * Nenhum teste toca a rede: o `fetch` é injetado. O par de chaves RSA é gerado
 * na hora — assinar de verdade é o único jeito de provar que o JWT sai bem
 * formado, e é barato.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { ErroDeEnvio } from '@/integrations/envio'
import {
  ENDPOINT_TOKEN,
  configuracaoDoGoogle,
  criarGoogleCalendarClient,
  montarEvento,
  type ConfigGoogle,
} from '@/integrations/google/calendar'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const config: ConfigGoogle = {
  clientEmail: 'agenda@clinica-izadora.iam.gserviceaccount.com',
  privateKey,
  calendarId: 'izadora@clinicaizadora.com.br',
}

const evento = montarEvento({
  pacienteNome: 'Maria Silva',
  procedimentoNome: 'Toxina botulínica',
  inicio: new Date('2026-08-20T17:00:00Z'),
  fim: new Date('2026-08-20T18:00:00Z'),
  observacoes: null,
})

type Chamada = { url: string; metodo: string; cabecalhos: Record<string, string>; corpo: string }

type Manipulador = (url: string, init: RequestInit) => Response | Promise<Response>

function jsonOk(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Resposta padrão do endpoint de token: uma hora de validade. */
function tokenOk(): Response {
  return jsonOk({ access_token: 'ya29.token-de-teste', expires_in: 3600, token_type: 'Bearer' })
}

function criarFetch(manipulador: Manipulador) {
  const chamadas: Chamada[] = []
  const fn = async (entrada: unknown, init: RequestInit = {}) => {
    const url = String(entrada)
    chamadas.push({
      url,
      metodo: init.method ?? 'GET',
      cabecalhos: (init.headers ?? {}) as Record<string, string>,
      corpo: typeof init.body === 'string' ? init.body : '',
    })
    return manipulador(url, init)
  }
  return { fetchImpl: fn as unknown as typeof fetch, chamadas }
}

/** Fluxo feliz: token válido e o que o manipulador devolver para a API. */
function fetchComToken(manipulador: Manipulador) {
  return criarFetch((url, init) =>
    url.startsWith(ENDPOINT_TOKEN) ? tokenOk() : manipulador(url, init),
  )
}

// ---------------------------------------------------------------------------
// montarEvento — função pura
// ---------------------------------------------------------------------------

describe('montarEvento', () => {
  it('monta o evento com título, horários e timezone de São Paulo', () => {
    const evento = montarEvento({
      pacienteNome: 'Maria Silva',
      procedimentoNome: 'Toxina botulínica',
      inicio: new Date('2026-08-20T17:00:00Z'),
      fim: new Date('2026-08-20T18:00:00Z'),
      observacoes: 'Primeira aplicação',
    })

    expect(evento.summary).toBe('Maria Silva — Toxina botulínica')
    expect(evento.description).toBe('Primeira aplicação')
    expect(evento.start).toEqual({
      dateTime: '2026-08-20T17:00:00.000Z',
      timeZone: 'America/Sao_Paulo',
    })
    expect(evento.end).toEqual({
      dateTime: '2026-08-20T18:00:00.000Z',
      timeZone: 'America/Sao_Paulo',
    })
  })

  it('omite a descrição quando não há observação', () => {
    const evento = montarEvento({
      pacienteNome: 'Ana',
      procedimentoNome: 'Avaliação',
      inicio: new Date('2026-08-20T17:00:00Z'),
      fim: new Date('2026-08-20T17:45:00Z'),
      observacoes: null,
    })
    expect(evento.description).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Configuração: a sincronia nasce desligada
// ---------------------------------------------------------------------------

describe('configuracaoDoGoogle', () => {
  const completo = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'agenda@x.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    GOOGLE_CALENDAR_ID: 'izadora@clinicaizadora.com.br',
  }

  it('devolve null quando nenhuma variável do Google está definida', () => {
    expect(
      configuracaoDoGoogle({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
        GOOGLE_PRIVATE_KEY: undefined,
        GOOGLE_CALENDAR_ID: undefined,
      }),
    ).toBeNull()
  })

  it('devolve null quando a configuração está pela metade', () => {
    // Meia credencial é pior que credencial nenhuma: ligaria a sincronia para
    // falhar em toda consulta. Ou está tudo lá, ou está desligada.
    for (const faltante of Object.keys(completo)) {
      const parcial = { ...completo, [faltante]: undefined }
      expect(configuracaoDoGoogle(parcial), faltante).toBeNull()
    }
  })

  it('desdobra o \\n literal da chave privada', () => {
    // A chave é um PEM multilinha e chega do painel do Coolify com `\n`
    // escrito. Sem desdobrar, o `crypto` recusa a chave e toda sincronia falha.
    const cfg = configuracaoDoGoogle({
      ...completo,
      GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    })
    expect(cfg?.privateKey).toBe('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n')
  })

  it('aceita a configuração completa', () => {
    expect(configuracaoDoGoogle(completo)).toEqual({
      clientEmail: 'agenda@x.iam.gserviceaccount.com',
      privateKey: completo.GOOGLE_PRIVATE_KEY,
      calendarId: 'izadora@clinicaizadora.com.br',
    })
  })
})

describe('criarGoogleCalendarClient — sincronia desligada', () => {
  it('devolve null quando não há configuração', () => {
    // Contrato central desta task: sem credencial o cliente não existe, e quem
    // chama trata isso como "não há o que sincronizar" — não como erro.
    expect(criarGoogleCalendarClient(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Criação de evento
// ---------------------------------------------------------------------------

describe('criarEvento', () => {
  it('troca a chave privada por um access token e cria o evento', async () => {
    const { fetchImpl, chamadas } = fetchComToken(() => jsonOk({ id: 'evt_123' }))
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    const resultado = await cliente.criarEvento(evento)

    expect(resultado).toEqual({ eventId: 'evt_123' })
    expect(chamadas).toHaveLength(2)

    const [token, criacao] = chamadas
    expect(token.url).toBe(ENDPOINT_TOKEN)
    expect(token.metodo).toBe('POST')
    expect(token.cabecalhos['Content-Type']).toBe('application/x-www-form-urlencoded')

    expect(criacao.metodo).toBe('POST')
    expect(criacao.url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/izadora%40clinicaizadora.com.br/events',
    )
    expect(criacao.cabecalhos.Authorization).toBe('Bearer ya29.token-de-teste')
    expect(JSON.parse(criacao.corpo)).toEqual(evento)
  })

  it('assina o JWT com a chave privada da conta de serviço', async () => {
    // Sem verificar a assinatura, um erro de montagem do JWT só apareceria
    // contra o Google de verdade — que é justamente o que não podemos chamar.
    const { fetchImpl, chamadas } = fetchComToken(() => jsonOk({ id: 'evt_1' }))
    await criarGoogleCalendarClient(config, fetchImpl)!.criarEvento(evento)

    const corpo = new URLSearchParams(chamadas[0].corpo)
    expect(corpo.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')

    const jwt = corpo.get('assertion')!
    const [cabecalho, reivindicacoes, assinatura] = jwt.split('.')

    expect(JSON.parse(Buffer.from(cabecalho, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })

    const claims = JSON.parse(Buffer.from(reivindicacoes, 'base64url').toString())
    expect(claims.iss).toBe(config.clientEmail)
    expect(claims.aud).toBe(ENDPOINT_TOKEN)
    // Escopo mínimo: escrever evento. Nada de ler contato, nada de Drive.
    expect(claims.scope).toBe('https://www.googleapis.com/auth/calendar.events')
    expect(claims.exp).toBeGreaterThan(claims.iat)

    const verificador = createVerify('RSA-SHA256')
    verificador.update(`${cabecalho}.${reivindicacoes}`)
    expect(
      verificador.verify(createPublicKey(publicKey), Buffer.from(assinatura, 'base64url')),
    ).toBe(true)
  })

  it('reaproveita o token entre chamadas em vez de pedir um novo a cada evento', async () => {
    const { fetchImpl, chamadas } = fetchComToken(() => jsonOk({ id: 'evt_1' }))
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    await cliente.criarEvento(evento)
    await cliente.criarEvento(evento)

    expect(chamadas.filter((c) => c.url === ENDPOINT_TOKEN)).toHaveLength(1)
  })

  it('recusa a resposta sem id: gravar id vazio esconderia o evento órfão', async () => {
    const { fetchImpl } = fetchComToken(() => jsonOk({ status: 'confirmed' }))
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    await expect(cliente.criarEvento(evento)).rejects.toMatchObject({
      name: 'ErroDeEnvio',
      motivo: 'resposta',
    })
  })
})

// ---------------------------------------------------------------------------
// Classificação de falha
// ---------------------------------------------------------------------------

describe('classificação de falha', () => {
  it('5xx do Google é transitório', async () => {
    const { fetchImpl } = fetchComToken(() => new Response('indisponível', { status: 503 }))
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    const erro = await cliente.criarEvento(evento).catch((e: unknown) => e as ErroDeEnvio)
    expect(erro).toBeInstanceOf(ErroDeEnvio)
    expect((erro as ErroDeEnvio).motivo).toBe('indisponivel')
    expect((erro as ErroDeEnvio).permanente).toBe(false)
  })

  it('401 é credencial e não adianta repetir', async () => {
    const { fetchImpl } = fetchComToken(
      () => new Response(JSON.stringify({ error: 'invalid' }), { status: 401 }),
    )
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    const erro = await cliente.criarEvento(evento).catch((e: unknown) => e as ErroDeEnvio)
    expect((erro as ErroDeEnvio).motivo).toBe('credencial')
    expect((erro as ErroDeEnvio).permanente).toBe(true)
  })

  it('403 na troca do token vira credencial, com o nome do passo na mensagem', async () => {
    // A falha mais provável do dia da configuração: a agenda não foi
    // compartilhada com a conta de serviço, ou a API não foi habilitada. A
    // mensagem precisa dizer que quebrou no token, não no evento.
    const { fetchImpl } = criarFetch(
      () => new Response(JSON.stringify({ error: 'access_denied' }), { status: 403 }),
    )
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    const erro = await cliente.criarEvento(evento).catch((e: unknown) => e as ErroDeEnvio)
    expect((erro as ErroDeEnvio).motivo).toBe('credencial')
    expect((erro as ErroDeEnvio).message).toMatch(/token/i)
  })

  it('falha de rede é transitória', async () => {
    const { fetchImpl } = criarFetch(() => {
      throw new TypeError('fetch failed')
    })
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    const erro = await cliente.criarEvento(evento).catch((e: unknown) => e as ErroDeEnvio)
    expect((erro as ErroDeEnvio).motivo).toBe('rede')
    expect((erro as ErroDeEnvio).permanente).toBe(false)
  })

  it('nunca deixa a chave privada aparecer na mensagem de erro', async () => {
    // O corpo de erro de um proxy mal configurado pode ecoar o que foi enviado.
    // Se a chave vazasse daí para o log, quem lesse o log escreveria na agenda
    // da Dra. para sempre.
    const { fetchImpl } = criarFetch(
      () => new Response(`credencial recusada: ${privateKey}`, { status: 400 }),
    )
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    const erro = await cliente.criarEvento(evento).catch((e: unknown) => e as ErroDeEnvio)
    const mensagem = (erro as ErroDeEnvio).message
    expect(mensagem).not.toContain(privateKey)
    expect(mensagem).not.toContain('BEGIN PRIVATE KEY')
    expect(mensagem).toContain('[oculto]')
  })
})

// ---------------------------------------------------------------------------
// Remarcação e cancelamento
// ---------------------------------------------------------------------------

describe('atualizarEvento', () => {
  it('faz PATCH no evento existente, mantendo o mesmo id', async () => {
    const { fetchImpl, chamadas } = fetchComToken(() => jsonOk({ id: 'evt_123' }))
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    await cliente.atualizarEvento('evt_123', evento)

    const patch = chamadas[1]
    expect(patch.metodo).toBe('PATCH')
    expect(patch.url).toMatch(/\/events\/evt_123$/)
    expect(JSON.parse(patch.corpo)).toEqual(evento)
  })

  it('escapa o id do evento na URL', async () => {
    const { fetchImpl, chamadas } = fetchComToken(() => jsonOk({ id: 'a/b' }))
    await criarGoogleCalendarClient(config, fetchImpl)!.atualizarEvento('a/b', evento)
    expect(chamadas[1].url).toMatch(/\/events\/a%2Fb$/)
  })
})

describe('removerEvento', () => {
  it('faz DELETE e aceita a resposta 204 sem corpo', async () => {
    // O Google responde 204 vazio no DELETE. Tratar isso como "resposta
    // ilegível" faria todo cancelamento registrar erro.
    const { fetchImpl, chamadas } = fetchComToken(() => new Response(null, { status: 204 }))
    const cliente = criarGoogleCalendarClient(config, fetchImpl)!

    await expect(cliente.removerEvento('evt_123')).resolves.toBeUndefined()
    expect(chamadas[1].metodo).toBe('DELETE')
    expect(chamadas[1].url).toMatch(/\/events\/evt_123$/)
  })

  it('trata 404 e 410 como sucesso: o evento já não está lá', async () => {
    // Apagado à mão no celular da Dra., ou já removido numa tentativa anterior.
    // Nos dois casos o estado desejado — evento inexistente — foi alcançado.
    for (const status of [404, 410]) {
      const { fetchImpl } = fetchComToken(() => new Response('sumiu', { status }))
      const cliente = criarGoogleCalendarClient(config, fetchImpl)!
      await expect(cliente.removerEvento('evt_123')).resolves.toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Guarda de servidor
// ---------------------------------------------------------------------------

describe('guarda de servidor', () => {
  it('recusa existir no browser mesmo com configuração explícita', () => {
    vi.stubGlobal('window', {})
    try {
      expect(() => criarGoogleCalendarClient(config)).toThrow(/servidor/i)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
