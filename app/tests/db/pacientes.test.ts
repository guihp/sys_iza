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
/** Marca única desta execução, para não colidir com outras rodadas. */
const marca = `pac-${Date.now()}`

/**
 * Telefone E.164 único por chamada. `Date.now()` sozinho repete quando dois
 * inserts caem no mesmo milissegundo, e aí o teste falharia pelo motivo certo
 * na hora errada.
 */
let sequencia = 0
function telefoneUnico() {
  sequencia += 1
  const cauda = `${Date.now()}${sequencia}`.slice(-9)
  return `+5511${cauda}`
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
})

afterAll(async () => {
  // Só o que este teste criou: os pacientes marcados e os dois usuários.
  // audit_log é append-only e não se limpa — por definição.
  await admin.from('patients').delete().like('nome_completo', `%${marca}%`)
  for (const id of [idSecretaria, idDra]) {
    if (id) await admin.auth.admin.deleteUser(id)
  }
})

describe('patients — cadastro', () => {
  it('secretária cadastra um lead', async () => {
    const { error } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `Maria Teste ${marca}`, telefone: telefoneUnico() })
    expect(error).toBeNull()
  })

  it('novo paciente começa no estágio lead', async () => {
    const { data, error } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `Ana Teste ${marca}` })
      .select('stage, aceita_whatsapp, aceita_email')
      .single()
    expect(error).toBeNull()
    expect(data!.stage).toBe('lead')
    // Opt-in de comunicação começa ligado: o lead pediu contato.
    expect(data!.aceita_whatsapp).toBe(true)
    expect(data!.aceita_email).toBe(true)
  })

  it('telefone é único', async () => {
    const tel = telefoneUnico()
    const { error: primeiro } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `A ${marca}`, telefone: tel })
    expect(primeiro).toBeNull()

    const { error: segundo } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `B ${marca}`, telefone: tel })
    expect(segundo).not.toBeNull()
  })

  it('vários pacientes podem ficar sem telefone', async () => {
    // Índice único parcial: null não colide com null.
    const { error: primeiro } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `Sem telefone 1 ${marca}` })
    const { error: segundo } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `Sem telefone 2 ${marca}` })
    expect(primeiro).toBeNull()
    expect(segundo).toBeNull()
  })
})

describe('patients — constraints', () => {
  it('telefone fora de E.164 é rejeitado', async () => {
    // Sem isso o índice único não deduplica: mascarado e cru conviveriam.
    const { error } = await admin
      .from('patients')
      .insert({ nome_completo: `Telefone cru ${marca}`, telefone: '(11) 98765-4321' })
    expect(error).not.toBeNull()
  })

  it('nome em branco é rejeitado', async () => {
    const { error } = await admin.from('patients').insert({ nome_completo: '   ' })
    expect(error).not.toBeNull()
  })

  it('estágio fora do enum é rejeitado', async () => {
    const { error } = await comoSecretaria
      .from('patients')
      // Estágio inventado: quem barra é o tipo patient_stage no banco.
      .insert({ nome_completo: `Estagio invalido ${marca}`, stage: 'vendido' })
    expect(error).not.toBeNull()
  })

  it('aceita todos os sete estágios do funil', async () => {
    const estagios = [
      'lead',
      'contato',
      'agendado',
      'compareceu',
      'paciente',
      'retorno',
      'descartado',
    ]
    for (const stage of estagios) {
      const { error } = await comoSecretaria
        .from('patients')
        .insert({ nome_completo: `Estagio ${stage} ${marca}`, stage })
      expect(error, `estágio ${stage} deveria ser aceito`).toBeNull()
    }
  })
})

describe('patients — RLS', () => {
  it('secretária move o paciente de estágio', async () => {
    const { data } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `Para mover ${marca}` })
      .select('id')
      .single()

    const { error } = await comoSecretaria
      .from('patients')
      .update({ stage: 'contato' })
      .eq('id', data!.id)
    expect(error).toBeNull()

    const { data: depois } = await admin
      .from('patients')
      .select('stage')
      .eq('id', data!.id)
      .single()
    expect(depois!.stage).toBe('contato')
  })

  it('atualizado_em avança sozinho a cada update', async () => {
    const { data } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `Carimbo ${marca}` })
      .select('id, atualizado_em')
      .single()

    await comoSecretaria.from('patients').update({ stage: 'contato' }).eq('id', data!.id)

    const { data: depois } = await admin
      .from('patients')
      .select('atualizado_em')
      .eq('id', data!.id)
      .single()
    // O caller não mandou atualizado_em: quem carimba é o trigger.
    expect(new Date(depois!.atualizado_em).getTime()).toBeGreaterThan(
      new Date(data!.atualizado_em).getTime(),
    )
  })

  it('secretária não apaga paciente', async () => {
    const { data } = await comoSecretaria
      .from('patients')
      .insert({ nome_completo: `Para apagar ${marca}` })
      .select('id')
      .single()

    // A RLS pode devolver erro ou simplesmente não afetar linha alguma; as duas
    // formas são aceitáveis — o que não pode é o paciente sumir.
    await comoSecretaria.from('patients').delete().eq('id', data!.id)

    const { data: sobrou } = await admin.from('patients').select('id').eq('id', data!.id)
    expect(sobrou ?? []).toHaveLength(1)
  })

  it('dra apaga paciente', async () => {
    const { data } = await comoDra
      .from('patients')
      .insert({ nome_completo: `Removivel ${marca}` })
      .select('id')
      .single()

    const { error } = await comoDra.from('patients').delete().eq('id', data!.id)
    expect(error).toBeNull()

    const { data: sobrou } = await admin.from('patients').select('id').eq('id', data!.id)
    expect(sobrou ?? []).toHaveLength(0)
  })

  it('anônimo não enxerga paciente', async () => {
    await admin
      .from('patients')
      .insert({ nome_completo: `Sigiloso ${marca}`, telefone: telefoneUnico() })

    const anonimo = createClient(URL, ANON, { auth: { persistSession: false } })
    const { data } = await anonimo.from('patients').select('id').like('nome_completo', `%${marca}%`)
    expect(data ?? []).toHaveLength(0)
  })
})
