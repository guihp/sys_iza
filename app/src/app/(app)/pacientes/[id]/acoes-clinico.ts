'use server'

import { z } from 'zod'
import { exigirDra, ErroDePermissao } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import { booleanoDoForm, textoOpcional } from '../campos'
import type { ResultadoDaAcao } from './tipos'

async function sessaoDra(): Promise<{ userId: string } | { erro: string }> {
  try {
    return exigirDra(await getSessao())
  } catch (erro) {
    if (erro instanceof ErroDePermissao) {
      return { erro: 'Só a Dra. grava dado clínico.' }
    }
    throw erro
  }
}

function simNao(valor: FormDataEntryValue | null): boolean | null {
  const t = typeof valor === 'string' ? valor : ''
  if (t === 'sim') return true
  if (t === 'nao') return false
  return null
}

function enumOuNull<T extends string>(
  valor: FormDataEntryValue | null,
  opcoes: readonly T[],
): T | null {
  const t = textoOpcional(valor)
  if (!t) return null
  return (opcoes as readonly string[]).includes(t) ? (t as T) : null
}

function numeroOpcional(valor: FormDataEntryValue | null): number | null {
  const t = textoOpcional(valor)
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function inteiroOpcional(valor: FormDataEntryValue | null): number | null {
  const n = numeroOpcional(valor)
  if (n == null) return null
  return Number.isInteger(n) ? n : null
}

/**
 * Upsert da anamnese (págs. 1–2). Uma linha por paciente.
 */
export async function salvarAnamnese(formData: FormData): Promise<ResultadoDaAcao> {
  const sessao = await sessaoDra()
  if ('erro' in sessao) return { ok: false, erro: sessao.erro }

  const pacienteId = z.uuid().safeParse(formData.get('pacienteId'))
  if (!pacienteId.success) return { ok: false, erro: 'Paciente inválido.' }

  const linha = {
    patient_id: pacienteId.data,
    queixa_principal: textoOpcional(formData.get('queixa_principal')),
    autoconfianca_rosto: textoOpcional(formData.get('autoconfianca_rosto')),
    incomodo_rosto: textoOpcional(formData.get('incomodo_rosto')),
    rosto_cansado: simNao(formData.get('rosto_cansado')),
    prev_botox: booleanoDoForm(formData.get('prev_botox')),
    prev_acido_hialuronico: booleanoDoForm(formData.get('prev_acido_hialuronico')),
    prev_bioestimulador: booleanoDoForm(formData.get('prev_bioestimulador')),
    prev_fios: booleanoDoForm(formData.get('prev_fios')),
    prev_pmma: booleanoDoForm(formData.get('prev_pmma')),
    prev_cirurgia: booleanoDoForm(formData.get('prev_cirurgia')),
    prev_outros: booleanoDoForm(formData.get('prev_outros')),
    prev_outros_texto: textoOpcional(formData.get('prev_outros_texto')),
    ultimo_procedimento: textoOpcional(formData.get('ultimo_procedimento')),
    ultimo_procedimento_regiao: textoOpcional(formData.get('ultimo_procedimento_regiao')),
    tratamento_medico_atual: textoOpcional(formData.get('tratamento_medico_atual')),
    medicacao_continua: textoOpcional(formData.get('medicacao_continua')),
    alergias: textoOpcional(formData.get('alergias')),
    doenca_diabetes: booleanoDoForm(formData.get('doenca_diabetes')),
    doenca_hipertensao: booleanoDoForm(formData.get('doenca_hipertensao')),
    doenca_cardiaca: booleanoDoForm(formData.get('doenca_cardiaca')),
    doenca_autoimune: booleanoDoForm(formData.get('doenca_autoimune')),
    doenca_tireoide: booleanoDoForm(formData.get('doenca_tireoide')),
    doenca_hepatica: booleanoDoForm(formData.get('doenca_hepatica')),
    doenca_renal: booleanoDoForm(formData.get('doenca_renal')),
    doenca_coagulacao: booleanoDoForm(formData.get('doenca_coagulacao')),
    doenca_osteoporose: booleanoDoForm(formData.get('doenca_osteoporose')),
    doenca_asma_bronquite: booleanoDoForm(formData.get('doenca_asma_bronquite')),
    doenca_epilepsia: booleanoDoForm(formData.get('doenca_epilepsia')),
    doenca_cancer: booleanoDoForm(formData.get('doenca_cancer')),
    doenca_outra: booleanoDoForm(formData.get('doenca_outra')),
    doenca_outra_texto: textoOpcional(formData.get('doenca_outra_texto')),
    gestacao_amamentacao: enumOuNull(formData.get('gestacao_amamentacao'), [
      'nao',
      'gestante',
      'amamentando',
    ] as const),
    fuma: simNao(formData.get('fuma')),
    alcool_frequente: simNao(formData.get('alcool_frequente')),
    ingere_agua: textoOpcional(formData.get('ingere_agua')),
    exercicios_fisicos: textoOpcional(formData.get('exercicios_fisicos')),
    boa_alimentacao: textoOpcional(formData.get('boa_alimentacao')),
    sono: enumOuNull(formData.get('sono'), ['bom', 'regular', 'ruim'] as const),
    pele_declarada: enumOuNull(formData.get('pele_declarada'), [
      'seca',
      'oleosa',
      'mista',
      'sensivel',
    ] as const),
    incomoda_flacidez: booleanoDoForm(formData.get('incomoda_flacidez')),
    incomoda_linhas: booleanoDoForm(formData.get('incomoda_linhas')),
    incomoda_manchas: booleanoDoForm(formData.get('incomoda_manchas')),
    incomoda_poros: booleanoDoForm(formData.get('incomoda_poros')),
    incomoda_falta_vico: booleanoDoForm(formData.get('incomoda_falta_vico')),
    incomoda_outro: booleanoDoForm(formData.get('incomoda_outro')),
    incomoda_outro_texto: textoOpcional(formData.get('incomoda_outro_texto')),
    protetor_solar_diario: simNao(formData.get('protetor_solar_diario')),
    acidos_cosmeticos: textoOpcional(formData.get('acidos_cosmeticos')),
    roacutan_retinoides: simNao(formData.get('roacutan_retinoides')),
    reacao_cosmeticos_procedimentos: simNao(formData.get('reacao_cosmeticos_procedimentos')),
    reacao_detalhe: textoOpcional(formData.get('reacao_detalhe')),
    medico_assistente_nome: textoOpcional(formData.get('medico_assistente_nome')),
    medico_assistente_telefone: textoOpcional(formData.get('medico_assistente_telefone')),
    registrado_por: sessao.userId,
  }

  const supabase = await createServerClient()
  const { error } = await supabase.from('anamneses').upsert(linha, { onConflict: 'patient_id' })

  if (error) {
    return { ok: false, erro: 'Não foi possível salvar a anamnese. Tente de novo.' }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'anamnese:salva',
    entidade: 'anamneses',
    registro_id: pacienteId.data,
  })

  // Sem revalidatePath — evita remount mid-edit; troca de aba recarrega.
  return { ok: true }
}

