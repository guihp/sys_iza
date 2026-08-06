import { createBrowserClient as createSPAClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'

/** Client do browser. Usa apenas a anon key — respeita a RLS. */
export function createBrowserClient() {
  return createSPAClient(publicEnv.SUPABASE_URL, publicEnv.SUPABASE_ANON_KEY)
}
