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

  // ---------------------------------------------------------------------------
  // Meta Conversions API — envio de conversão OPCIONAL
  // ---------------------------------------------------------------------------
  // Mesmo desenho do Google, pelo mesmo motivo e com a mesma consequência: hoje
  // a clínica não tem dataset nem token de CAPI, e o sistema roda inteiro assim.
  // Marcar como obrigatório derrubaria login, agenda e lembretes por causa de um
  // canal de marketing que ninguém ligou ainda.
  //
  // As DUAS primeiras andam juntas: `configuracaoDaMeta` só liga o envio quando
  // ambas estão presentes (ver `@/integrations/meta/capi`). Faltando qualquer
  // uma, o worker nem consulta a fila — não há log de pânico a cada ciclo.
  /** ID do dataset do Gerenciador de Eventos. É o `{DATASET_ID}` da URL da CAPI. */
  META_DATASET_ID: opcional(),
  /** Token de acesso gerado dentro do dataset. Segredo; nunca vai para a tela. */
  META_CAPI_TOKEN: opcional(),

  // As três abaixo são refinamentos, não interruptores: a integração liga sem
  // elas.
  /**
   * ID da conta do WhatsApp Business (WABA).
   *
   * Vai em `user_data.whatsapp_business_account_id`. NÃO está na lista oficial de
   * parâmetros de `user_data` da Meta, mas aparece no payload de todas as
   * integrações de terceiros de CTWA — ver o comentário em
   * `montarEventoDaCapi`. Opcional exatamente por causa dessa incerteza: com ela
   * o campo vai, sem ela o evento sai igual e a validação se faz no Teste de
   * Eventos.
   */
  META_WHATSAPP_BUSINESS_ACCOUNT_ID: opcional(),
  /**
   * Versão da Graph API na URL. Padrão em `VERSAO_PADRAO_DA_API`.
   *
   * Existe para o dia em que a versão fixada no código for descontinuada: trocar
   * uma variável no painel é mais rápido do que um deploy.
   */
  META_GRAPH_API_VERSION: opcional(),
  /**
   * Código da aba "Teste de Eventos" do Gerenciador.
   *
   * Preenchida, TODO evento passa a chegar como teste e NÃO conta como conversão
   * de verdade. É para a sessão de conferência do dia da configuração — a fonte
   * de verdade do plano — e precisa ser apagada depois.
   */
  META_TEST_EVENT_CODE: opcional(),

  // ---------------------------------------------------------------------------
  // Meta Marketing API — a página /marketing, OPCIONAL
  // ---------------------------------------------------------------------------
  // Terceiro interruptor independente dos dois de cima, e é de propósito: são
  // credenciais diferentes, com escopos diferentes, criadas em telas diferentes
  // do Business. O token da CAPI ESCREVE conversão no dataset; este aqui só LÊ
  // gasto da conta de anúncios. Ligar um não liga o outro, e a página de
  // marketing acende sozinha — sem dataset nenhum — assim que este existir.
  /**
   * Token de usuário do sistema com `ads_read`. Segredo; nunca vai para a tela.
   *
   * É o ÚNICO interruptor da página: sem ele a rota existe, explica o que falta
   * e não chama a Meta. Business → Usuários do sistema → gerar token.
   */
  META_ADS_TOKEN: opcional(),
  /**
   * ID da conta de anúncios, sem o prefixo `act_` (o adaptador acrescenta).
   *
   * NÃO é interruptor: em branco cai em `CONTA_DE_ANUNCIOS_PADRAO`, que é a
   * conta da clínica levantada no plano. Existe para o dia em que a conta mudar
   * — trocar variável no painel é mais rápido do que um deploy.
   */
  META_AD_ACCOUNT_ID: opcional(),
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
