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
const marca = `ate-${Date.now()}`

/**
 * As consultas deste arquivo caem num dia distante e único da execução, para que
 * a constraint de sobreposição de `appointments` não esbarre em dado de outra
 * rodada nem em agenda real da clínica.
 */
const DIA_BASE = new Date('2099-06-02T00:00:00Z')
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
    .insert({ nome_completo: `Atendimento Teste ${marca}` })
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
})

afterAll(async () => {
  // Ordem importa: o prontuário referencia paciente, procedimento e usuário, e
  // as duas últimas FKs são sem cascade de propósito. audit_log é append-only e
  // não se limpa.
  await admin.from('attendance_records').delete().eq('patient_id', idPaciente)
  await admin.from('appointments').delete().eq('patient_id', idPaciente)
  await admin.from('patients').delete().like('nome_completo', `%${marca}%`)
  await admin.from('procedures').delete().like('nome', `%${marca}%`)
  for (const id of [idSecretaria, idDra]) {
    if (id) await admin.auth.admin.deleteUser(id)
  }
})

/** Registra um atendimento pelo client informado, devolvendo `{ data, error }`. */
function registrar(
  client: SupabaseClient,
  registradoPor: string,
  extra: Record<string, unknown> = {},
) {
  return client
    .from('attendance_records')
    .insert({
      patient_id: idPaciente,
      procedure_id: idProcedimento,
      registrado_por: registradoPor,
      ...extra,
    })
    .select('id, realizado_em, sem_retorno, retorno_vencimento')
    .single()
}

describe('attendance_records — registro', () => {
  it('dra registra atendimento', async () => {
    const { error } = await registrar(comoDra, idDra, { retorno_vencimento: '2026-12-03' })
    expect(error).toBeNull()
  })

  it('registro nasce com realizado_em preenchido e sem_retorno falso', async () => {
    const { data, error } = await registrar(comoDra, idDra)
    expect(error).toBeNull()
    expect(data!.realizado_em).not.toBeNull()
    expect(data!.sem_retorno).toBe(false)
  })

  it('paciente inexistente é rejeitado pela chave estrangeira', async () => {
    const { error } = await admin.from('attendance_records').insert({
      patient_id: '00000000-0000-0000-0000-000000000000',
      procedure_id: idProcedimento,
      registrado_por: idDra,
    })
    expect(error).not.toBeNull()
  })

  it('atendimento sem procedimento é rejeitado', async () => {
    const { error } = await admin.from('attendance_records').insert({
      patient_id: idPaciente,
      registrado_por: idDra,
    })
    expect(error).not.toBeNull()
  })

  it('atendimento sem autor é rejeitado', async () => {
    // Prontuário sem quem assina não é prontuário.
    const { error } = await admin.from('attendance_records').insert({
      patient_id: idPaciente,
      procedure_id: idProcedimento,
    })
    expect(error).not.toBeNull()
  })
})

describe('attendance_records — constraints de retorno', () => {
  it('ajuste de retorno em zero dias é rejeitado', async () => {
    // "Sem retorno" tem uma representação só, e é a coluna sem_retorno.
    const { error } = await registrar(admin, idDra, { retorno_ajuste_dias: 0 })
    expect(error).not.toBeNull()
  })

  it('ajuste de retorno negativo é rejeitado', async () => {
    const { error } = await registrar(admin, idDra, { retorno_ajuste_dias: -30 })
    expect(error).not.toBeNull()
  })

  it('ajuste de retorno positivo é aceito', async () => {
    const { error } = await registrar(admin, idDra, { retorno_ajuste_dias: 90 })
    expect(error).toBeNull()
  })

  it('sem_retorno com vencimento preenchido é rejeitado', async () => {
    // O nível 3 vence tudo, e o banco não aceita o estado contraditório em que
    // uma paciente dispensada do retorno continuaria caindo na fila.
    const { error } = await registrar(admin, idDra, {
      sem_retorno: true,
      retorno_vencimento: '2026-12-03',
    })
    expect(error).not.toBeNull()
  })

  it('sem_retorno sem vencimento é aceito', async () => {
    const { error } = await registrar(admin, idDra, { sem_retorno: true })
    expect(error).toBeNull()
  })

  it('update que marca sem_retorno sem limpar o vencimento é rejeitado', async () => {
    const { data } = await registrar(admin, idDra, { retorno_vencimento: '2026-12-03' })

    const { error } = await admin
      .from('attendance_records')
      .update({ sem_retorno: true })
      .eq('id', data!.id)
    expect(error).not.toBeNull()
  })
})

describe('attendance_records — vínculos', () => {
  it('apagar a consulta não apaga o prontuário, só solta o vínculo', async () => {
    const dia = diaLivre()
    const { data: consulta } = await admin
      .from('appointments')
      .insert({
        patient_id: idPaciente,
        procedure_id: idProcedimento,
        inicio: as(dia, 14),
        fim: as(dia, 15),
      })
      .select('id')
      .single()

    const { data: registro } = await registrar(admin, idDra, { appointment_id: consulta!.id })

    await admin.from('appointments').delete().eq('id', consulta!.id)

    const { data: depois } = await admin
      .from('attendance_records')
      .select('id, appointment_id')
      .eq('id', registro!.id)
      .single()
    expect(depois).not.toBeNull()
    expect(depois!.appointment_id).toBeNull()
  })

  it('apagar o paciente leva o prontuário dele junto', async () => {
    const { data: paciente } = await admin
      .from('patients')
      .insert({ nome_completo: `Cascata ${marca}` })
      .select('id')
      .single()

    const { data: registro } = await admin
      .from('attendance_records')
      .insert({
        patient_id: paciente!.id,
        procedure_id: idProcedimento,
        registrado_por: idDra,
      })
      .select('id')
      .single()

    await admin.from('patients').delete().eq('id', paciente!.id)

    const { data: sobrou } = await admin
      .from('attendance_records')
      .select('id')
      .eq('id', registro!.id)
    expect(sobrou ?? []).toHaveLength(0)
  })

  it('procedimento com prontuário não pode ser apagado', async () => {
    await registrar(admin, idDra)

    const { error } = await admin.from('procedures').delete().eq('id', idProcedimento)
    expect(error).not.toBeNull()
  })
})

