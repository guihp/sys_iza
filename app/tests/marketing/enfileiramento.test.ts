// @vitest-environment node
/**
 * O enfileiramento de conversões como EFEITO COLATERAL da operação clínica.
 *
 * A regra que estes testes existem para travar é uma só, e é a razão de ser
 * desta camada:
 *
 *   **falha ao enfileirar NUNCA derruba a operação clínica.**
 *
 * O cartão anda, a consulta é marcada, o atendimento é registrado. O evento para
 * a Meta é o último passo de todos e o mais dispensável: se a Meta estiver fora
 * do ar, se a atribuição não existir, se a RLS negar, se a chave de serviço
 * faltar — a paciente continua atendida e a tela continua dizendo a verdade.
 *
 * O caminho contrário seria a secretária vendo "não foi possível agendar" para
 * uma consulta que ESTÁ na agenda, e remarcando por cima, por causa de um canal
 * de marketing que a clínica nem ligou ainda.
 *
 * Aqui a fila é sabotada da forma mais bruta possível: `meta_conversion_jobs`
 * LANÇA em qualquer toque, e o client `service_role` que resolve o vínculo da
 * atribuição também. As três Server Actions passam mesmo assim.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

const PACIENTE = '11111111-1111-4111-8111-111111111111'
const PROCEDIMENTO = '22222222-2222-4222-8222-222222222222'

/**
 * Ambiente com a Meta LIGADA.
 *
 * É o que torna o teste honesto: com o dataset ausente o enfileiramento sairia
 * calado pelo caminho 'desligada' e nunca chegaria a falhar — o teste passaria
 * sem provar nada.
 */
const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  EVOLUTION_URL: 'http://evolution:8080',
  EVOLUTION_API_KEY: 'chave-evolution',
  EVOLUTION_INSTANCE: 'clinica',
  RESEND_API_KEY: 're_123456789',
  EMAIL_FROM: 'contato@clinicaizadora.com.br',
  META_DATASET_ID: '1234567890',
  META_CAPI_TOKEN: 'EAAB-secreto',
}

const toques: string[] = []
const inseridos: Array<{ tabela: string; valores: unknown }> = []
const atualizados: Array<{ tabela: string; valores: unknown }> = []

function construtor(tabela: string) {
  toques.push(tabela)

  // A sabotagem: a fila de conversões não existe para este teste.
  if (tabela === 'meta_conversion_jobs') {
    throw new TypeError('fila de conversões indisponível')
  }

  let modo: 'select' | 'insert' | 'update' = 'select'
  let colunas = ''

  const alvo = {
    select(pedidas?: unknown) {
      if (modo === 'select') colunas = String(pedidas ?? '')
      return alvo
    },
    eq: () => alvo,
    gte: () => alvo,
    lt: () => alvo,
    order: () => alvo,
    limit: () => alvo,
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
      if (modo === 'insert') {
        if (tabela === 'attendance_records') {
          return { data: { id: 'r1', retorno_vencimento: null }, error: null }
        }
        return { data: { id: 'a1' }, error: null }
      }
      if (tabela === 'procedures') {
        return {
          data: {
            id: PROCEDIMENTO,
            nome: 'Toxina botulínica',
            duracao_minutos: 60,
            default_return_interval_days: null,
            preco_centavos: 184_700,
          },
          error: null,
        }
      }
      if (tabela === 'patients') {
        // As duas leituras de `patients` se distinguem pelas colunas pedidas: a
        // do estágio de antes e a do cadastro que o enfileiramento precisa.
        if (colunas.includes('consentimento_lgpd_em')) {
          return {
            data: { telefone: '+5511987654321', consentimento_lgpd_em: '2026-08-01T12:00:00.000Z' },
            error: null,
          }
        }
        return { data: { stage: 'contato' }, error: null }
      }
      return { data: null, error: null }
    },
    then(resolver: (valor: { data: unknown; error: unknown }) => unknown) {
      if (tabela === 'lead_attribution') {
        // A paciente TEM atribuição: sem `ctwa_clid` o domínio zeraria a lista e
        // a fila nunca seria tocada.
        return Promise.resolve({ data: [{ ctwa_clid: 'clid-do-anuncio' }], error: null }).then(
          resolver,
        )
      }
      if (modo === 'update') {
        return Promise.resolve({ data: [{ id: PACIENTE }], error: null }).then(resolver)
      }
      // Agenda vazia: nenhuma consulta concorrente no dia.
      return Promise.resolve({ data: [], error: null }).then(resolver)
    },
  }
  return alvo
}

