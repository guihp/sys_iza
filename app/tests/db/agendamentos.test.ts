import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.SUPABASE_ANON_KEY!

const SENHA = 'senha-de-teste-123'

let admin: SupabaseClient
let comoSecretaria: SupabaseClient
let comoDra: SupabaseClient
let idSecretaria: string
let idDra: string
let idPaciente: string
let idProcedimento: string
/** Marca única desta execução, para não colidir com outras rodadas. */
const marca = `age-${Date.now()}`

/**
 * Toda consulta deste arquivo cai num dia distante e único da execução, para
 * que a constraint de sobreposição não esbarre em dado de outra rodada nem em
 * agenda real da clínica.
 */
const DIA_BASE = new Date('2099-03-02T00:00:00Z')
let deslocamentoEmDias = 0
function diaLivre() {
  deslocamentoEmDias += 1
  return new Date(DIA_BASE.getTime() + deslocamentoEmDias * 86_400_000)
}

/** `as(dia, 14)` → 14:00 (UTC) daquele dia. */
function as(dia: Date, hora: number, minuto = 0) {
  const instante = new Date(dia)
  instante.setUTCHours(hora, minuto, 0, 0)
  return instante.toISOString()
}

async function criarUsuario(email: string, role: 'dra' | 'secretaria') {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
  })
  if (error) throw error
  const id = data.user!.id
  const { error: erroPerfil } = await admin.from('profiles').insert({ id, nome: email, role })
  if (erroPerfil) throw erroPerfil
  const sessao = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: erroLogin } = await sessao.auth.signInWithPassword({ email, password: SENHA })
  if (erroLogin) throw erroLogin
  return { sessao, id }
}

beforeAll(async () => {
  admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

  const sec = await criarUsuario(`sec-${marca}@teste.local`, 'secretaria')
  comoSecretaria = sec.sessao
  idSecretaria = sec.id
  const dra = await criarUsuario(`dra-${marca}@teste.local`, 'dra')
  comoDra = dra.sessao
  idDra = dra.id

  const { data: paciente, error: erroPaciente } = await admin
    .from('patients')
    .insert({ nome_completo: `Agenda Teste ${marca}` })
    .select('id')
    .single()
  if (erroPaciente) throw erroPaciente
  idPaciente = paciente!.id

  const { data: procedimento, error: erroProcedimento } = await admin
    .from('procedures')
    .insert({
      nome: `Procedimento ${marca}`,
      duracao_minutos: 60,
      preco_centavos: 10000,
    })
    .select('id')
    .single()
  if (erroProcedimento) throw erroProcedimento
  idProcedimento = procedimento!.id
})

afterAll(async () => {
  // Só o que este teste criou. audit_log é append-only e não se limpa.
  await admin.from('appointments').delete().eq('patient_id', idPaciente)
  await admin.from('patients').delete().like('nome_completo', `%${marca}%`)
  await admin.from('procedures').delete().like('nome', `%${marca}%`)
  for (const id of [idSecretaria, idDra]) {
    if (id) await admin.auth.admin.deleteUser(id)
  }
})

/** Insere um agendamento pelo client informado, devolvendo `{ data, error }`. */
function agendar(
  client: SupabaseClient,
  inicio: string,
  fim: string,
  extra: Record<string, unknown> = {},
) {
  return client
    .from('appointments')
    .insert({
      patient_id: idPaciente,
      procedure_id: idProcedimento,
      inicio,
      fim,
      ...extra,
    })
    .select('id, status, criado_em, atualizado_em')
    .single()
}