/**
 * Upsert da avaliação de pele (pág. 3).
 */
export async function salvarAvaliacao(formData: FormData): Promise<ResultadoDaAcao> {
  const sessao = await sessaoDra()
  if ('erro' in sessao) return { ok: false, erro: sessao.erro }

  const pacienteId = z.uuid().safeParse(formData.get('pacienteId'))
  if (!pacienteId.success) return { ok: false, erro: 'Paciente inválido.' }

  const linha = {
    patient_id: pacienteId.data,
    pig_melasma_manchas: booleanoDoForm(formData.get('pig_melasma_manchas')),
    pig_hipopigmentacao: booleanoDoForm(formData.get('pig_hipopigmentacao')),
    pig_sardas: booleanoDoForm(formData.get('pig_sardas')),
    vas_eritema: booleanoDoForm(formData.get('vas_eritema')),
    vas_telangiectasias: booleanoDoForm(formData.get('vas_telangiectasias')),
    vas_hematoma: booleanoDoForm(formData.get('vas_hematoma')),
    les_acne: booleanoDoForm(formData.get('les_acne')),
    les_comedoes: booleanoDoForm(formData.get('les_comedoes')),
    les_verrugas: booleanoDoForm(formData.get('les_verrugas')),
    les_nodulos: booleanoDoForm(formData.get('les_nodulos')),
    les_feridas_ulceras: booleanoDoForm(formData.get('les_feridas_ulceras')),
    les_descamacao: booleanoDoForm(formData.get('les_descamacao')),
    cic_atrofica: booleanoDoForm(formData.get('cic_atrofica')),
    cic_hipertrofica: booleanoDoForm(formData.get('cic_hipertrofica')),
    cic_queloide: booleanoDoForm(formData.get('cic_queloide')),
    biotipo: enumOuNull(formData.get('biotipo'), ['normal', 'seca', 'oleosa', 'mista'] as const),
    hidratacao: enumOuNull(formData.get('hidratacao'), ['adequada', 'desidratada'] as const),
    espessura: enumOuNull(formData.get('espessura'), ['fina', 'normal', 'espessa'] as const),
    fototipo: enumOuNull(formData.get('fototipo'), ['I', 'II', 'III', 'IV', 'V', 'VI'] as const),
    cor_pele: enumOuNull(formData.get('cor_pele'), ['branca', 'parda', 'preta'] as const),
    textura_lisa: booleanoDoForm(formData.get('textura_lisa')),
    textura_aspera: booleanoDoForm(formData.get('textura_aspera')),
    textura_flacida: booleanoDoForm(formData.get('textura_flacida')),
    textura_rugas_finas: booleanoDoForm(formData.get('textura_rugas_finas')),
    acne: enumOuNull(formData.get('acne'), ['ausente', 'I', 'II', 'III'] as const),
    glogau: enumOuNull(formData.get('glogau'), ['leve', 'moderado', 'avancado', 'severo'] as const),
    rugas_dinamicas: booleanoDoForm(formData.get('rugas_dinamicas')),
    rugas_estaticas: booleanoDoForm(formData.get('rugas_estaticas')),
    rugas_superficiais: booleanoDoForm(formData.get('rugas_superficiais')),
    rugas_profundas: booleanoDoForm(formData.get('rugas_profundas')),
    estado_geral: textoOpcional(formData.get('estado_geral')),
    peso_kg: numeroOpcional(formData.get('peso_kg')),
    altura_m: numeroOpcional(formData.get('altura_m')),
    fc_bpm: inteiroOpcional(formData.get('fc_bpm')),
    pa_mmhg: textoOpcional(formData.get('pa_mmhg')),
    ritmo_respiratorio: textoOpcional(formData.get('ritmo_respiratorio')),
    marcha: enumOuNull(formData.get('marcha'), ['normal', 'dificuldade', 'cadeirante'] as const),
    musculos_mastigacao: textoOpcional(formData.get('musculos_mastigacao')),
    registrado_por: sessao.userId,
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('skin_assessments')
    .upsert(linha, { onConflict: 'patient_id' })

  if (error) {
    return { ok: false, erro: 'Não foi possível salvar a avaliação. Tente de novo.' }
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'avaliacao:salva',
    entidade: 'skin_assessments',
    registro_id: pacienteId.data,
  })

  // Sem revalidatePath — evita remount mid-edit; troca de aba recarrega.
  return { ok: true }
}