const supabaseFalso = { from: (tabela: string) => construtor(tabela) }

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/auth/session', () => ({
  requireSessao: async () => ({ userId: 'u1', nome: 'Izadora', role: 'dra' }),
  getSessao: async () => ({ userId: 'u1', nome: 'Izadora', role: 'dra' }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => supabaseFalso }))
// A segunda sabotagem: sem chave de serviço utilizável, o vínculo da atribuição
// também quebra. É o cenário do dia em que a variável some do painel.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente')
  },
}))
// Fora de escopo aqui, e já cobertos nos próprios testes.
vi.mock('@/lib/lembretes', () => ({
  planejarLembretesDaConsulta: async () => ({ ok: true, criados: 0 }),
  planejarLembretesDoAtendimento: async () => ({ ok: true, criados: 0 }),
}))
vi.mock('@/lib/google-agenda', () => ({
  sincronizarConsultaNoGoogle: async () => ({ ok: true, situacao: 'desligada' }),
}))

beforeEach(() => {
  toques.length = 0
  inseridos.length = 0
  atualizados.length = 0
  Object.assign(process.env, ENV)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

/** A fila chegou a ser tentada? Sem isto o teste passaria sem provar nada. */
function tentouEnfileirar(): boolean {
  return toques.includes('meta_conversion_jobs')
}

// ---------------------------------------------------------------------------
// moverEstagio — o kanban
// ---------------------------------------------------------------------------

describe('moverEstagio com a fila de conversões quebrada', () => {
  it('move o cartão e não lança', async () => {
    const { moverEstagio } = await import('@/app/(app)/crm/acoes')

    await expect(moverEstagio(PACIENTE, 'agendado')).resolves.toBeUndefined()

    // O estágio foi de fato gravado — não é um "ok" de fachada.
    expect(atualizados).toContainEqual({ tabela: 'patients', valores: { stage: 'agendado' } })
    expect(tentouEnfileirar()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// agendarConsulta — a agenda
// ---------------------------------------------------------------------------

describe('agendarConsulta com a fila de conversões quebrada', () => {
  it('grava a consulta e devolve sucesso', async () => {
    const { agendarConsulta } = await import('@/app/(app)/agenda/acoes')

    const resultado = await agendarConsulta({
      pacienteId: PACIENTE,
      procedimentoId: PROCEDIMENTO,
      // 14:00 em São Paulo, dentro do horário de atendimento.
      inicio: '2026-08-20T17:00:00.000Z',
    })

    expect(resultado).toEqual({ ok: true, id: 'a1' })
    expect(inseridos.some((linha) => linha.tabela === 'appointments')).toBe(true)
    expect(atualizados).toContainEqual({ tabela: 'patients', valores: { stage: 'agendado' } })
    expect(tentouEnfileirar()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// registrarAtendimento — o prontuário
// ---------------------------------------------------------------------------

describe('registrarAtendimento com a fila de conversões quebrada', () => {
  it('grava o prontuário e devolve sucesso', async () => {
    const { registrarAtendimento } = await import('@/app/(app)/pacientes/[id]/acoes')

    const resultado = await registrarAtendimento({
      pacienteId: PACIENTE,
      procedimentoId: PROCEDIMENTO,
    })

    expect(resultado).toMatchObject({ ok: true, id: 'r1' })
    expect(inseridos.some((linha) => linha.tabela === 'attendance_records')).toBe(true)
    expect(atualizados).toContainEqual({ tabela: 'patients', valores: { stage: 'paciente' } })
    expect(tentouEnfileirar()).toBe(true)
  })
})
