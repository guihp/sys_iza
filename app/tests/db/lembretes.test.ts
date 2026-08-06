import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.SUPABASE_ANON_KEY!

const SENHA = 'senha-de-teste-123'

let admin: SupabaseClient
let anonimo: SupabaseClient
let comoSecretaria: SupabaseClient
let comoDra: SupabaseClient
let idSecretaria: string
let idDra: string
let idPaciente: string
let idProcedimento: string
let idConsulta: string
let idAtendimento: string
/** Marca única desta execução, para não colidir com outras rodadas. */
const marca = `lem-${Date.now()}`

/** Cada chave de idempotência deste arquivo é única, como em produção. */
let sequencia = 0
function chave(sufixo: string) {
  sequencia += 1
  return `${marca}-${sequencia}:${sufixo}`
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
  anonimo = createClient(URL, ANON, { auth: { persistSession: false } })

  const sec = await criarUsuario(`sec-${marca}@teste.local`, 'secretaria')
  comoSecretaria = sec.sessao
  idSecretaria = sec.id
  const dra = await criarUsuario(`dra-${marca}@teste.local`, 'dra')
  comoDra = dra.sessao
  idDra = dra.id

  const { data: paciente, error: erroPaciente } = await admin
    .from('patients')
    .insert({ nome_completo: `Lembrete Teste ${marca}` })
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
      default_return_interval_days: 120,
    })
    .select('id')
    .single()
  if (erroProcedimento) throw erroProcedimento
  idProcedimento = procedimento!.id

  // Dia distante e único da execução, para não esbarrar na constraint de
  // sobreposição de `appointments` nem na agenda real da clínica.
  const inicio = new Date(`2099-07-01T14:00:00Z`)
  inicio.setUTCDate(inicio.getUTCDate() + (Date.now() % 300))
  const { data: consulta, error: erroConsulta } = await admin
    .from('appointments')
    .insert({
      patient_id: idPaciente,
      procedure_id: idProcedimento,
      inicio: inicio.toISOString(),
      fim: new Date(inicio.getTime() + 3_600_000).toISOString(),
    })
    .select('id')
    .single()
  if (erroConsulta) throw erroConsulta
  idConsulta = consulta!.id

  const { data: atendimento, error: erroAtendimento } = await admin
    .from('attendance_records')
    .insert({ patient_id: idPaciente, procedure_id: idProcedimento, registrado_por: idDra })
    .select('id')
    .single()
  if (erroAtendimento) throw erroAtendimento
  idAtendimento = atendimento!.id
})

afterAll(async () => {
  // Os jobs somem por cascade ao apagar consulta, atendimento e paciente, mas o
  // delete explícito vem antes para o caso de a cascade não estar onde se pensa.
  await admin.from('reminder_jobs').delete().eq('patient_id', idPaciente)
  await admin.from('attendance_records').delete().eq('patient_id', idPaciente)
  await admin.from('appointments').delete().eq('patient_id', idPaciente)
  await admin.from('patients').delete().like('nome_completo', `%${marca}%`)
  await admin.from('procedures').delete().like('nome', `%${marca}%`)
  for (const id of [idSecretaria, idDra]) {
    if (id) await admin.auth.admin.deleteUser(id)
  }
})

/** Insere um job pelo client informado, devolvendo `{ data, error }`. */
function planejar(client: SupabaseClient, extra: Record<string, unknown> = {}) {
  return client
    .from('reminder_jobs')
    .insert({
      appointment_id: idConsulta,
      patient_id: idPaciente,
      kind: 'confirmacao',
      channel: 'whatsapp',
      agendado_para: '2099-07-01T12:00:00Z',
      chave_idempotencia: chave('confirmacao:whatsapp'),
      ...extra,
    })
    .select('id, status, tentativas, enviado_em')
    .single()
}

