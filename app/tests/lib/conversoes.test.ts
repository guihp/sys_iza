// @vitest-environment node
/**
 * A ponte entre o funil e a fila de conversões da Meta.
 *
 * Duas coisas são testadas aqui, e nenhuma delas é "o evento certo sai" — isso é
 * do domínio, em `tests/domain/plan-conversions.test.ts`, sem banco:
 *
 *   1. **O vínculo telefone → paciente**, nos dois sentidos que acontecem de
 *      verdade, com os DOIS lados normalizados. `lead_attribution.telefone` é
 *      escrito pelo n8n e `patients.telefone` pelo cadastro; comparar string crua
 *      perderia a paciente por um nono dígito.
 *
 *   2. **Que nada aqui lança.** O contrato do módulo é o mesmo de
 *      `lib/google-agenda.ts`: estas funções rodam DEPOIS de a operação clínica
 *      estar gravada, então uma exceção escapando daqui viraria "não foi possível
 *      agendar" para uma consulta que está na agenda. A prova de ponta a ponta —
 *      a Server Action inteira sobrevivendo — está em
 *      `tests/marketing/enfileiramento.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enfileirarConversoes, vincularAtribuicaoAoPaciente } from '@/lib/conversoes'
import type { ConfigMeta } from '@/integrations/meta/capi'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

const PACIENTE = '11111111-1111-4111-8111-111111111111'

const CONFIG: ConfigMeta = { datasetId: '1234567890', token: 'EAAB-secreto' }

type LinhaDeAtribuicao = { id: string; telefone: string; patient_id: string | null }

/**
 * Client `service_role` de mentira, só com o que `vincularAtribuicaoAoPaciente`
 * usa: `select().like()` awaitado e `update().in().is().select()` awaitado.
 */
function criarAdminFalso(
  linhas: LinhaDeAtribuicao[],
  opcoes: { erroNaBusca?: boolean; erroAoLigar?: boolean; explodir?: boolean } = {},
) {
  const ligados: Array<{ ids: unknown; valores: unknown }> = []

  function construtor() {
    let modo: 'select' | 'update' = 'select'
    let valores: unknown = null
    let ids: unknown = null

    const alvo = {
      select: () => alvo,
      update(novos: unknown) {
        modo = 'update'
        valores = novos
        return alvo
      },
      in(_coluna: string, lista: unknown) {
        ids = lista
        return alvo
      },
      is: () => alvo,
      like(_coluna: string, padrao: string) {
        if (opcoes.explodir) throw new TypeError('fetch failed')
        // O `%12345678` do módulo vira comparação de sufixo aqui, que é o que o
        // Postgres faria.
        const sufixo = padrao.replace('%', '')
        filtradas = linhas.filter((linha) => linha.telefone.endsWith(sufixo))
        return alvo
      },
      then(resolver: (valor: { data: unknown; error: unknown }) => unknown) {
        if (modo === 'update') {
          if (opcoes.erroAoLigar) {
            return Promise.resolve({ data: null, error: { message: 'sem permissão' } }).then(
              resolver,
            )
          }
          ligados.push({ ids, valores })
          return Promise.resolve({
            data: (ids as string[]).map((id) => ({ id })),
            error: null,
          }).then(resolver)
        }
        if (opcoes.erroNaBusca) {
          return Promise.resolve({ data: null, error: { message: 'fora do ar' } }).then(resolver)
        }
        return Promise.resolve({ data: filtradas, error: null }).then(resolver)
      },
    }
    let filtradas: LinhaDeAtribuicao[] = linhas
    return alvo
  }

  return { cliente: { from: () => construtor() } as never, ligados }
}

type OpcoesDoSupabase = {
  paciente?: { telefone: string | null; consentimento_lgpd_em: string | null } | null
  ctwaClid?: string | null
  erroAoGravar?: boolean
  explodirAoGravar?: boolean
}

