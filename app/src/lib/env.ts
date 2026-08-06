import { z } from 'zod'

const serverSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  EVOLUTION_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().email(),
  APP_TZ: z.string().min(1).default('America/Sao_Paulo'),
})

export type ServerEnv = z.infer<typeof serverSchema>

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const resultado = serverSchema.safeParse(raw)
  if (!resultado.success) {
    const detalhes = resultado.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Variáveis de ambiente inválidas — ${detalhes}`)
  }
  return resultado.data
}

let cache: ServerEnv | null = null

/** Só pode ser chamado em código de servidor ou do worker. */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() foi chamado no browser — isso vazaria segredos')
  }
  cache ??= parseServerEnv(process.env)
  return cache
}

export const publicEnv = {
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
}
