import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Testes da migration 0010_atribuicao_meta.sql.
 *
 * Exigem um Supabase acessível com a 0010 aplicada — rodam por `pnpm test:db`,
 * nunca por `pnpm test`. Enquanto a migration não for aplicada pelo dono, este
 * arquivo fica pendente por completo.
 *
 * O que aqui é testado só pode ser testado contra um banco de verdade: o
 * trigger que congela o `ctwa_clid`, o índice único que sustenta o
 * `on conflict do nothing` do n8n, os cascades e as policies de RLS. A regra de
 * QUAIS eventos existem é pura e vive em tests/domain/plan-conversions.test.ts.
 */

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

/** Marca única desta execução, para não colidir com outras rodadas. */
const marca = `atr-${Date.now()}`

/**
 * Telefones distintos por teste. O índice único é por telefone, então reusar o
 * mesmo número entre casos faria um teste derrubar o outro por 23505 —
 * escondendo o que cada um queria provar.
 */
let sequencia = 0
function telefone() {
  sequencia += 1
  // E.164 brasileiro válido: +55 + DDD + celular de 9 dígitos.
  return `+5511${String(900_000_000 + (Date.now() % 90_000_000) + sequencia).slice(0, 9)}`
}

let chaveSequencia = 0
function chave(sufixo: string) {
  chaveSequencia += 1
  return `${marca}-${chaveSequencia}:${sufixo}`
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

  const { data: paciente, error } = await admin
    .from('patients')
    .insert({
      nome_completo: `Atribuicao Teste ${marca}`,
      consentimento_lgpd_em: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  idPaciente = paciente!.id
})

afterAll(async () => {
  await admin.from('meta_conversion_jobs').delete().eq('patient_id', idPaciente)
  await admin.from('lead_attribution').delete().like('push_name', `%${marca}%`)
  await admin.from('patients').delete().like('nome_completo', `%${marca}%`)
  for (const id of [idSecretaria, idDra]) {
    if (id) await admin.auth.admin.deleteUser(id)
  }
})

/** Insere uma atribuição como o n8n faria (service_role). */
function gravarAtribuicao(client: SupabaseClient, extra: Record<string, unknown> = {}) {
  return client
    .from('lead_attribution')
    .insert({
      telefone: telefone(),
      ctwa_clid: chave('clid'),
      ad_id: '120210000000000000',
      source_app: 'instagram',
      ad_title: 'Preenchimento labial',
      push_name: `WhatsApp ${marca}`,
      primeiro_contato_em: new Date().toISOString(),
      ...extra,
    })
    .select('id, telefone, ctwa_clid, ad_id, patient_id')
    .single()
}

function enfileirarConversao(client: SupabaseClient, extra: Record<string, unknown> = {}) {
  return client
    .from('meta_conversion_jobs')
    .insert({
      patient_id: idPaciente,
      evento: 'Schedule',
      chave_idempotencia: chave('Schedule'),
      event_id: 'a'.repeat(64),
      ocorrido_em: new Date().toISOString(),
      payload: { event_name: 'Schedule', currency: null },
      ...extra,
    })
    .select('id, status, tentativas, enviado_em')
    .single()
}

// ---------------------------------------------------------------------------
// lead_attribution
// ---------------------------------------------------------------------------

describe('lead_attribution — formato', () => {
  it('grava a atribuição vinda do webhook', async () => {
    const { data, error } = await gravarAtribuicao(admin)
    expect(error).toBeNull()
    expect(data!.patient_id).toBeNull() // o vínculo vem depois
  })

  it('telefone fora de E.164 é rejeitado', async () => {
    const { error } = await gravarAtribuicao(admin, { telefone: '(11) 98765-4321' })
    expect(error).not.toBeNull()
  })

  it('clid em branco é rejeitado', async () => {
    const { error } = await gravarAtribuicao(admin, { ctwa_clid: '   ' })
    expect(error).not.toBeNull()
  })

  it('source_app desconhecido é rejeitado', async () => {
    const { error } = await gravarAtribuicao(admin, { source_app: 'tiktok' })
    expect(error).not.toBeNull()
  })

  it('source_app nulo é aceito — o webhook nem sempre traz', async () => {
    const { error } = await gravarAtribuicao(admin, { source_app: null })
    expect(error).toBeNull()
  })

  it('ad_id nulo é aceito — perder o anúncio é melhor que perder a atribuição', async () => {
    const { error } = await gravarAtribuicao(admin, { ad_id: null })
    expect(error).toBeNull()
  })
})

describe('lead_attribution — um registro por telefone', () => {
  it('a segunda mensagem da mesma pessoa é rejeitada pelo índice único', async () => {
    const numero = telefone()
    const { error: primeiro } = await gravarAtribuicao(admin, { telefone: numero })
    expect(primeiro).toBeNull()

    const { error: segundo } = await gravarAtribuicao(admin, { telefone: numero })
    expect(segundo).not.toBeNull()
    expect(segundo!.code).toBe('23505') // unique_violation
  })

  it('on conflict do nothing — o fluxo do n8n não quebra e o clid do primeiro anúncio fica', async () => {
    const numero = telefone()
    const clidOriginal = chave('primeiro-anuncio')

    const linha = {
      telefone: numero,
      ctwa_clid: clidOriginal,
      ad_id: 'anuncio-A',
      push_name: `WhatsApp ${marca}`,
    }
    await admin.from('lead_attribution').upsert([linha], {
      onConflict: 'telefone',
      ignoreDuplicates: true,
    })

    const { error } = await admin.from('lead_attribution').upsert(
      [{ ...linha, ctwa_clid: chave('segundo-anuncio'), ad_id: 'anuncio-B' }],
      { onConflict: 'telefone', ignoreDuplicates: true },
    )
    expect(error).toBeNull()

    const { data } = await admin
      .from('lead_attribution')
      .select('ctwa_clid, ad_id')
      .eq('telefone', numero)
    expect((data ?? []).length).toBe(1)
    expect(data![0].ctwa_clid).toBe(clidOriginal)
    expect(data![0].ad_id).toBe('anuncio-A')
  })
})

describe('lead_attribution — o ctwa_clid é imutável', () => {
  it('um UPDATE direto no clid é recusado pelo trigger', async () => {
    // Esta é a trava que o índice único NÃO dá: um `on conflict do update`
    // escrito por reflexo passaria pelo índice e reescreveria o clid em silêncio,
    // movendo a atribuição de anúncio.
    const { data } = await gravarAtribuicao(admin)
    const { error } = await admin
      .from('lead_attribution')
      .update({ ctwa_clid: 'clid-de-outro-anuncio' })
      .eq('id', data!.id)
    expect(error).not.toBeNull()
  })

  it('on conflict do UPDATE também é barrado — a trava não depende da forma do insert', async () => {
    const numero = telefone()
    const original = chave('imutavel')
    await gravarAtribuicao(admin, { telefone: numero, ctwa_clid: original })

    const { error } = await admin.from('lead_attribution').upsert(
      [{ telefone: numero, ctwa_clid: chave('sobrescrito'), push_name: `WhatsApp ${marca}` }],
      { onConflict: 'telefone' },
    )
    expect(error).not.toBeNull()

    const { data } = await admin
      .from('lead_attribution')
      .select('ctwa_clid')
      .eq('telefone', numero)
      .single()
    expect(data!.ctwa_clid).toBe(original)
  })

  it('ad_id, telefone e primeiro_contato_em também são congelados', async () => {
    const { data } = await gravarAtribuicao(admin)
    for (const campo of [
      { ad_id: 'outro-anuncio' },
      { telefone: telefone() },
      { primeiro_contato_em: new Date('2020-01-01T00:00:00Z').toISOString() },
    ]) {
      const { error } = await admin.from('lead_attribution').update(campo).eq('id', data!.id)
      expect(error).not.toBeNull()
    }
  })

  it('o vínculo com a paciente continua alterável — é ele que se resolve depois', async () => {
    const { data } = await gravarAtribuicao(admin)
    const { error } = await admin
      .from('lead_attribution')
      .update({ patient_id: idPaciente, push_name: `WhatsApp ${marca} corrigido` })
      .eq('id', data!.id)
    expect(error).toBeNull()
  })
})

describe('lead_attribution — vínculo e cascade', () => {
  it('apagar a paciente leva junto o telefone dela na atribuição', async () => {
    // Direito ao esquecimento: a linha guarda um telefone, que é dado pessoal.
    const { data: outra } = await admin
      .from('patients')
      .insert({ nome_completo: `Atribuicao Cascade ${marca}` })
      .select('id')
      .single()

    const { data: atribuicao } = await gravarAtribuicao(admin, { patient_id: outra!.id })
    await admin.from('patients').delete().eq('id', outra!.id)

    const { data: sumiu } = await admin
      .from('lead_attribution')
      .select('id')
      .eq('id', atribuicao!.id)
    expect((sumiu ?? []).length).toBe(0)
  })
})

describe('lead_attribution — RLS', () => {
  it('anônimo não lê a atribuição', async () => {
    const { data, error } = await anonimo.from('lead_attribution').select('telefone')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('secretária lê a atribuição', async () => {
    const { data, error } = await comoSecretaria.from('lead_attribution').select('id')
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('secretária não grava atribuição — quem grava é o n8n com service_role', async () => {
    const { error } = await gravarAtribuicao(comoSecretaria)
    expect(error).not.toBeNull()
  })

  it('nem a dra grava atribuição pela sessão dela', async () => {
    // Não há policy de INSERT para papel humano nenhum, e é deliberado:
    // atribuição é fato registrado, não campo de cadastro.
    const { error } = await gravarAtribuicao(comoDra)
    expect(error).not.toBeNull()
  })

  it('secretária não apaga atribuição', async () => {
    const { data } = await gravarAtribuicao(admin)
    await comoSecretaria.from('lead_attribution').delete().eq('id', data!.id)

    const { data: aindaLa } = await admin.from('lead_attribution').select('id').eq('id', data!.id)
    expect((aindaLa ?? []).length).toBe(1)
  })

  it('a dra apaga atribuição — é o caminho do pedido de exclusão de quem nunca virou paciente', async () => {
    const { data } = await gravarAtribuicao(admin)
    await comoDra.from('lead_attribution').delete().eq('id', data!.id)

    const { data: sumiu } = await admin.from('lead_attribution').select('id').eq('id', data!.id)
    expect((sumiu ?? []).length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// meta_conversion_jobs
// ---------------------------------------------------------------------------

describe('meta_conversion_jobs — enfileiramento', () => {
  it('job nasce pendente, sem tentativa e sem envio', async () => {
    const { data, error } = await enfileirarConversao(admin)
    expect(error).toBeNull()
    expect(data!.status).toBe('pendente')
    expect(data!.tentativas).toBe(0)
    expect(data!.enviado_em).toBeNull()
  })

  it('evento fora do vocabulário da Meta é rejeitado', async () => {
    const { error } = await enfileirarConversao(admin, {
      evento: 'AgendouNoKanban',
      chave_idempotencia: chave('evento-invalido'),
    })
    expect(error).not.toBeNull()
  })

  it('os cinco eventos do mapa são aceitos', async () => {
    for (const evento of ['Lead', 'Contact', 'Schedule', 'CompleteRegistration', 'Purchase']) {
      const { error } = await enfileirarConversao(admin, {
        evento,
        chave_idempotencia: chave(evento),
      })
      expect(error).toBeNull()
    }
  })

  it('event_id em branco é rejeitado — sem ele a Meta não deduplica', async () => {
    const { error } = await enfileirarConversao(admin, {
      event_id: '   ',
      chave_idempotencia: chave('sem-event-id'),
    })
    expect(error).not.toBeNull()
  })

  it('tentativas negativas são rejeitadas', async () => {
    const { error } = await enfileirarConversao(admin, {
      tentativas: -1,
      chave_idempotencia: chave('tentativas'),
    })
    expect(error).not.toBeNull()
  })

  it('marcar como enviado sem carimbo é rejeitado', async () => {
    const { data } = await enfileirarConversao(admin, { chave_idempotencia: chave('carimbo') })
    const { error } = await admin
      .from('meta_conversion_jobs')
      .update({ status: 'enviado' })
      .eq('id', data!.id)
    expect(error).not.toBeNull()
  })

  it('marcar como enviado com carimbo é aceito', async () => {
    const { data } = await enfileirarConversao(admin, { chave_idempotencia: chave('carimbo-ok') })
    const { error } = await admin
      .from('meta_conversion_jobs')
      .update({ status: 'enviado', enviado_em: new Date().toISOString() })
      .eq('id', data!.id)
    expect(error).toBeNull()
  })
})

describe('meta_conversion_jobs — idempotência', () => {
  it('a mesma chave duas vezes é rejeitada pelo banco', async () => {
    const repetida = chave('duplicada')
    const { error: primeiro } = await enfileirarConversao(admin, {
      chave_idempotencia: repetida,
    })
    expect(primeiro).toBeNull()

    const { error: segundo } = await enfileirarConversao(admin, {
      chave_idempotencia: repetida,
    })
    expect(segundo).not.toBeNull()
    expect(segundo!.code).toBe('23505')
  })

  it('replanejar com on conflict do nothing não duplica nem falha', async () => {
    // É o que acontece quando a secretária volta o cartão e o arrasta de novo:
    // `planejarConversoes` devolve a mesma chave, e o banco vira no-op.
    const repetida = chave('replanejamento')
    const linha = {
      patient_id: idPaciente,
      evento: 'Schedule',
      chave_idempotencia: repetida,
      event_id: 'b'.repeat(64),
      ocorrido_em: new Date().toISOString(),
      payload: { event_name: 'Schedule' },
    }

    await admin
      .from('meta_conversion_jobs')
      .upsert([linha], { onConflict: 'chave_idempotencia', ignoreDuplicates: true })
    const { error } = await admin
      .from('meta_conversion_jobs')
      .upsert([linha], { onConflict: 'chave_idempotencia', ignoreDuplicates: true })
    expect(error).toBeNull()

    const { data } = await admin
      .from('meta_conversion_jobs')
      .select('id')
      .eq('chave_idempotencia', repetida)
    expect((data ?? []).length).toBe(1)
  })
})

describe('meta_conversion_jobs — reserva atômica', () => {
  it('só o primeiro update leva a linha; o segundo volta vazio', async () => {
    // O mesmo desenho de 0008: o `select` escolhe candidatos, o `update`
    // condicional é a posse. Só se despacha o que voltou do `returning`.
    const { data } = await enfileirarConversao(admin, { chave_idempotencia: chave('reserva') })

    const { data: primeiro } = await admin
      .from('meta_conversion_jobs')
      .update({ status: 'enviando' })
      .eq('id', data!.id)
      .eq('status', 'pendente')
      .select('id')
    expect((primeiro ?? []).length).toBe(1)

    const { data: segundo } = await admin
      .from('meta_conversion_jobs')
      .update({ status: 'enviando' })
      .eq('id', data!.id)
      .eq('status', 'pendente')
      .select('id')
    expect((segundo ?? []).length).toBe(0)
  })
})

describe('meta_conversion_jobs — cascade', () => {
  it('apagar a paciente leva a fila de conversões dela junto', async () => {
    const { data: outra } = await admin
      .from('patients')
      .insert({ nome_completo: `Conversao Cascade ${marca}` })
      .select('id')
      .single()

    const chaveDoJob = chave('cascade')
    await admin.from('meta_conversion_jobs').insert({
      patient_id: outra!.id,
      evento: 'Lead',
      chave_idempotencia: chaveDoJob,
      event_id: 'c'.repeat(64),
      ocorrido_em: new Date().toISOString(),
      payload: { event_name: 'Lead' },
    })

    await admin.from('patients').delete().eq('id', outra!.id)

    const { data } = await admin
      .from('meta_conversion_jobs')
      .select('id')
      .eq('chave_idempotencia', chaveDoJob)
    expect((data ?? []).length).toBe(0)
  })
})

describe('meta_conversion_jobs — RLS', () => {
  it('anônimo não lê a fila de conversões', async () => {
    const { data, error } = await anonimo.from('meta_conversion_jobs').select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('secretária lê a fila', async () => {
    const { data, error } = await comoSecretaria.from('meta_conversion_jobs').select('id')
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('secretária enfileira — é ela quem move o funil', async () => {
    const { error } = await enfileirarConversao(comoSecretaria, {
      chave_idempotencia: chave('pela-secretaria'),
    })
    expect(error).toBeNull()
  })

  it('secretária cancela — é o efeito de desligar o envio na tela', async () => {
    const { data } = await enfileirarConversao(admin, { chave_idempotencia: chave('cancelar') })
    const { data: atualizado, error } = await comoSecretaria
      .from('meta_conversion_jobs')
      .update({ status: 'cancelado' })
      .eq('id', data!.id)
      .select('status')
    expect(error).toBeNull()
    expect(atualizado![0].status).toBe('cancelado')
  })

  it('secretária não apaga conversão', async () => {
    const { data } = await enfileirarConversao(admin, { chave_idempotencia: chave('nao-apaga') })
    await comoSecretaria.from('meta_conversion_jobs').delete().eq('id', data!.id)

    const { data: aindaLa } = await admin
      .from('meta_conversion_jobs')
      .select('id')
      .eq('id', data!.id)
    expect((aindaLa ?? []).length).toBe(1)
  })

  it('a dra apaga conversão', async () => {
    const { data } = await enfileirarConversao(admin, { chave_idempotencia: chave('dra-apaga') })
    await comoDra.from('meta_conversion_jobs').delete().eq('id', data!.id)

    const { data: sumiu } = await admin
      .from('meta_conversion_jobs')
      .select('id')
      .eq('id', data!.id)
    expect((sumiu ?? []).length).toBe(0)
  })
})