describe('message_templates — sementes', () => {
  it('existe um texto para cada par (tipo, canal) que o planejador produz', async () => {
    const { data, error } = await admin.from('message_templates').select('kind, channel')
    expect(error).toBeNull()

    const pares = (data ?? []).map((t) => `${t.kind}:${t.channel}`)
    for (const par of [
      'confirmacao:whatsapp',
      'confirmacao:email',
      'vespera_curta:whatsapp',
      'pos_procedimento:whatsapp',
      'avaliacao:whatsapp',
      'retorno:whatsapp',
      'retorno:email',
    ]) {
      expect(pares).toContain(par)
    }
  })

  it('os textos nascem ativos e em português', async () => {
    const { data } = await admin
      .from('message_templates')
      .select('corpo, ativo')
      .eq('kind', 'confirmacao')
      .eq('channel', 'whatsapp')
      .single()
    expect(data!.ativo).toBe(true)
    expect(data!.corpo).toContain('{{nome}}')
  })

  it('template de e-mail sem assunto é rejeitado', async () => {
    const { error } = await admin
      .from('message_templates')
      .insert({ kind: 'avaliacao', channel: 'email', corpo: 'Oi' })
    expect(error).not.toBeNull()
  })

  it('template de whatsapp com assunto é rejeitado', async () => {
    const { error } = await admin
      .from('message_templates')
      .insert({ kind: 'avaliacao', channel: 'whatsapp', assunto: 'Oi', corpo: 'Oi' })
    expect(error).not.toBeNull()
  })

  it('corpo em branco é rejeitado', async () => {
    const { error } = await admin
      .from('message_templates')
      .update({ corpo: '   ' })
      .eq('kind', 'confirmacao')
      .eq('channel', 'whatsapp')
    expect(error).not.toBeNull()
  })
})

