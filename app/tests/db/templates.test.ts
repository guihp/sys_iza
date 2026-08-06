import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * RLS e constraints de `message_templates`.
 *
 * Diferente dos outros testes de banco: aqui não dá para criar linha
 * descartável. A chave primária é `(kind, channel)` e existem exatamente sete
 * pares semeados pela migration 0007 — os mesmos que o worker lê em produção.
 * Então o teste mexe nas linhas de verdade e devolve cada uma ao estado
 * original no `afterAll`, a partir de um retrato tirado antes de tocar em nada.
 *
 * Pelo mesmo motivo as constraints são exercitadas por `update` inválido e não
 * por `insert`: um update recusado não deixa resíduo nenhum.
 */

const URL = process.env.SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.SUPABASE_ANON_KEY!

const SENHA = 'senha-de-teste-123'

let admin: SupabaseClient
let comoSecretaria: SupabaseClient
let comoDra: SupabaseClient
let idSecretaria: string
let idDra: string

type LinhaDeTemplate = {
  kind: string
  channel: string
  assunto: string | null
  corpo: string
  ativo: boolean
}

/** Retrato das sete linhas antes do teste, para restaurar depois. */
let original: LinhaDeTemplate[] = []

const marca = `tpl-${Date.now()}`

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

  const { data, error } = await admin
    .from('message_templates')
    .select('kind, channel, assunto, corpo, ativo')
  if (error) throw error
  original = data as LinhaDeTemplate[]

  const sec = await criarUsuario(`sec-${marca}@teste.local`, 'secretaria')
  comoSecretaria = sec.sessao
  idSecretaria = sec.id
  const dra = await criarUsuario(`dra-${marca}@teste.local`, 'dra')
  comoDra = dra.sessao
  idDra = dra.id
})

afterAll(async () => {
  for (const linha of original) {
    await admin
      .from('message_templates')
      .update({ assunto: linha.assunto, corpo: linha.corpo, ativo: linha.ativo })
      .eq('kind', linha.kind)
      .eq('channel', linha.channel)
  }
  for (const id of [idSecretaria, idDra]) {
    if (id) await admin.auth.admin.deleteUser(id)
  }
})

describe('message_templates — textos semeados', () => {
  it('vem com os sete pares que o planejador produz', () => {
    expect(original.map((l) => `${l.kind}/${l.channel}`).sort()).toEqual(
      [
        'avaliacao/whatsapp',
        'confirmacao/email',
        'confirmacao/whatsapp',
        'pos_procedimento/whatsapp',
        'retorno/email',
        'retorno/whatsapp',
        'vespera_curta/whatsapp',
      ].sort(),
    )
  })

  it('só o e-mail tem assunto', () => {
    for (const linha of original) {
      if (linha.channel === 'email') expect(linha.assunto, linha.kind).toBeTruthy()
      else expect(linha.assunto, linha.kind).toBeNull()
    }
  })
})

describe('message_templates — RLS', () => {
  it('secretária lê os templates', async () => {
    const { data, error } = await comoSecretaria.from('message_templates').select('kind, corpo')
    expect(error).toBeNull()
    expect(data!.length).toBe(7)
  })

  it('secretária não altera template', async () => {
    const antes = original.find((l) => l.kind === 'confirmacao' && l.channel === 'whatsapp')!

    // A RLS pode devolver erro ou simplesmente não afetar linha alguma; as duas
    // formas são aceitáveis — o que não pode é o texto mudar.
    await comoSecretaria
      .from('message_templates')
      .update({ corpo: `alterado pela secretaria ${marca}` })
      .eq('kind', 'confirmacao')
      .eq('channel', 'whatsapp')

    const { data } = await admin
      .from('message_templates')
      .select('corpo')
      .eq('kind', 'confirmacao')
      .eq('channel', 'whatsapp')
      .single()
    expect(data!.corpo).toBe(antes.corpo)
  })

  it('secretária não cria template', async () => {
    // `vespera_curta` + `email` é um par livre: o planejador nunca o produz.
    const { error } = await comoSecretaria
      .from('message_templates')
      .insert({ kind: 'vespera_curta', channel: 'email', assunto: 'x', corpo: 'x' })
    expect(error).not.toBeNull()

    const { data } = await admin
      .from('message_templates')
      .select('kind')
      .eq('kind', 'vespera_curta')
      .eq('channel', 'email')
    expect(data ?? []).toHaveLength(0)
  })

  it('secretária não apaga template', async () => {
    await comoSecretaria
      .from('message_templates')
      .delete()
      .eq('kind', 'avaliacao')
      .eq('channel', 'whatsapp')

    const { data } = await admin
      .from('message_templates')
      .select('kind')
      .eq('kind', 'avaliacao')
      .eq('channel', 'whatsapp')
    expect(data ?? []).toHaveLength(1)
  })

  it('dra altera template', async () => {
    const texto = `Olá, {{nome}}! ${marca}`
    const { error } = await comoDra
      .from('message_templates')
      .update({ corpo: texto })
      .eq('kind', 'confirmacao')
      .eq('channel', 'whatsapp')
    expect(error).toBeNull()

    const { data } = await admin
      .from('message_templates')
      .select('corpo')
      .eq('kind', 'confirmacao')
      .eq('channel', 'whatsapp')
      .single()
    expect(data!.corpo).toBe(texto)
  })

  it('dra desliga e religa um lembrete sem perder o texto', async () => {
    const antes = original.find((l) => l.kind === 'avaliacao' && l.channel === 'whatsapp')!

    const { error } = await comoDra
      .from('message_templates')
      .update({ ativo: false })
      .eq('kind', 'avaliacao')
      .eq('channel', 'whatsapp')
    expect(error).toBeNull()

    const { data } = await admin
      .from('message_templates')
      .select('ativo, corpo')
      .eq('kind', 'avaliacao')
      .eq('channel', 'whatsapp')
      .single()
    expect(data!.ativo).toBe(false)
    expect(data!.corpo).toBe(antes.corpo)
  })
})

/**
 * As três regras que o editor replica em `validarTemplate`. Se o banco deixasse
 * de recusá-las, a duplicação na tela viraria a única defesa.
 */
describe('message_templates — constraints', () => {
  it('corpo em branco é recusado', async () => {
    const { error } = await admin
      .from('message_templates')
      .update({ corpo: '   ' })
      .eq('kind', 'confirmacao')
      .eq('channel', 'whatsapp')
    expect(error).not.toBeNull()
  })

  it('e-mail sem assunto é recusado', async () => {
    const { error } = await admin
      .from('message_templates')
      .update({ assunto: null })
      .eq('kind', 'retorno')
      .eq('channel', 'email')
    expect(error).not.toBeNull()
  })

  it('whatsapp com assunto é recusado', async () => {
    const { error } = await admin
      .from('message_templates')
      .update({ assunto: 'assunto que não deveria existir' })
      .eq('kind', 'retorno')
      .eq('channel', 'whatsapp')
    expect(error).not.toBeNull()
  })
})
