// @vitest-environment node
/**
 * A sincronia com o Google Agenda como EFEITO COLATERAL do agendamento.
 *
 * A regra que estes testes existem para travar é uma só, e é a razão de ser
 * desta camada:
 *
 *   **falha no Google nunca derruba o agendamento.**
 *
 * A consulta é gravada no Supabase primeiro. O evento no calendário é um
 * espelho de conveniência para o celular da Dra. Se o Google recusar, expirar,
 * estiver fora do ar ou simplesmente desligado, a secretária continua vendo
 * "consulta marcada" e `appointments.google_event_id` fica nulo — e é do nulo
 * que uma sincronia futura sabe que ainda há evento a criar.
 *
 * O caminho contrário — derrubar o agendamento por causa do calendário — seria
 * a secretária com a paciente na linha, sem horário, por causa de um recurso
 * que a clínica nem contratou.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { criarGoogleCalendarClient, type ConfigGoogle } from '@/integrations/google/calendar'
import { sincronizarConsultaNoGoogle } from '@/lib/google-agenda'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const config: ConfigGoogle = {
  clientEmail: 'agenda@clinica-izadora.iam.gserviceaccount.com',
  privateKey,
  calendarId: 'izadora@clinicaizadora.com.br',
}

const ENV_DO_GOOGLE = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: config.clientEmail,
  GOOGLE_PRIVATE_KEY: privateKey,
  GOOGLE_CALENDAR_ID: config.calendarId,
}

/** Ambiente mínimo para `serverEnv()` não reclamar do resto do sistema. */
const ENV_BASE = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  EVOLUTION_URL: 'http://evolution:8080',
  EVOLUTION_API_KEY: 'chave-evolution',
  EVOLUTION_INSTANCE: 'clinica',
  RESEND_API_KEY: 're_123456789',
  EMAIL_FROM: 'contato@clinicaizadora.com.br',
}

type LinhaDaConsulta = {
  id: string
  inicio: string
  fim: string
  status: string
  observacoes: string | null
  google_event_id: string | null
  patients: { nome_completo: string } | null
  procedures: { nome: string } | null
}

const consultaBase: LinhaDaConsulta = {
  id: 'a1',
  inicio: '2026-08-20T17:00:00.000Z',
  fim: '2026-08-20T18:00:00.000Z',
  status: 'agendado',
  observacoes: null,
  google_event_id: null,
  patients: { nome_completo: 'Maria Silva' },
  procedures: { nome: 'Toxina botulínica' },
}

/**
 * Supabase de mentira, chainável.
 *
 * `then` no construtor de consulta é o que faz `await ...gte().lt()` funcionar
 * sem `single()` — é assim que o client de verdade se comporta.
 */
function criarSupabaseFalso(opcoes: { consulta?: LinhaDaConsulta | null; erroNaLeitura?: boolean } = {}) {
  const consulta = opcoes.consulta === undefined ? consultaBase : opcoes.consulta
  const inseridos: Array<{ tabela: string; valores: unknown }> = []
  const atualizados: Array<{ tabela: string; valores: unknown }> = []

  function construtor(tabela: string) {
    let modo: 'select' | 'insert' | 'update' = 'select'

    const alvo = {
      select: () => alvo,
      eq: () => alvo,
      gte: () => alvo,
      lt: () => alvo,
      order: () => alvo,
      insert(valores: unknown) {
        modo = 'insert'
        inseridos.push({ tabela, valores })
        return alvo
      },
      update(valores: unknown) {
        modo = 'update'
        atualizados.push({ tabela, valores })
        return alvo
      },
      async single() {
        if (modo === 'insert') return { data: { id: 'a1' }, error: null }
        if (tabela === 'procedures') {
          return {
            data: { id: 'p1', nome: 'Toxina botulínica', duracao_minutos: 60 },
            error: null,
          }
        }
        if (tabela === 'appointments') {
          if (opcoes.erroNaLeitura) return { data: null, error: { message: 'sem acesso' } }
          return { data: consulta, error: null }
        }
        return { data: null, error: null }
      },
      then(resolver: (valor: { data: unknown[]; error: null }) => unknown) {
        // Agenda vazia: nenhuma consulta concorrente no dia.
        return Promise.resolve({ data: [], error: null }).then(resolver)
      },
    }
    return alvo
  }

  return {
    cliente: { from: (tabela: string) => construtor(tabela) } as never,
    inseridos,
    atualizados,
  }
}

