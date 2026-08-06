'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSessao } from '@/auth/session'
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

  revalidatePath(CAMINHO)
}
