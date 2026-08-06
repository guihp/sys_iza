'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirDra } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import type { Canal, ReminderKind } from '@/domain/reminders/plan-reminders'
import { createServerClient } from '@/lib/supabase/server'
import { validarTemplate } from './mensagens'

const CAMINHO = '/configuracoes/mensagens'

const KINDS = [
  'confirmacao',
  'vespera_curta',
  'pos_procedimento',
  'avaliacao',
  'retorno',
] as const satisfies readonly ReminderKind[]

const CANAIS = ['whatsapp', 'email'] as const satisfies readonly Canal[]

const schema = z.object({
  kind: z.enum(KINDS),
  channel: z.enum(CANAIS),
  // `nullable` sem `trim` obrigatório: quem apara é `validarTemplate`, para que
  // a regra de "e-mail exige assunto" viva num lugar só e seja testável sem zod.
  assunto: z.string().nullable(),
  corpo: z.string(),
})

const chaveSchema = z.object({
  kind: z.enum(KINDS),
  channel: z.enum(CANAIS),
})

/**
 * Grava o texto de um lembrete.
 *
 * Server Action é endpoint público: a checagem de papel acontece aqui, não na
 * página. Esconder o link no menu não é autorização, e `notFound()` na página
 * também não — as duas coisas só evitam que a secretária tropece numa tela que
 * não é dela. Quem barra a escrita é este `exigirDra` e, atrás dele, a policy
 * "so a dra edita template" da migration 0007.
 *
 * `validarTemplate` roda de novo aqui, mesmo o editor já tendo rodado no
 * browser: a validação do cliente é conforto, não defesa. Sem esta chamada, um
 * POST forjado com corpo vazio ou com assunto num template de WhatsApp bateria
 * na constraint do Postgres e voltaria como erro 500 sem explicação.
 *
 * `upsert` e não `update`: as sete linhas vêm semeadas pela migration, mas um
 * `update` que não encontra linha nenhuma devolve sucesso com zero linhas
 * afetadas — a Dra. veria "Salvo" e o texto continuaria o antigo.
 */
export async function salvarTemplate(entrada: unknown) {
  exigirDra(await getSessao())

  const dados = schema.parse(entrada)
  const validacao = validarTemplate(dados)
  if (!validacao.ok) throw new Error(validacao.erro)

  const supabase = await createServerClient()
  const { error } = await supabase.from('message_templates').upsert(
    {
      kind: validacao.valor.kind,
      channel: validacao.valor.channel,
      assunto: validacao.valor.assunto,
      corpo: validacao.valor.corpo,
    },
    { onConflict: 'kind,channel' },
  )

  if (error) throw new Error(`Não foi possível salvar a mensagem: ${error.message}`)
  revalidatePath(CAMINHO)
}

/**
 * Liga e desliga um lembrete sem apagar o texto.
 *
 * É o caminho certo para parar de enviar: o worker pula o template inativo
 * (`.eq('ativo', true)` em `worker/fila.ts`) e a redação fica guardada para
 * quando a Dra. religar. Apagar a linha deixaria o worker sem o que enviar
 * naquele tipo e falharia job por job.
 */
export async function alternarTemplate(entrada: unknown, ativo: boolean) {
  exigirDra(await getSessao())

  const chave = chaveSchema.parse(entrada)
  const ativoValido = z.boolean().parse(ativo)

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('message_templates')
    .update({ ativo: ativoValido })
    .eq('kind', chave.kind)
    .eq('channel', chave.channel)
    .select('kind')

  if (error) throw new Error(`Não foi possível alterar a mensagem: ${error.message}`)
  // Zero linhas aqui não é erro do Postgres: é a RLS recusando em silêncio, ou o
  // par (kind, channel) não existindo. Nos dois casos nada mudou, e devolver
  // sucesso faria a tela mentir.
  if (!data || data.length === 0) throw new Error('Mensagem não encontrada para alterar.')

  revalidatePath(CAMINHO)
}
