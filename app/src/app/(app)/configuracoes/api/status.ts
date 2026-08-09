/**
 * Status da chave da API para o painel (sem revelar plaintext).
 * Fora de `'use server'`: helper de leitura compartilhado.
 */

import { chaveDaApiHttp, serverEnv } from '@/lib/env'
import { createServerClient } from '@/lib/supabase/server'

export type StatusDaChaveApi = {
  chaveEnvConfigurada: boolean
  chaveBancoConfigurada: boolean
  prefixo: string | null
  criadoEm: string | null
  /**
   * Resumo para o cartão de status.
   * - `banco` — só hash no clinic_settings
   * - `env` — só variável Coolify
   * - `ambos` — os dois caminhos válidos
   * - `nenhuma` — /api/* só com sessão
   */
  fonte: 'banco' | 'env' | 'ambos' | 'nenhuma'
}

export async function carregarStatusDaChaveApi(): Promise<StatusDaChaveApi> {
  const chaveEnvConfigurada = Boolean(chaveDaApiHttp(serverEnv()))
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('clinic_settings')
    .select('api_key_hash, api_key_prefix, api_key_criado_em')
    .eq('id', true)
    .maybeSingle()

  const chaveBancoConfigurada = Boolean(data?.api_key_hash)
  const prefixo = typeof data?.api_key_prefix === 'string' ? data.api_key_prefix : null
  const criadoEm = typeof data?.api_key_criado_em === 'string' ? data.api_key_criado_em : null

  let fonte: StatusDaChaveApi['fonte'] = 'nenhuma'
  if (chaveBancoConfigurada && chaveEnvConfigurada) fonte = 'ambos'
  else if (chaveBancoConfigurada) fonte = 'banco'
  else if (chaveEnvConfigurada) fonte = 'env'

  return { chaveEnvConfigurada, chaveBancoConfigurada, prefixo, criadoEm, fonte }
}
