/**
 * Marca visual da clínica — foto do login e logo.
 *
 * ---------------------------------------------------------------------------
 * ONDE MORA O DADO
 * ---------------------------------------------------------------------------
 * Arquivos no bucket público `marca-clinica` (Supabase Storage). URLs em
 * `clinic_settings.hero_url` / `logo_url`. Login lê via service role (página
 * pública sem sessão).
 *
 * Antes: `public/marca/` em disco — quebra no Docker standalone (arquivo some,
 * mapa fica, browser toma 404).
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type MarcaDaClinica = {
  /** URL pública da foto do login, ou null. */
  heroUrl: string | null
  /** URL pública da logo, ou null. */
  logoUrl: string | null
}

export const MARCA_VAZIA: MarcaDaClinica = { heroUrl: null, logoUrl: null }

export const BUCKET_MARCA = 'marca-clinica'

const TIPOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Teto de 5 MB — foto de clínica não precisa de mais. */
export const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024

export function extensaoDoTipo(tipo: string): string | null {
  return TIPOS[tipo] ?? null
}

/**
 * Extrai o path do objeto a partir da URL pública do Storage.
 * Usado ao trocar/remover para apagar o arquivo antigo.
 */
export function caminhoDoStoragePublico(url: string): string | null {
  const marcador = `/storage/v1/object/public/${BUCKET_MARCA}/`
  const indice = url.indexOf(marcador)
  if (indice === -1) return null
  const bruto = url.slice(indice + marcador.length).split('?')[0] ?? ''
  if (!bruto) return null
  try {
    return decodeURIComponent(bruto)
  } catch {
    return bruto
  }
}

/** URL do bucket atual, ou caminho legado `/marca/` (pré-Storage). */
export function ehUrlDaMarca(valor: unknown): valor is string {
  if (typeof valor !== 'string' || valor.length === 0) return false
  if (valor.startsWith('/marca/')) return true
  return caminhoDoStoragePublico(valor) !== null
}

type LinhaMarca = {
  hero_url: string | null
  logo_url: string | null
}

function marcaDaLinha(linha: LinhaMarca | null): MarcaDaClinica {
  if (!linha) return { ...MARCA_VAZIA }
  return {
    heroUrl: ehUrlDaMarca(linha.hero_url) ? linha.hero_url : null,
    logoUrl: ehUrlDaMarca(linha.logo_url) ? linha.logo_url : null,
  }
}

/** Lê hero/logo. Service role: a tela de login não tem cookie de sessão. */
export async function carregarMarca(): Promise<MarcaDaClinica> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('clinic_settings')
      .select('hero_url, logo_url')
      .eq('id', true)
      .maybeSingle()
    if (error) return { ...MARCA_VAZIA }
    return marcaDaLinha(data as LinhaMarca | null)
  } catch {
    return { ...MARCA_VAZIA }
  }
}

async function apagarArquivoAntigo(url: string | null): Promise<void> {
  if (!url) return
  const path = caminhoDoStoragePublico(url)
  if (!path) return
  const supabase = createAdminClient()
  await supabase.storage.from(BUCKET_MARCA).remove([path])
}

/**
 * Sobe o arquivo no Storage e devolve a URL pública.
 * Quem chama valida tipo/tamanho e papel antes.
 */
export async function salvarArquivoDaMarca(
  bytes: Uint8Array,
  tipo: string,
  papel: 'hero' | 'logo',
): Promise<string> {
  const extensao = extensaoDoTipo(tipo)
  if (!extensao) throw new Error('Tipo de imagem não suportado.')

  const nome = `${papel}-${Date.now()}.${extensao}`
  const supabase = createAdminClient()
  const { error } = await supabase.storage.from(BUCKET_MARCA).upload(nome, bytes, {
    contentType: tipo,
    upsert: false,
  })
  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from(BUCKET_MARCA).getPublicUrl(nome)
  if (!data.publicUrl) throw new Error('Não foi possível montar a URL pública.')
  return data.publicUrl
}

export async function atualizarCampoDaMarca(
  campo: 'heroUrl' | 'logoUrl',
  url: string | null,
): Promise<MarcaDaClinica> {
  const coluna = campo === 'heroUrl' ? 'hero_url' : 'logo_url'
  const atual = await carregarMarca()
  const antiga = atual[campo]

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('clinic_settings')
    .update({
      [coluna]: url,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', true)
    .select('hero_url, logo_url')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Falha ao gravar a marca.')
  }

  if (antiga && antiga !== url) {
    await apagarArquivoAntigo(antiga)
  }

  return marcaDaLinha(data as LinhaMarca)
}
