'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirDra } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import { statusCobranca, type StatusParcela } from '@/domain/finance/cobranca'
import { createServerClient } from '@/lib/supabase/server'

const CAMINHO = '/financeiro'

/**
 * Marca uma parcela como paga e recalcula o status da cobrança.
 *
 * A tela `/financeiro` não expõe botão de baixa: parcelas no cartão seguem o
 * vencimento. Esta action permanece para uso pontual (scripts / futuro) —
 * `exigirDra` + RLS ("so a dra edita parcela") são as duas camadas.
 */
export async function marcarParcelaPaga(parcelaId: string) {
  const sessao = exigirDra(await getSessao())
  const id = z.uuid().parse(parcelaId)
  const supabase = await createServerClient()

  const { data: parcela, error: erroLeitura } = await supabase
    .from('payment_installments')
    .select('id, charge_id, status')
    .eq('id', id)
    .maybeSingle()

  if (erroLeitura) {
    throw new Error(`Não foi possível ler a parcela: ${erroLeitura.message}`)
  }
  if (!parcela) {
    throw new Error('Parcela não encontrada.')
  }
  if (parcela.status === 'pago') {
    revalidatePath(CAMINHO)
    return
  }

  const agora = new Date().toISOString()
  const { data: atualizada, error } = await supabase
    .from('payment_installments')
    .update({ status: 'pago', pago_em: agora })
    .eq('id', id)
    .select('id')

  if (error) {
    throw new Error(`Não foi possível marcar a parcela como paga: ${error.message}`)
  }
  if (!atualizada || atualizada.length === 0) {
    throw new Error('Parcela não encontrada ou atualização não permitida.')
  }

  const { data: cobranca, error: erroCobranca } = await supabase
    .from('patient_charges')
    .select('id, valor_entrada_centavos, valor_proxima_consulta_centavos, payment_installments(status)')
    .eq('id', parcela.charge_id)
    .maybeSingle()

  if (erroCobranca) {
    throw new Error(`Não foi possível recalcular a cobrança: ${erroCobranca.message}`)
  }
  if (cobranca) {
    const parcelas = (
      cobranca.payment_installments as { status: StatusParcela }[] | null
    ) ?? []
    const novoStatus = statusCobranca({
      valor_entrada_centavos: cobranca.valor_entrada_centavos,
      valor_proxima_consulta_centavos: cobranca.valor_proxima_consulta_centavos,
      parcelas,
    })

    const { error: erroStatus } = await supabase
      .from('patient_charges')
      .update({ status: novoStatus })
      .eq('id', cobranca.id)

    if (erroStatus) {
      throw new Error(`Não foi possível atualizar o status da cobrança: ${erroStatus.message}`)
    }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'parcela:paga',
    entidade: 'payment_installments',
    registro_id: id,
  })

  revalidatePath(CAMINHO)
}
