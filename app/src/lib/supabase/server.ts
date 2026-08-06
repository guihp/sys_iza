import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { publicEnv } from '@/lib/env'

/**
 * Client autenticado pelo cookie de sessão. Respeita a RLS — é o client
 * padrão de Server Components, Server Actions e Route Handlers.
 */
export async function createServerClient() {
  const store = await cookies()
  return createSSRClient(publicEnv.SUPABASE_URL, publicEnv.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          // Chamado de um Server Component — o middleware já renova a sessão.
        }
      },
    },
  })
}