describe('appointments — agendamento', () => {
  it('secretária marca consulta', async () => {
    const dia = diaLivre()
    const { error } = await agendar(comoSecretaria, as(dia, 14), as(dia, 15))
    expect(error).toBeNull()
  })

  it('consulta nova nasce com status agendado', async () => {
    const dia = diaLivre()
    const { data, error } = await agendar(comoSecretaria, as(dia, 14), as(dia, 15))
    expect(error).toBeNull()
    expect(data!.status).toBe('agendado')
  })

  it('status fora do enum é rejeitado', async () => {
    const dia = diaLivre()
    const { error } = await agendar(admin, as(dia, 14), as(dia, 15), { status: 'remarcado' })
    expect(error).not.toBeNull()
  })

  it('paciente inexistente é rejeitado pela chave estrangeira', async () => {
    const dia = diaLivre()
    const { error } = await admin.from('appointments').insert({
      patient_id: '00000000-0000-0000-0000-000000000000',
      procedure_id: idProcedimento,
      inicio: as(dia, 14),
      fim: as(dia, 15),
    })
    expect(error).not.toBeNull()
  })
})

describe('appointments — constraints', () => {
  it('fim antes do início é rejeitado', async () => {
    const dia = diaLivre()
    const { error } = await agendar(admin, as(dia, 15), as(dia, 14))
    expect(error).not.toBeNull()
  })

  it('fim igual ao início é rejeitado', async () => {
    const dia = diaLivre()
    const { error } = await agendar(admin, as(dia, 14), as(dia, 14))
    expect(error).not.toBeNull()
  })

  it('sobreposição é barrada pelo banco, não só pela aplicação', async () => {
    // A checagem em src/domain/scheduling/conflict.ts é "ler, decidir, gravar" e
    // tem janela de corrida. Quem fecha a janela é a constraint de exclusão.
    const dia = diaLivre()
    const { error: primeiro } = await agendar(admin, as(dia, 14), as(dia, 15))
    expect(primeiro).toBeNull()

    const { error: segundo } = await agendar(admin, as(dia, 14, 30), as(dia, 15, 30))
    expect(segundo).not.toBeNull()
    expect(segundo!.code).toBe('23P01') // exclusion_violation
  })

  it('encostar no fim não é sobreposição', async () => {
    // Intervalo semiaberto [inicio, fim), igual ao de conflict.ts: a consulta
    // das 15:00 começa no instante em que a das 14:00 termina.
    const dia = diaLivre()
    const { error: primeiro } = await agendar(admin, as(dia, 14), as(dia, 15))
    const { error: segundo } = await agendar(admin, as(dia, 15), as(dia, 16))
    expect(primeiro).toBeNull()
    expect(segundo).toBeNull()
  })

  it('consulta cancelada libera o horário', async () => {
    const dia = diaLivre()
    const { data } = await agendar(admin, as(dia, 14), as(dia, 15))
    await admin.from('appointments').update({ status: 'cancelado' }).eq('id', data!.id)

    const { error } = await agendar(admin, as(dia, 14), as(dia, 15))
    expect(error).toBeNull()
  })

  it('cancelada não impede nem outra cancelada no mesmo horário', async () => {
    const dia = diaLivre()
    const { error: primeiro } = await agendar(admin, as(dia, 14), as(dia, 15), {
      status: 'cancelado',
    })
    const { error: segundo } = await agendar(admin, as(dia, 14), as(dia, 15), {
      status: 'cancelado',
    })
    expect(primeiro).toBeNull()
    expect(segundo).toBeNull()
  })

  it('apagar o paciente leva a agenda dele junto', async () => {
    const { data: paciente } = await admin
      .from('patients')
      .insert({ nome_completo: `Cascata ${marca}` })
      .select('id')
      .single()

    const dia = diaLivre()
    const { data: consulta } = await admin
      .from('appointments')
      .insert({
        patient_id: paciente!.id,
        procedure_id: idProcedimento,
        inicio: as(dia, 14),
        fim: as(dia, 15),
      })
      .select('id')
      .single()

    await admin.from('patients').delete().eq('id', paciente!.id)

    const { data: sobrou } = await admin.from('appointments').select('id').eq('id', consulta!.id)
    expect(sobrou ?? []).toHaveLength(0)
  })

  it('procedimento com agenda não pode ser apagado', async () => {
    // Tirar do catálogo é `ativo = false`, não DELETE. A FK sem cascade é o que
    // transforma a perda silenciosa de histórico em erro explícito.
    const dia = diaLivre()
    await agendar(admin, as(dia, 14), as(dia, 15))

    const { error } = await admin.from('procedures').delete().eq('id', idProcedimento)
    expect(error).not.toBeNull()
  })
})

