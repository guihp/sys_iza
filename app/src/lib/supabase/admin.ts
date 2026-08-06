import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

/**
 * Ignora a RLS. Usar SOMENTE no worker e em rotas de servidor que já
 * validaram o papel do usuário. Nunca importar em Client Component.
 */
export function createAdminClient() {
  const env = serverEnv()
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}
