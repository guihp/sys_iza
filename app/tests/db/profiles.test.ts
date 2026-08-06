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
const marca = `teste-${Date.now()}`

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
  // audit_log é append-only de propósito: as linhas do teste ficam lá,
  // identificadas pela entidade `marca`. Só os usuários são removidos.
  for (const id of [idSecretaria, idDra]) {
    if (id) await admin.auth.admin.deleteUser(id)
  }
})

describe('profiles', () => {
  it('secretária enxerga a equipe', async () => {
    const { data, error } = await comoSecretaria.from('profiles').select('id, role')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
  })

  it('secretária não consegue se promover a dra', async () => {
    await comoSecretaria.from('profiles').update({ role: 'dra' }).eq('id', idSecretaria)

    // A verificação que importa é o estado persistido: a RLS pode tanto
    // devolver erro quanto simplesmente não afetar linha alguma, e as duas
    // formas são aceitáveis — o que não pode é o papel mudar.
    const { data } = await admin.from('profiles').select('role').eq('id', idSecretaria).single()
    expect(data!.role).toBe('secretaria')
  })

  it('secretária não consegue rebaixar a dra', async () => {
    await comoSecretaria.from('profiles').update({ role: 'secretaria' }).eq('id', idDra)
    const { data } = await admin.from('profiles').select('role').eq('id', idDra).single()
    expect(data!.role).toBe('dra')
  })

  it('dra consegue alterar um perfil', async () => {
    const { error } = await comoDra
      .from('profiles')
      .update({ nome: 'Nome Alterado Pela Dra' })
      .eq('id', idSecretaria)
    expect(error).toBeNull()
    const { data } = await admin.from('profiles').select('nome').eq('id', idSecretaria).single()
    expect(data!.nome).toBe('Nome Alterado Pela Dra')
  })
})

describe('audit_log', () => {
  it('usuário autenticado consegue registrar', async () => {
    const { error } = await comoSecretaria
      .from('audit_log')
      .insert({ acao: 'leitura', entidade: marca, registro_id: '1' })
    expect(error).toBeNull()
  })

  it('secretária não lê a auditoria, a dra lê', async () => {
    const { data: comoSec } = await comoSecretaria
      .from('audit_log')
      .select('id')
      .eq('entidade', marca)
    expect(comoSec ?? []).toHaveLength(0)

    const { data: comoDoutora, error } = await comoDra
      .from('audit_log')
      .select('id')
      .eq('entidade', marca)
    expect(error).toBeNull()
    expect(comoDoutora!.length).toBeGreaterThan(0)
  })

  it('audit_log não aceita update de ninguém', async () => {
    for (const client of [comoSecretaria, comoDra]) {
      await client.from('audit_log').update({ acao: 'adulterado' }).eq('entidade', marca)
    }
    const { data } = await admin.from('audit_log').select('acao').eq('entidade', marca)
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((linha) => linha.acao === 'leitura')).toBe(true)
  })

  it('audit_log não aceita delete de ninguém', async () => {
    const { count: antes } = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entidade', marca)

    for (const client of [comoSecretaria, comoDra]) {
      await client.from('audit_log').delete().eq('entidade', marca)
    }

    const { count: depois } = await admin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entidade', marca)
    expect(depois).toBe(antes)
  })
})
