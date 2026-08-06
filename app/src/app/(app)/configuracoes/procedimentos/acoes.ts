'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSessao } from '@/auth/session'
import { exigirDra } from '@/auth/guard'
import { createServerClient } from '@/lib/supabase/server'

const CAMINHO = '/configuracoes/procedimentos'

const schema = z.object({
  id: z.uuid().optional(),
  nome: z.string().trim().min(2, 'Informe o nome do procedimento'),
  duracaoMinutos: z.coerce.number().int().min(5).max(480),
  precoCentavos: z.coerce.number().int().min(0),
  // `null` = procedimento sem retorno. Note que `.nullable()` fica por fora do
  // `coerce`, senão `null` viraria 0 e "sem retorno" passaria a ter duas
  // representações — o banco recusa 0 justamente para evitar isso.
  retornoDias: z.coerce.number().int().positive().nullable(),
})

/**
 * Cria ou atualiza um procedimento.
 *
 * Server Action é endpoint público: a checagem de papel acontece aqui, não na
 * renderização. Esconder o botão no menu não é autorização. A RLS do banco é a
 * segunda camada — mesmo que esta checagem falhasse, a policy
 * "so a dra escreve procedimentos" barraria a escrita.
 */
export async function salvarProcedimento(entrada: unknown) {
  exigirDra(await getSessao())
  const dados = schema.parse(entrada)
  const supabase = await createServerClient()

  const linha = {
    nome: dados.nome,
    duracao_minutos: dados.duracaoMinutos,
    preco_centavos: dados.precoCentavos,
    default_return_interval_days: dados.retornoDias,
  }

  const { error } = dados.id
    ? await supabase.from('procedures').update(linha).eq('id', dados.id)
    : await supabase.from('procedures').insert(linha)

  if (error) throw new Error(`Não foi possível salvar o procedimento: ${error.message}`)
  revalidatePath(CAMINHO)
}

/**
 * Desativa em vez de apagar: procedimento antigo continua referenciado por
 * atendimentos já realizados, então ele sai da lista sem sair do histórico.
 */
export async function desativarProcedimento(id: string) {
  exigirDra(await getSessao())
  const idValido = z.uuid().parse(id)
  const supabase = await createServerClient()

  const { error } = await supabase.from('procedures').update({ ativo: false }).eq('id', idValido)
  if (error) throw new Error(`Não foi possível desativar: ${error.message}`)
  revalidatePath(CAMINHO)
}