describe('appointments — RLS', () => {
  it('secretária remarca consulta', async () => {
    const dia = diaLivre()
    const { data } = await agendar(comoSecretaria, as(dia, 14), as(dia, 15))

    const outroDia = diaLivre()
    const { error } = await comoSecretaria
      .from('appointments')
      .update({ inicio: as(outroDia, 16), fim: as(outroDia, 17) })
      .eq('id', data!.id)
    expect(error).toBeNull()

    const { data: depois } = await admin
      .from('appointments')
      .select('inicio')
      .eq('id', data!.id)
      .single()
    expect(new Date(depois!.inicio).toISOString()).toBe(as(outroDia, 16))
  })

  it('secretária cancela consulta', async () => {
    const dia = diaLivre()
    const { data } = await agendar(comoSecretaria, as(dia, 14), as(dia, 15))

    const { error } = await comoSecretaria
      .from('appointments')
      .update({ status: 'cancelado' })
      .eq('id', data!.id)
    expect(error).toBeNull()
  })

  it('atualizado_em avança sozinho a cada update', async () => {
    const dia = diaLivre()
    const { data } = await agendar(comoSecretaria, as(dia, 14), as(dia, 15))

    await comoSecretaria.from('appointments').update({ status: 'confirmado' }).eq('id', data!.id)

    const { data: depois } = await admin
      .from('appointments')
      .select('atualizado_em')
      .eq('id', data!.id)
      .single()
    // O caller não mandou atualizado_em: quem carimba é o trigger.
    expect(new Date(depois!.atualizado_em).getTime()).toBeGreaterThan(
      new Date(data!.atualizado_em).getTime(),
    )
  })

  it('secretária não apaga agendamento', async () => {
    const dia = diaLivre()
    const { data } = await agendar(comoSecretaria, as(dia, 14), as(dia, 15))

    // A RLS pode devolver erro ou simplesmente não afetar linha alguma; as duas
    // formas são aceitáveis — o que não pode é a consulta sumir do histórico.
    await comoSecretaria.from('appointments').delete().eq('id', data!.id)

    const { data: sobrou } = await admin.from('appointments').select('id').eq('id', data!.id)
    expect(sobrou ?? []).toHaveLength(1)
  })

  it('dra apaga agendamento', async () => {
    const dia = diaLivre()
    const { data } = await agendar(comoDra, as(dia, 14), as(dia, 15))

    const { error } = await comoDra.from('appointments').delete().eq('id', data!.id)
    expect(error).toBeNull()

    const { data: sobrou } = await admin.from('appointments').select('id').eq('id', data!.id)
    expect(sobrou ?? []).toHaveLength(0)
  })

  it('anônimo não enxerga a agenda', async () => {
    const dia = diaLivre()
    await agendar(admin, as(dia, 14), as(dia, 15))

    const anonimo = createClient(URL, ANON, { auth: { persistSession: false } })
    const { data } = await anonimo.from('appointments').select('id').eq('patient_id', idPaciente)
    expect(data ?? []).toHaveLength(0)
  })

  it('anônimo não marca consulta', async () => {
    const dia = diaLivre()
    const anonimo = createClient(URL, ANON, { auth: { persistSession: false } })
    const { error } = await anonimo.from('appointments').insert({
      patient_id: idPaciente,
      procedure_id: idProcedimento,
      inicio: as(dia, 14),
      fim: as(dia, 15),
    })
    expect(error).not.toBeNull()
  })
})
