import { describe, expect, it } from 'vitest'
import { parseServerEnv } from '@/lib/env'

const completo = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  EVOLUTION_URL: 'http://evolution:8080',
  EVOLUTION_API_KEY: 'key',
  EVOLUTION_INSTANCE: 'clinica',
  RESEND_API_KEY: 're_123',
  EMAIL_FROM: 'contato@clinicaizadora.com.br',
}

describe('parseServerEnv', () => {
  it('aceita um ambiente completo e assume America/Sao_Paulo por padrão', () => {
    const env = parseServerEnv(completo)
    expect(env.EVOLUTION_INSTANCE).toBe('clinica')
    expect(env.APP_TZ).toBe('America/Sao_Paulo')
  })

  it('lança erro nomeando a variável faltante', () => {
    const { EVOLUTION_API_KEY, ...incompleto } = completo
    expect(() => parseServerEnv(incompleto)).toThrow(/EVOLUTION_API_KEY/)
  })

  it('rejeita EMAIL_FROM que não seja e-mail', () => {
    expect(() => parseServerEnv({ ...completo, EMAIL_FROM: 'nao-e-email' })).toThrow(/EMAIL_FROM/)
  })
})

describe('parseServerEnv — Google Agenda opcional', () => {
  it('sobe sem nenhuma variável do Google', () => {
    // A clínica não tem projeto no Google Cloud, e o sistema roda inteiro
    // assim. Se estas variáveis fossem obrigatórias, `parseServerEnv` lançaria
    // e derrubaria login, agenda e lembretes junto.
    const env = parseServerEnv(completo)
    expect(env.GOOGLE_SERVICE_ACCOUNT_EMAIL).toBeUndefined()
    expect(env.GOOGLE_PRIVATE_KEY).toBeUndefined()
    expect(env.GOOGLE_CALENDAR_ID).toBeUndefined()
  })

  it('trata variável vazia como ausente', () => {
    // Painel de deploy grava campo em branco como string vazia, não como
    // ausente. Sem esta normalização, deixar o campo do Google visível e vazio
    // no Coolify quebraria a subida do container.
    const env = parseServerEnv({
      ...completo,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
      GOOGLE_PRIVATE_KEY: '   ',
      GOOGLE_CALENDAR_ID: '',
    })
    expect(env.GOOGLE_SERVICE_ACCOUNT_EMAIL).toBeUndefined()
    expect(env.GOOGLE_PRIVATE_KEY).toBeUndefined()
    expect(env.GOOGLE_CALENDAR_ID).toBeUndefined()
  })

  it('aceita as três quando a sincronia é ligada', () => {
    const env = parseServerEnv({
      ...completo,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'agenda@x.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      GOOGLE_CALENDAR_ID: 'izadora@clinicaizadora.com.br',
    })
    expect(env.GOOGLE_CALENDAR_ID).toBe('izadora@clinicaizadora.com.br')
  })
})

describe('parseServerEnv — Meta Conversions API opcional', () => {
  it('sobe sem nenhuma variável da Meta', () => {
    // Não há dataset nem token de CAPI, e não vai haver até a Dra. criar os
    // dois. Obrigatórias, estas variáveis derrubariam login, agenda e lembretes
    // por causa de um canal de marketing que ninguém ligou.
    const env = parseServerEnv(completo)
    expect(env.META_DATASET_ID).toBeUndefined()
    expect(env.META_CAPI_TOKEN).toBeUndefined()
    expect(env.META_WHATSAPP_BUSINESS_ACCOUNT_ID).toBeUndefined()
    expect(env.META_GRAPH_API_VERSION).toBeUndefined()
    expect(env.META_TEST_EVENT_CODE).toBeUndefined()
  })

  it('trata variável vazia como ausente', () => {
    // Deixar os campos da Meta visíveis e em branco no painel do Coolify não
    // pode quebrar a subida do container.
    const env = parseServerEnv({
      ...completo,
      META_DATASET_ID: '',
      META_CAPI_TOKEN: '   ',
      META_TEST_EVENT_CODE: '',
    })
    expect(env.META_DATASET_ID).toBeUndefined()
    expect(env.META_CAPI_TOKEN).toBeUndefined()
    expect(env.META_TEST_EVENT_CODE).toBeUndefined()
  })

  it('aceita o par que liga o envio', () => {
    const env = parseServerEnv({
      ...completo,
      META_DATASET_ID: '1234567890',
      META_CAPI_TOKEN: 'EAAG0token',
    })
    expect(env.META_DATASET_ID).toBe('1234567890')
    expect(env.META_CAPI_TOKEN).toBe('EAAG0token')
  })
})
