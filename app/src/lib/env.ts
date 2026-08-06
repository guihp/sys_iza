import { z } from 'zod'

/**
 * Variável que pode não existir.
 *
 * O `z.preprocess` não é decoração: painel de deploy — o Coolify inclusive —
 * grava variável não preenchida como string VAZIA, não como ausente. Sem
 * transformar `''` em `undefined`, um campo em branco viraria erro de validação
 * e `parseServerEnv` derrubaria o app inteiro na subida por causa de um recurso
 * que ninguém pediu para ligar.
 */
function opcional() {
  return z.preprocess(
    (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
    z.string().min(1).optional(),
  )
}

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

  // ---------------------------------------------------------------------------
  // Google Agenda — sincronia OPCIONAL (Task 12)
  // ---------------------------------------------------------------------------
  // Opcionais de propósito, e é o ponto todo: a clínica não tem projeto no
  // Google Cloud, e o sistema roda inteiro sem isso. Marcar como obrigatório
  // faria `parseServerEnv` lançar e derrubaria login, agenda e lembretes por
  // causa de um espelho de calendário.
  //
  // As três andam juntas: `configuracaoDoGoogle` só liga a sincronia quando
  // todas estão presentes (ver `@/integrations/google/calendar`).
  GOOGLE_SERVICE_ACCOUNT_EMAIL: opcional(),
  /** PEM da chave privada. Aceita `\n` escrito — o adaptador desdobra. */
  GOOGLE_PRIVATE_KEY: opcional(),
  /** E-mail da agenda de destino, compartilhada com a conta de serviço. */
  GOOGLE_CALENDAR_ID: opcional(),
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