describe('attendance_records — RLS: a secretária lê e só lê', () => {
  it('secretária consegue ler o atendimento registrado', async () => {
    await registrar(admin, idDra, { retorno_vencimento: '2026-12-03' })

    const { data, error } = await comoSecretaria
      .from('attendance_records')
      .select('id')
      .eq('patient_id', idPaciente)
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
  })

  it('secretária não registra atendimento', async () => {
    const { error } = await registrar(comoSecretaria, idSecretaria)
    expect(error).not.toBeNull()
  })

  it('secretária não registra atendimento nem assinando com o id da dra', async () => {
    // Fechando a saída óbvia: se a barreira fosse só o `registrado_por`, bastaria
    // pôr o id da Dra. no corpo do insert. Quem barra é o `is_dra()` da policy.
    const { error } = await registrar(comoSecretaria, idDra)
    expect(error).not.toBeNull()
  })

  it('secretária não edita atendimento', async () => {
    const { data } = await registrar(admin, idDra, { regiao_tratada: 'malar direito' })

    // Sob RLS um update barrado volta sem erro e sem linha afetada — as duas
    // formas são aceitáveis. O que não pode é o prontuário mudar.
    await comoSecretaria
      .from('attendance_records')
      .update({ regiao_tratada: 'mentual', observacoes: 'editado pela secretaria' })
      .eq('id', data!.id)

    const { data: depois } = await admin
      .from('attendance_records')
      .select('regiao_tratada, observacoes')
      .eq('id', data!.id)
      .single()
    expect(depois!.regiao_tratada).toBe('malar direito')
    expect(depois!.observacoes).toBeNull()
  })

  it('secretária não apaga atendimento', async () => {
    const { data } = await registrar(admin, idDra)

    await comoSecretaria.from('attendance_records').delete().eq('id', data!.id)

    const { data: sobrou } = await admin
      .from('attendance_records')
      .select('id')
      .eq('id', data!.id)
    expect(sobrou ?? []).toHaveLength(1)
  })

  it('secretária não mexe no vencimento de retorno de ninguém', async () => {
    // O caminho oblíquo: sem tocar em coluna clínica, adiar o vencimento tiraria
    // a paciente da fila de retornos. Continua sendo escrita em prontuário.
    const { data } = await registrar(admin, idDra, { retorno_vencimento: '2026-12-03' })

    await comoSecretaria
      .from('attendance_records')
      .update({ retorno_vencimento: '2030-01-01' })
      .eq('id', data!.id)

    const { data: depois } = await admin
      .from('attendance_records')
      .select('retorno_vencimento')
      .eq('id', data!.id)
      .single()
    expect(depois!.retorno_vencimento).toBe('2026-12-03')
  })
})

describe('attendance_records — RLS: a dra escreve', () => {
  it('dra edita o atendimento que registrou', async () => {
    const { data } = await registrar(comoDra, idDra, { regiao_tratada: 'malar direito' })

    const { error } = await comoDra
      .from('attendance_records')
      .update({ quantidade: '1,5 ml' })
      .eq('id', data!.id)
    expect(error).toBeNull()

    const { data: depois } = await admin
      .from('attendance_records')
      .select('quantidade')
      .eq('id', data!.id)
      .single()
    expect(depois!.quantidade).toBe('1,5 ml')
  })

  it('dra apaga atendimento', async () => {
    const { data } = await registrar(comoDra, idDra)

    const { error } = await comoDra.from('attendance_records').delete().eq('id', data!.id)
    expect(error).toBeNull()

    const { data: sobrou } = await admin
      .from('attendance_records')
      .select('id')
      .eq('id', data!.id)
    expect(sobrou ?? []).toHaveLength(0)
  })

  it('dra não consegue assinar o registro com o id de outra pessoa', async () => {
    const { error } = await registrar(comoDra, idSecretaria)
    expect(error).not.toBeNull()
  })
})

describe('attendance_records — RLS: anônimo', () => {
  it('anônimo não lê prontuário', async () => {
    await registrar(admin, idDra)

    const anonimo = createClient(URL, ANON, { auth: { persistSession: false } })
    const { data } = await anonimo
      .from('attendance_records')
      .select('id')
      .eq('patient_id', idPaciente)
    expect(data ?? []).toHaveLength(0)
  })

  it('anônimo não registra atendimento', async () => {
    const anonimo = createClient(URL, ANON, { auth: { persistSession: false } })
    const { error } = await anonimo.from('attendance_records').insert({
      patient_id: idPaciente,
      procedure_id: idProcedimento,
      registrado_por: idDra,
    })
    expect(error).not.toBeNull()
  })
})