/** Client de sessão de mentira: lê a paciente e a atribuição, grava a fila. */
function criarSupabaseFalso(opcoes: OpcoesDoSupabase = {}) {
  const paciente =
    opcoes.paciente === undefined
      ? { telefone: '+5511987654321', consentimento_lgpd_em: '2026-08-01T12:00:00.000Z' }
      : opcoes.paciente
  const gravados: Array<{ linhas: unknown; opcoes: unknown }> = []

  function construtor(tabela: string) {
    const alvo = {
      select: () => alvo,
      eq: () => alvo,
      order: () => alvo,
      limit: () => alvo,
      upsert(linhas: unknown, config: unknown) {
        if (opcoes.explodirAoGravar) throw new TypeError('fetch failed')
        gravados.push({ linhas, opcoes: config })
        return alvo
      },
      async single() {
        if (tabela === 'patients') {
          if (!paciente) return { data: null, error: { message: 'não encontrada' } }
          return { data: paciente, error: null }
        }
        return { data: null, error: null }
      },
      then(resolver: (valor: { data: unknown; error: unknown }) => unknown) {
        if (tabela === 'lead_attribution') {
          const clid = opcoes.ctwaClid === undefined ? 'clid-do-anuncio' : opcoes.ctwaClid
          return Promise.resolve({
            data: clid ? [{ ctwa_clid: clid }] : [],
            error: null,
          }).then(resolver)
        }
        if (tabela === 'meta_conversion_jobs') {
          if (opcoes.erroAoGravar) {
            return Promise.resolve({ data: null, error: { message: 'RLS negou' } }).then(resolver)
          }
          const ultimos = gravados[gravados.length - 1]?.linhas as unknown[]
          return Promise.resolve({
            data: ultimos.map(() => ({ id: 'j1' })),
            error: null,
          }).then(resolver)
        }
        return Promise.resolve({ data: [], error: null }).then(resolver)
      },
    }
    return alvo
  }

  return { cliente: { from: (tabela: string) => construtor(tabela) } as never, gravados }
}

let avisos: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// vincularAtribuicaoAoPaciente
// ---------------------------------------------------------------------------

describe('vincularAtribuicaoAoPaciente — o sentido "mensagem antes do cadastro"', () => {
  it('liga a linha órfã que o n8n gravou pelo telefone', async () => {
    const { cliente, ligados } = criarAdminFalso([
      { id: 'la1', telefone: '+5511987654321', patient_id: null },
    ])

    const resultado = await vincularAtribuicaoAoPaciente(PACIENTE, '(11) 98765-4321', cliente)

    expect(resultado).toEqual({ ok: true, vinculadas: 1 })
    expect(ligados).toEqual([{ ids: ['la1'], valores: { patient_id: PACIENTE } }])
  })

  it('casa os dois lados NORMALIZADOS, não a string crua', async () => {
    // O n8n gravou a forma canônica; o cadastro tem o número SEM o código de
    // país — que passa no check `^\+[1-9]\d{7,14}$` de `patients` sem problema e
    // é o que sobra de importação antiga. `=` de string aqui perderia a
    // paciente, e o anúncio ficaria para sempre sem o desfecho que ele gerou.
    const { cliente, ligados } = criarAdminFalso([
      { id: 'la1', telefone: '+5511987654321', patient_id: null },
    ])

    const resultado = await vincularAtribuicaoAoPaciente(PACIENTE, '+11987654321', cliente)

    expect(resultado).toEqual({ ok: true, vinculadas: 1 })
    expect(ligados[0].ids).toEqual(['la1'])
  })

  it('ignora o vizinho de sufixo que não é a mesma pessoa', async () => {
    // O `like '%12345678'` traz candidatos; quem desempata é a normalização.
    const { cliente, ligados } = criarAdminFalso([
      { id: 'outra', telefone: '+5521987654321', patient_id: null },
    ])

    const resultado = await vincularAtribuicaoAoPaciente(PACIENTE, '+5511987654321', cliente)

    expect(resultado).toEqual({ ok: true, vinculadas: 0 })
    expect(ligados).toEqual([])
  })

  it('não rouba a atribuição de quem já está ligada', async () => {
    const { cliente, ligados } = criarAdminFalso([
      { id: 'la1', telefone: '+5511987654321', patient_id: 'outra-paciente' },
    ])

    const resultado = await vincularAtribuicaoAoPaciente(PACIENTE, '+5511987654321', cliente)

    expect(resultado).toEqual({ ok: true, vinculadas: 0 })
    expect(ligados).toEqual([])
  })

  it('não faz nada quando o lead não tem telefone', async () => {
    const { cliente, ligados } = criarAdminFalso([
      { id: 'la1', telefone: '+5511987654321', patient_id: null },
    ])

    expect(await vincularAtribuicaoAoPaciente(PACIENTE, null, cliente)).toEqual({
      ok: true,
      vinculadas: 0,
    })
    expect(ligados).toEqual([])
    expect(avisos).not.toHaveBeenCalled()
  })
})

