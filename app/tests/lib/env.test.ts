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