describe('message_templates — RLS', () => {
  it('anônimo não lê template', async () => {
    const { data, error } = await anonimo.from('message_templates').select('kind')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('secretária lê template', async () => {
    const { data, error } = await comoSecretaria.from('message_templates').select('kind')
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('secretária não edita template', async () => {
    // Sem policy de UPDATE que ela satisfaça: o comando volta sem erro e sem ter
    // tocado em linha alguma.
    const { data, error } = await comoSecretaria
      .from('message_templates')
      .update({ ativo: false })
      .eq('kind', 'avaliacao')
      .eq('channel', 'whatsapp')
      .select('kind')
    expect(error === null && (data ?? []).length === 0).toBe(true)
  })

  it('dra edita template', async () => {
    const { data, error } = await comoDra
      .from('message_templates')
      .update({ ativo: true })
      .eq('kind', 'avaliacao')
      .eq('channel', 'whatsapp')
      .select('kind')
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(1)
  })
})

describe('reminder_jobs — planejamento', () => {
  it('job nasce pendente, sem tentativa e sem envio', async () => {
    const { data, error } = await planejar(admin)
    expect(error).toBeNull()
    expect(data!.status).toBe('pendente')
    expect(data!.tentativas).toBe(0)
    expect(data!.enviado_em).toBeNull()
  })

  it('job de atendimento é aceito sem consulta', async () => {
    const { error } = await planejar(admin, {
      appointment_id: null,
      attendance_id: idAtendimento,
      kind: 'retorno',
      chave_idempotencia: chave('retorno:whatsapp'),
    })
    expect(error).toBeNull()
  })

  it('job sem origem nenhuma é rejeitado', async () => {
    const { error } = await planejar(admin, {
      appointment_id: null,
      chave_idempotencia: chave('sem-origem'),
    })
    expect(error).not.toBeNull()
  })

  it('job com as duas origens é rejeitado', async () => {
    const { error } = await planejar(admin, {
      attendance_id: idAtendimento,
      chave_idempotencia: chave('duas-origens'),
    })
    expect(error).not.toBeNull()
  })

  it('tentativas negativas são rejeitadas', async () => {
    const { error } = await planejar(admin, {
      tentativas: -1,
      chave_idempotencia: chave('tentativas'),
    })
    expect(error).not.toBeNull()
  })

  it('marcar como enviado sem carimbo de envio é rejeitado', async () => {
    const { data } = await planejar(admin, { chave_idempotencia: chave('carimbo') })
    const { error } = await admin
      .from('reminder_jobs')
      .update({ status: 'enviado' })
      .eq('id', data!.id)
    expect(error).not.toBeNull()
  })

  it('marcar como enviado com carimbo é aceito', async () => {
    const { data } = await planejar(admin, { chave_idempotencia: chave('carimbo-ok') })
    const { error } = await admin
      .from('reminder_jobs')
      .update({ status: 'enviado', enviado_em: new Date().toISOString() })
      .eq('id', data!.id)
    expect(error).toBeNull()
  })
})

describe('reminder_jobs — idempotência', () => {
  it('a mesma chave duas vezes é rejeitada pelo banco', async () => {
    const repetida = chave('duplicada')
    const { error: primeiro } = await planejar(admin, { chave_idempotencia: repetida })
    expect(primeiro).toBeNull()

    const { error: segundo } = await planejar(admin, { chave_idempotencia: repetida })
    expect(segundo).not.toBeNull()
    expect(segundo!.code).toBe('23505') // unique_violation
  })

  it('replanejar com on conflict do nothing não duplica nem falha', async () => {
    // É exatamente o que `planejarLembretesDaConsulta` faz, via upsert com
    // ignoreDuplicates.
    const repetida = chave('upsert')
    const linha = {
      appointment_id: idConsulta,
      patient_id: idPaciente,
      kind: 'confirmacao',
      channel: 'email',
      agendado_para: '2099-07-01T12:00:00Z',
      chave_idempotencia: repetida,
    }

    await admin
      .from('reminder_jobs')
      .upsert([linha], { onConflict: 'chave_idempotencia', ignoreDuplicates: true })
    const { error } = await admin
      .from('reminder_jobs')
      .upsert([linha], { onConflict: 'chave_idempotencia', ignoreDuplicates: true })
    expect(error).toBeNull()

    const { data } = await admin
      .from('reminder_jobs')
      .select('id')
      .eq('chave_idempotencia', repetida)
    expect((data ?? []).length).toBe(1)
  })
})

describe('reminder_jobs — cascade', () => {
  it('cancelar a consulta pelo DELETE leva os lembretes dela junto', async () => {
    const inicio = new Date('2098-07-01T14:00:00Z')
    const { data: consulta } = await admin
      .from('appointments')
      .insert({
        patient_id: idPaciente,
        procedure_id: idProcedimento,
        inicio: inicio.toISOString(),
        fim: new Date(inicio.getTime() + 3_600_000).toISOString(),
      })
      .select('id')
      .single()

    const chaveDoJob = chave('cascade')
    await admin.from('reminder_jobs').insert({
      appointment_id: consulta!.id,
      patient_id: idPaciente,
      kind: 'confirmacao',
      channel: 'whatsapp',
      agendado_para: '2098-06-30T12:00:00Z',
      chave_idempotencia: chaveDoJob,
    })

    await admin.from('appointments').delete().eq('id', consulta!.id)

    const { data } = await admin
      .from('reminder_jobs')
      .select('id')
      .eq('chave_idempotencia', chaveDoJob)
    expect((data ?? []).length).toBe(0)
  })
})

describe('reminder_jobs — RLS', () => {
  it('anônimo não lê a fila de lembretes', async () => {
    const { data, error } = await anonimo.from('reminder_jobs').select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('secretária lê a fila', async () => {
    const { data, error } = await comoSecretaria.from('reminder_jobs').select('id')
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('secretária planeja lembrete — é ela quem marca consulta', async () => {
    const { error } = await planejar(comoSecretaria, {
      chave_idempotencia: chave('pela-secretaria'),
    })
    expect(error).toBeNull()
  })

  it('secretária cancela lembrete', async () => {
    const { data } = await planejar(admin, { chave_idempotencia: chave('cancelar') })
    const { data: atualizado, error } = await comoSecretaria
      .from('reminder_jobs')
      .update({ status: 'cancelado' })
      .eq('id', data!.id)
      .select('status')
    expect(error).toBeNull()
    expect(atualizado![0].status).toBe('cancelado')
  })

  it('secretária não apaga lembrete', async () => {
    const { data } = await planejar(admin, { chave_idempotencia: chave('nao-apaga') })
    await comoSecretaria.from('reminder_jobs').delete().eq('id', data!.id)

    const { data: aindaLa } = await admin.from('reminder_jobs').select('id').eq('id', data!.id)
    expect((aindaLa ?? []).length).toBe(1)
  })

  it('dra apaga lembrete', async () => {
    const { data } = await planejar(admin, { chave_idempotencia: chave('dra-apaga') })
    await comoDra.from('reminder_jobs').delete().eq('id', data!.id)

    const { data: sumiu } = await admin.from('reminder_jobs').select('id').eq('id', data!.id)
    expect((sumiu ?? []).length).toBe(0)
  })
})
