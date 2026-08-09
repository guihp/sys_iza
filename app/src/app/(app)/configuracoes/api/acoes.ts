'use server'

import { revalidatePath } from 'next/cache'
import { ErroDePermissao, exigirDra } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import {
  gerarPlaintextDaChaveApi,
  hashDaChaveApi,
  prefixoDaChaveApi,
} from '@/lib/api/chave-api-hash'
import { createServerClient } from '@/lib/supabase/server'

const CAMINHO = '/configuracoes/api'

export type ResultadoDaChaveApi =
  | { ok: true; chave: string; prefixo: string; criadoEm: string }
  | { ok: false; erro: string }

/**
 * Gera (ou regenera) a chave no painel. Só a Dra.
 * Grava hash + prefixo em `clinic_settings`; plaintext só na resposta.
 */
export async function gerarChaveDaApi(): Promise<ResultadoDaChaveApi> {
  return gravarNovaChave()
}

/**
 * Rotaciona a chave (mesmo fluxo de gerar — invalida a anterior no banco).
 * Só a Dra. A chave de env (Coolify), se existir, continua válida.
 */
export async function rotacionarChaveDaApi(): Promise<ResultadoDaChaveApi> {
  return gravarNovaChave()
}

async function gravarNovaChave(): Promise<ResultadoDaChaveApi> {
  try {
    exigirDra(await getSessao())
  } catch (erro) {
    if (erro instanceof ErroDePermissao) {
      return { ok: false, erro: erro.message }
    }
    throw erro
  }

  const chave = gerarPlaintextDaChaveApi()
  const hash = hashDaChaveApi(chave)
  const prefixo = prefixoDaChaveApi(chave)
  const criadoEm = new Date().toISOString()
  const supabase = await createServerClient()

  // Update (não upsert): a linha única já existe desde 0017; upsert sem
  // meta_mensal_centavos arriscaria resetar outros campos no insert.
  const { error } = await supabase
    .from('clinic_settings')
    .update({
      api_key_hash: hash,
      api_key_prefix: prefixo,
      api_key_criado_em: criadoEm,
      atualizado_em: criadoEm,
    })
    .eq('id', true)

  if (error) {
    return { ok: false, erro: 'Não foi possível gravar a chave. Tente de novo.' }
  }

  revalidatePath(CAMINHO)
  return { ok: true, chave, prefixo, criadoEm }
}
