'use server'

import { revalidatePath } from 'next/cache'
import { exigirDra } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import { reaisParaCentavos } from '@/app/(app)/configuracoes/procedimentos/formatacao'
import { dataDaClinica } from '@/lib/datetime'
import { anoMesDeData } from '@/lib/meta'
import { createServerClient } from '@/lib/supabase/server'

const CAMINHO = '/configuracoes/meta'

export type ResultadoDaMeta =
  | { ok: true; metaCentavos: number; anoMes: string }
  | { ok: false; erro: string }

/**
 * Grava a meta do mês corrente. Exclusiva da Dra. (`exigirDra` + RLS).
 * Upsert em `clinic_meta_mensal` e espelha em `clinic_settings` para o cartão
 * da sidebar continuar lendo um número global de fallback.
 * Aceita o mesmo formato de preço do catálogo (`1.800`, `R$ 45.000,00`).
 */
export async function salvarMetaDoMes(formData: FormData): Promise<ResultadoDaMeta> {
  const sessao = exigirDra(await getSessao())

  const bruto = String(formData.get('meta') ?? '')
  const centavos = reaisParaCentavos(bruto)
  if (centavos === null) {
    return { ok: false, erro: 'Informe um valor válido, por exemplo 45.000.' }
  }

  const anoMes = anoMesDeData(dataDaClinica(new Date()))
  const agora = new Date().toISOString()
  const supabase = await createServerClient()

  const { data: mensal, error: erroMensal } = await supabase
    .from('clinic_meta_mensal')
    .upsert(
      {
        ano_mes: anoMes,
        meta_centavos: centavos,
        atualizado_em: agora,
        atualizado_por: sessao.userId,
      },
      { onConflict: 'ano_mes' },
    )
    .select('meta_centavos, ano_mes')
    .single()

  if (erroMensal) {
    return { ok: false, erro: 'Não foi possível salvar a meta. Tente de novo.' }
  }

  // Espelho: sidebar / leituras antigas ainda usam clinic_settings.
  const { error: erroGlobal } = await supabase.from('clinic_settings').upsert(
    {
      id: true,
      meta_mensal_centavos: centavos,
      atualizado_em: agora,
    },
    { onConflict: 'id' },
  )

  if (erroGlobal) {
    return { ok: false, erro: 'Meta do mês salva, mas o espelho global falhou. Tente de novo.' }
  }

  revalidatePath(CAMINHO)
  // A casca lê a meta no layout de toda rota autenticada.
  revalidatePath('/', 'layout')

  return {
    ok: true,
    metaCentavos: mensal?.meta_centavos ?? centavos,
    anoMes: mensal?.ano_mes ?? anoMes,
  }
}