describe('vincularAtribuicaoAoPaciente — falha', () => {
  it('devolve erro em vez de lançar quando a busca falha', async () => {
    const { cliente } = criarAdminFalso([], { erroNaBusca: true })
    await expect(
      vincularAtribuicaoAoPaciente(PACIENTE, '+5511987654321', cliente),
    ).resolves.toMatchObject({ ok: false })
  })

  it('devolve erro em vez de lançar quando o update é negado', async () => {
    const { cliente } = criarAdminFalso([{ id: 'la1', telefone: '+5511987654321', patient_id: null }], {
      erroAoLigar: true,
    })
    await expect(
      vincularAtribuicaoAoPaciente(PACIENTE, '+5511987654321', cliente),
    ).resolves.toMatchObject({ ok: false })
  })

  it('não lança nem quando a rede cai no meio', async () => {
    const { cliente } = criarAdminFalso([], { explodir: true })
    await expect(
      vincularAtribuicaoAoPaciente(PACIENTE, '+5511987654321', cliente),
    ).resolves.toMatchObject({ ok: false })
  })

  it('sai calado quando não há client admin — sem chave de serviço não é erro', async () => {
    expect(await vincularAtribuicaoAoPaciente(PACIENTE, '+5511987654321', null)).toEqual({
      ok: true,
      vinculadas: 0,
    })
    expect(avisos).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// enfileirarConversoes — os silêncios que não são erro
// ---------------------------------------------------------------------------

describe('enfileirarConversoes — integração desligada', () => {
  it('não enfileira nada, não avisa e não é falha', async () => {
    const { cliente, gravados } = criarSupabaseFalso()

    const resultado = await enfileirarConversoes(
      cliente,
      { patientId: PACIENTE, estagioAnterior: 'contato', estagioNovo: 'agendado' },
      { admin: null, config: null },
    )

    expect(resultado).toEqual({ ok: true, situacao: 'desligada', criados: 0 })
    expect(gravados).toEqual([])
    expect(avisos).not.toHaveBeenCalled()
  })
})

describe('enfileirarConversoes — as duas travas da LGPD', () => {
  it('sem consentimento_lgpd_em nada é enfileirado, e isso não é erro', async () => {
    const { cliente, gravados } = criarSupabaseFalso({
      paciente: { telefone: '+5511987654321', consentimento_lgpd_em: null },
    })

    const resultado = await enfileirarConversoes(
      cliente,
      { patientId: PACIENTE, estagioAnterior: 'contato', estagioNovo: 'agendado' },
      { admin: null, config: CONFIG },
    )

    expect(resultado).toEqual({ ok: true, situacao: 'sem evento', criados: 0 })
    expect(gravados).toEqual([])
    expect(avisos).not.toHaveBeenCalled()
  })

  it('sem ctwa_clid nada é enfileirado, e isso não é erro', async () => {
    const { cliente, gravados } = criarSupabaseFalso({ ctwaClid: null })

    const resultado = await enfileirarConversoes(
      cliente,
      { patientId: PACIENTE, estagioAnterior: 'contato', estagioNovo: 'agendado' },
      { admin: null, config: CONFIG },
    )

    expect(resultado).toEqual({ ok: true, situacao: 'sem evento', criados: 0 })
    expect(gravados).toEqual([])
    expect(avisos).not.toHaveBeenCalled()
  })

  it('retrocesso no funil não gera evento', async () => {
    const { cliente, gravados } = criarSupabaseFalso()

    const resultado = await enfileirarConversoes(
      cliente,
      { patientId: PACIENTE, estagioAnterior: 'agendado', estagioNovo: 'contato' },
      { admin: null, config: CONFIG },
    )

    expect(resultado).toEqual({ ok: true, situacao: 'sem evento', criados: 0 })
    expect(gravados).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// enfileirarConversoes — o caminho feliz
// ---------------------------------------------------------------------------

describe('enfileirarConversoes — grava a fila', () => {
  it('enfileira a escada inteira quando o cartão pula degraus', async () => {
    const { cliente, gravados } = criarSupabaseFalso()

    const resultado = await enfileirarConversoes(
      cliente,
      {
        patientId: PACIENTE,
        estagioAnterior: 'lead',
        estagioNovo: 'agendado',
        ocorridoEm: new Date('2026-08-06T15:00:00.000Z'),
      },
      { admin: null, config: CONFIG },
    )

    expect(resultado).toEqual({ ok: true, situacao: 'enfileirado', criados: 2 })

    const linhas = gravados[0].linhas as Array<Record<string, unknown>>
    expect(linhas.map((l) => l.evento)).toEqual(['Contact', 'Schedule'])
    expect(linhas[1].chave_idempotencia).toBe(`${PACIENTE}:Schedule`)
    expect(linhas[1].ocorrido_em).toBe('2026-08-06T15:00:00.000Z')
  })

  it('grava com on-conflict-do-nothing: enfileirar duas vezes é inofensivo', async () => {
    const { cliente, gravados } = criarSupabaseFalso()

    await enfileirarConversoes(
      cliente,
      { patientId: PACIENTE, estagioAnterior: 'contato', estagioNovo: 'agendado' },
      { admin: null, config: CONFIG },
    )

    // É a `chave_idempotencia` única do banco que transforma a repetição em
    // no-op, não uma checagem na aplicação — entre ler e gravar cabe outra
    // requisição, e o kanban é arrastável duas vezes.
    expect(gravados[0].opcoes).toEqual({
      onConflict: 'chave_idempotencia',
      ignoreDuplicates: true,
    })
  })

  it('não deixa nada de prontuário atravessar para o payload', async () => {
    const { cliente, gravados } = criarSupabaseFalso()

    await enfileirarConversoes(
      cliente,
      {
        patientId: PACIENTE,
        estagioAnterior: 'compareceu',
        estagioNovo: 'paciente',
        valorCentavos: 184_700,
      },
      { admin: null, config: CONFIG },
    )

    const linhas = gravados[0].linhas as Array<Record<string, unknown>>
    const payload = linhas[0].payload as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      'ctwaClid',
      'eventId',
      'evento',
      'moeda',
      'ocorridoEm',
      'telefoneHash',
      'valor',
    ])
    // R$ 1.847,00 sai como R$ 1.800,00: é o valor exato que apontaria para uma
    // linha do catálogo e, com ela, para o procedimento.
    expect(payload.valor).toBe(1800)
    expect(JSON.stringify(payload)).not.toContain('+5511987654321')
  })
})

// ---------------------------------------------------------------------------
// enfileirarConversoes — falha
// ---------------------------------------------------------------------------

describe('enfileirarConversoes — falha', () => {
  it('devolve erro em vez de lançar quando o banco recusa a gravação', async () => {
    const { cliente } = criarSupabaseFalso({ erroAoGravar: true })

    const resultado = await enfileirarConversoes(
      cliente,
      { patientId: PACIENTE, estagioAnterior: 'contato', estagioNovo: 'agendado' },
      { admin: null, config: CONFIG },
    )

    expect(resultado.ok).toBe(false)
    expect(avisos).toHaveBeenCalled()
  })

  it('não lança nem quando a gravação explode no meio', async () => {
    const { cliente } = criarSupabaseFalso({ explodirAoGravar: true })

    await expect(
      enfileirarConversoes(
        cliente,
        { patientId: PACIENTE, estagioAnterior: 'contato', estagioNovo: 'agendado' },
        { admin: null, config: CONFIG },
      ),
    ).resolves.toMatchObject({ ok: false })
  })

  it('não lança quando a paciente não é legível', async () => {
    const { cliente } = criarSupabaseFalso({ paciente: null })

    await expect(
      enfileirarConversoes(
        cliente,
        { patientId: PACIENTE, estagioAnterior: 'contato', estagioNovo: 'agendado' },
        { admin: null, config: CONFIG },
      ),
    ).resolves.toMatchObject({ ok: false })
  })
})
