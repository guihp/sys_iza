/**
 * Leitura das configurações da clínica (`clinic_settings` + `clinic_meta_mensal`).
 *
 * Separado das Server Actions: a casca e a aba Meta precisam do mesmo número,
 * e um arquivo `'use server'` não pode ser o lugar de um helper de leitura
 * compartilhado sem virar action exportada à toa.
 */

import { dataDaClinica } from '@/lib/datetime'
import { anoMesDeData, META_MENSAL_CENTAVOS } from '@/lib/meta'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Meta global em `clinic_settings` (espelho / seed). Se a tabela falhar,
 * devolve o fallback constante.
 */
export async function carregarMetaGlobalCentavos(): Promise<number> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('clinic_settings')
    .select('meta_mensal_centavos')
    .eq('id', true)
    .maybeSingle()

  if (error || data?.meta_mensal_centavos == null) {
    return META_MENSAL_CENTAVOS
  }

  return data.meta_mensal_centavos
}

/**
 * Meta do mês (`YYYY-MM`). Preferência: linha em `clinic_meta_mensal`;
 * senão `clinic_settings`; senão constante. Sem `anoMes`, usa o mês corrente
 * no calendário da clínica.
 */
export async function carregarMetaDoMesCentavos(anoMes?: string): Promise<number> {
  const mes = anoMes ?? anoMesDeData(dataDaClinica(new Date()))
  const supabase = await createServerClient()

  const { data: mensal, error: erroMensal } = await supabase
    .from('clinic_meta_mensal')
    .select('meta_centavos')
    .eq('ano_mes', mes)
    .maybeSingle()

  if (!erroMensal && mensal?.meta_centavos != null) {
    return mensal.meta_centavos
  }

  return carregarMetaGlobalCentavos()
}

/**
 * Meta do mês corrente para o cartão da sidebar.
 * Alias explícito: a casca não precisa saber de `YYYY-MM`.
 */
export async function carregarMetaMensalCentavos(): Promise<number> {
  return carregarMetaDoMesCentavos()
}