type Manipulador = (url: string) => Response

function criarFetch(manipulador: Manipulador) {
  const chamadas: Array<{ url: string; metodo: string }> = []
  const fn = async (entrada: unknown, init: RequestInit = {}) => {
    const url = String(entrada)
    chamadas.push({ url, metodo: init.method ?? 'GET' })
    return manipulador(url)
  }
  return { fetchImpl: fn as unknown as typeof fetch, chamadas }
}

function tokenOk(): Response {
  return new Response(JSON.stringify({ access_token: 'ya29.teste', expires_in: 3600 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchComToken(manipulador: Manipulador) {
  return criarFetch((url) =>
    url.startsWith('https://oauth2.googleapis.com/token') ? tokenOk() : manipulador(url),
  )
}

let avisos: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// sincronizarConsultaNoGoogle
// ---------------------------------------------------------------------------

describe('sincronizarConsultaNoGoogle — integração desligada', () => {
  it('não faz nada, não chama a rede e não registra erro', async () => {
    const { cliente, atualizados } = criarSupabaseFalso()

    const resultado = await sincronizarConsultaNoGoogle(cliente, 'a1', null)

    expect(resultado).toEqual({ ok: true, situacao: 'desligada' })
    expect(atualizados).toEqual([])
    // Sem credencial NÃO é falha: é o estado normal da clínica hoje. Um aviso a
    // cada consulta marcada treinaria a equipe a ignorar o log.
    expect(avisos).not.toHaveBeenCalled()
  })
})

describe('sincronizarConsultaNoGoogle — criação', () => {
  it('cria o evento e guarda o id na consulta', async () => {
    const { fetchImpl, chamadas } = fetchComToken(
      () =>
        new Response(JSON.stringify({ id: 'evt_123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const { cliente, atualizados } = criarSupabaseFalso()

    const resultado = await sincronizarConsultaNoGoogle(
      cliente,
      'a1',
      criarGoogleCalendarClient(config, fetchImpl),
    )

    expect(resultado).toEqual({ ok: true, situacao: 'criado' })
    expect(atualizados).toEqual([{ tabela: 'appointments', valores: { google_event_id: 'evt_123' } }])
    expect(chamadas[1].metodo).toBe('POST')
  })

  it('atualiza o evento existente em vez de criar um segundo', async () => {
    // Remarcação: a consulta já tem `google_event_id`. Criar de novo deixaria
    // dois blocos no celular da Dra., um deles no horário velho.
    const { fetchImpl, chamadas } = fetchComToken(
      () =>
        new Response(JSON.stringify({ id: 'evt_123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const { cliente, atualizados } = criarSupabaseFalso({
      consulta: { ...consultaBase, google_event_id: 'evt_123' },
    })

    const resultado = await sincronizarConsultaNoGoogle(
      cliente,
      'a1',
      criarGoogleCalendarClient(config, fetchImpl),
    )

    expect(resultado).toEqual({ ok: true, situacao: 'atualizado' })
    expect(chamadas[1].metodo).toBe('PATCH')
    // Nada a gravar: o id não mudou.
    expect(atualizados).toEqual([])
  })
})

describe('sincronizarConsultaNoGoogle — cancelamento', () => {
  it('remove o evento e limpa o id quando a consulta está cancelada', async () => {
    const { fetchImpl, chamadas } = fetchComToken(() => new Response(null, { status: 204 }))
    const { cliente, atualizados } = criarSupabaseFalso({
      consulta: { ...consultaBase, status: 'cancelado', google_event_id: 'evt_123' },
    })

    const resultado = await sincronizarConsultaNoGoogle(
      cliente,
      'a1',
      criarGoogleCalendarClient(config, fetchImpl),
    )

    expect(resultado).toEqual({ ok: true, situacao: 'removido' })
    expect(chamadas[1].metodo).toBe('DELETE')
    // O id sai da linha junto com o evento: manter um id apontando para evento
    // inexistente faria a próxima sincronia tentar um PATCH que sempre falha.
    expect(atualizados).toEqual([{ tabela: 'appointments', valores: { google_event_id: null } }])
  })

  it('não chama o Google quando a consulta cancelada nunca teve evento', async () => {
    const { fetchImpl, chamadas } = fetchComToken(() => new Response(null, { status: 204 }))
    const { cliente } = criarSupabaseFalso({
      consulta: { ...consultaBase, status: 'cancelado', google_event_id: null },
    })

    const resultado = await sincronizarConsultaNoGoogle(
      cliente,
      'a1',
      criarGoogleCalendarClient(config, fetchImpl),
    )

    expect(resultado).toEqual({ ok: true, situacao: 'sem evento' })
    expect(chamadas).toEqual([])
  })
})

describe('sincronizarConsultaNoGoogle — falha', () => {
  it('devolve erro em vez de lançar quando o Google está fora do ar', async () => {
    const { fetchImpl } = fetchComToken(() => new Response('indisponível', { status: 503 }))
    const { cliente, atualizados } = criarSupabaseFalso()

    const resultado = await sincronizarConsultaNoGoogle(
      cliente,
      'a1',
      criarGoogleCalendarClient(config, fetchImpl),
    )

    expect(resultado.ok).toBe(false)
    expect(atualizados).toEqual([])
    // Falha de verdade avisa — a Dra. precisa saber que o celular dela está
    // desatualizado.
    expect(avisos).toHaveBeenCalled()
  })

  it('não lança nem quando a rede cai', async () => {
    const { fetchImpl } = criarFetch(() => {
      throw new TypeError('fetch failed')
    })
    const { cliente } = criarSupabaseFalso()

    await expect(
      sincronizarConsultaNoGoogle(cliente, 'a1', criarGoogleCalendarClient(config, fetchImpl)),
    ).resolves.toMatchObject({ ok: false })
  })

  it('não lança quando a consulta não é legível', async () => {
    const { fetchImpl } = fetchComToken(() => new Response(null, { status: 204 }))
    const { cliente } = criarSupabaseFalso({ erroNaLeitura: true })

    const resultado = await sincronizarConsultaNoGoogle(
      cliente,
      'a1',
      criarGoogleCalendarClient(config, fetchImpl),
    )
    expect(resultado.ok).toBe(false)
  })

  it('não deixa a chave privada chegar ao log', async () => {
    const { fetchImpl } = criarFetch(() => new Response(privateKey, { status: 400 }))
    const { cliente } = criarSupabaseFalso()

    const resultado = await sincronizarConsultaNoGoogle(
      cliente,
      'a1',
      criarGoogleCalendarClient(config, fetchImpl),
    )

    expect(resultado.ok).toBe(false)
    const texto = JSON.stringify([resultado, avisos.mock.calls])
    expect(texto).not.toContain('BEGIN PRIVATE KEY')
  })
})

// ---------------------------------------------------------------------------
// O requisito inegociável: agendar sobrevive ao Google
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/auth/session', () => ({
  requireSessao: async () => ({ userId: 'u1', nome: 'Izadora', role: 'dra' }),
}))
vi.mock('@/lib/lembretes', () => ({
  planejarLembretesDaConsulta: async () => ({ ok: true, criados: 0 }),
}))

const supabaseDaAcao = criarSupabaseFalso()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => supabaseDaAcao.cliente,
}))

describe('agendarConsulta com o Google quebrado', () => {
  beforeEach(() => {
    Object.assign(process.env, ENV_BASE, ENV_DO_GOOGLE)
  })

  it('grava a consulta e devolve sucesso mesmo com o Google recusando', async () => {
    // `fetch` global: é por ele que o adaptador sai quando ninguém injeta nada,
    // que é exatamente o caminho de produção.
    const { fetchImpl, chamadas } = criarFetch(() => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', fetchImpl)

    const { agendarConsulta } = await import('@/app/(app)/agenda/acoes')

    const resultado = await agendarConsulta({
      pacienteId: '11111111-1111-4111-8111-111111111111',
      procedimentoId: '22222222-2222-4222-8222-222222222222',
      // 14:00 em São Paulo, dentro do horário de atendimento.
      inicio: '2026-08-20T17:00:00.000Z',
    })

    expect(resultado).toEqual({ ok: true, id: 'a1' })
    // A consulta foi de fato gravada — não é um "ok" de fachada.
    expect(supabaseDaAcao.inseridos.some((linha) => linha.tabela === 'appointments')).toBe(true)
    // E o Google chegou a ser tentado: o teste não passa por não ter sincronia.
    expect(chamadas.length).toBeGreaterThan(0)
    // `google_event_id` fica nulo: nada foi gravado sobre o evento.
    expect(
      supabaseDaAcao.atualizados.some(
        (linha) => (linha.valores as Record<string, unknown>).google_event_id !== undefined,
      ),
    ).toBe(false)

    vi.unstubAllGlobals()
  })
})
