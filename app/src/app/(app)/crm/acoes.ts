'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSessao } from '@/auth/session'
import { enfileirarConversoes } from '@/lib/conversoes'
import { createServerClient } from '@/lib/supabase/server'
import { ESTAGIOS, type PatientStage } from './estagios'

const CAMINHO = '/crm'

const schema = z.object({
  pacienteId: z.uuid(),
  estagio: z.enum(ESTAGIOS),
})

/**
 * Move o paciente de estágio no funil.
 *
 * Server Action é endpoint público — dá para chamá-la com um POST direto, sem
 * passar pelo kanban. Por isso a validação acontece aqui e não na tela: o
 * `z.enum(ESTAGIOS)` recusa qualquer estágio inventado antes de chegar ao
 * banco, e o `requireSessao()` recusa quem não está logado. O tipo
 * `patient_stage` e a RLS são a terceira e a quarta camadas.
 *
 * Não há checagem de papel: mover cartão no funil é o trabalho diário da
 * secretária, e a policy "equipe atualiza pacientes" reflete isso.
 */
export async function moverEstagio(pacienteId: string, estagio: PatientStage) {
  const sessao = await requireSessao()
  const dados = schema.parse({ pacienteId, estagio })
  const supabase = await createServerClient()

  // O estágio de ANTES, lido do banco e não recebido do cliente: é ele que diz
  // quantos degraus o cartão subiu, e portanto quantos eventos de conversão o
  // movimento gera. Aceitá-lo do caller deixaria um POST direto forjar uma
  // escada inteira de conversões. Falha na leitura vira `null`, que o domínio
  // trata como abaixo do primeiro degrau — e a chave de idempotência garante que
  // replanejar o que já saiu não duplica.
  const { data: antes } = await supabase
    .from('patients')
    .select('stage')
    .eq('id', dados.pacienteId)
    .single()

  // `.select()` para saber se alguma linha foi de fato afetada: sob RLS, um
  // update barrado volta sem erro e sem linha. Sem isso a tela mostraria
  // sucesso para uma movimentação que não aconteceu.
  const { data, error } = await supabase
    .from('patients')
    .update({ stage: dados.estagio })
    .eq('id', dados.pacienteId)
    .select('id')

  if (error) throw new Error(`Não foi possível mover o paciente: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('Paciente não encontrado ou movimentação não permitida.')
  }

  // `atualizado_em` não vai aqui: quem carimba é o trigger da 0004, para o
  // campo não depender de todo caller lembrar dele.
  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: `estagio:${dados.estagio}`,
    entidade: 'patients',
    registro_id: dados.pacienteId,
  })

  // Conversões para a Meta: o funil andou, o anúncio que trouxe esta paciente
  // merece o crédito. Efeito colateral best-effort e o último de todos.
  //
  // Sem try/catch aqui porque `enfileirarConversoes` já garante não lançar — o
  // try dela envolve até a leitura do ambiente. Sem consentimento, sem
  // `ctwa_clid` ou sem dataset configurado, ela sai calada: nada é enfileirado e
  // isso não é erro. O que NÃO pode acontecer é o cartão voltar para a coluna
  // antiga na tela da secretária porque a Meta está fora do ar.
  await enfileirarConversoes(supabase, {
    patientId: dados.pacienteId,
    estagioAnterior: (antes as { stage: string } | null)?.stage ?? null,
    estagioNovo: dados.estagio,
  })

  revalidatePath(CAMINHO)
}
