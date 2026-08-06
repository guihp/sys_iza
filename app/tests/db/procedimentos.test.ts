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
const marca = `proc-${Date.now()}`

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
  // Só o que este teste criou: os procedimentos marcados e os dois usuários.
  // O catálogo inicial fica intocado.
  await admin.from('procedures').delete().like('nome', `%${marca}%`)
  for (const id of [idSecretaria, idDra]) {
    if (id) await admin.auth.admin.deleteUser(id)
  }
})

describe('procedures — catálogo inicial', () => {
  it('vem com o catálogo inicial e a toxina retorna em 120 dias', async () => {
    const { data, error } = await comoSecretaria
      .from('procedures')
      .select('nome, duracao_minutos, preco_centavos, default_return_interval_days')
      .eq('nome', 'Toxina botulínica')
      .single()
    expect(error).toBeNull()
    expect(data!.default_return_interval_days).toBe(120)
    expect(data!.duracao_minutos).toBe(60)
    expect(data!.preco_centavos).toBe(180000)
  })

  it('avaliação inicial não gera retorno', async () => {
    const { data, error } = await comoSecretaria
      .from('procedures')
      .select('default_return_interval_days')
      .eq('nome', 'Avaliação / primeira consulta')
      .single()
    expect(error).toBeNull()
    expect(data!.default_return_interval_days).toBeNull()
  })
})

describe('procedures — RLS', () => {
  it('secretária não cria procedimento', async () => {
    const nome = `Nao deveria existir ${marca}`
    const { error } = await comoSecretaria
      .from('procedures')
      .insert({ nome, duracao_minutos: 30, preco_centavos: 100 })
    expect(error).not.toBeNull()

    // O que importa é o estado persistido, não só o erro devolvido.
    const { data } = await admin.from('procedures').select('id').eq('nome', nome)
    expect(data ?? []).toHaveLength(0)
  })

  it('dra cria procedimento', async () => {
    const nome = `Criado pela dra ${marca}`
    const { error } = await comoDra
      .from('procedures')
      .insert({ nome, duracao_minutos: 30, preco_centavos: 100 })
    expect(error).toBeNull()

    const { data } = await admin.from('procedures').select('ativo').eq('nome', nome).single()
    expect(data!.ativo).toBe(true)
  })

  it('secretária não desativa procedimento', async () => {
    const nome = `Alvo da secretaria ${marca}`
    const { error: erroSeed } = await admin
      .from('procedures')
      .insert({ nome, duracao_minutos: 30, preco_centavos: 100 })
    expect(erroSeed).toBeNull()

    // A RLS pode devolver erro ou simplesmente não afetar linha alguma; as duas
    // formas são aceitáveis — o que não pode é o procedimento sair do ar.
    await comoSecretaria.from('procedures').update({ ativo: false }).eq('nome', nome)

    const { data } = await admin.from('procedures').select('ativo').eq('nome', nome).single()
    expect(data!.ativo).toBe(true)
  })

  it('secretária não apaga procedimento', async () => {
    const nome = `Nao apagavel ${marca}`
    await admin.from('procedures').insert({ nome, duracao_minutos: 30, preco_centavos: 100 })

    await comoSecretaria.from('procedures').delete().eq('nome', nome)

    const { data } = await admin.from('procedures').select('id').eq('nome', nome)
    expect(data ?? []).toHaveLength(1)
  })

  it('dra desativa procedimento', async () => {
    const nome = `Desativavel ${marca}`
    await admin.from('procedures').insert({ nome, duracao_minutos: 30, preco_centavos: 100 })

    const { error } = await comoDra.from('procedures').update({ ativo: false }).eq('nome', nome)
    expect(error).toBeNull()

    const { data } = await admin.from('procedures').select('ativo').eq('nome', nome).single()
    expect(data!.ativo).toBe(false)
  })
})

describe('procedures — constraints', () => {
  it('retorno zero é rejeitado: "sem retorno" só existe como null', async () => {
    const { error } = await admin.from('procedures').insert({
      nome: `Retorno zero ${marca}`,
      duracao_minutos: 30,
      preco_centavos: 100,
      default_return_interval_days: 0,
    })
    expect(error).not.toBeNull()
  })

  it('duração fora da faixa de 5 a 480 minutos é rejeitada', async () => {
    const { error } = await admin.from('procedures').insert({
      nome: `Duracao absurda ${marca}`,
      duracao_minutos: 600,
      preco_centavos: 100,
    })
    expect(error).not.toBeNull()
  })

  it('nome duplicado é rejeitado', async () => {
    const nome = `Duplicado ${marca}`
    const { error: primeiro } = await admin
      .from('procedures')
      .insert({ nome, duracao_minutos: 30, preco_centavos: 100 })
    expect(primeiro).toBeNull()

    const { error: segundo } = await admin
      .from('procedures')
      .insert({ nome, duracao_minutos: 30, preco_centavos: 100 })
    expect(segundo).not.toBeNull()
  })
})
