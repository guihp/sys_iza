/**
 * Marca visual da clínica — foto do login e logo.
 *
 * Arquivos no bucket `marca-clinica`. URLs + enquadramento (zoom + foco X/Y)
 * em `clinic_settings`. Login lê via service role.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type MarcaDaClinica = {
  heroUrl: string | null
  logoUrl: string | null
  /** Zoom da logo (0.5–4). 1 = padrão. */
  logoEscala: number
  /** Foco horizontal do recorte (0=esq, 100=dir). */
  logoPosX: number
  /** Foco vertical do recorte (0=topo, 100=base). */
  logoPosY: number
}

export type EnquadramentoDaLogo = {
  escala: number
  posX: number
  posY: number
}

export const LOGO_ESCALA_MIN = 0.5
export const LOGO_ESCALA_MAX = 4
export const LOGO_ESCALA_PADRAO = 1
export const LOGO_POS_PADRAO = 50

export const MARCA_VAZIA: MarcaDaClinica = {
  heroUrl: null,
  logoUrl: null,
  logoEscala: LOGO_ESCALA_PADRAO,
  logoPosX: LOGO_POS_PADRAO,
  logoPosY: LOGO_POS_PADRAO,
}

export const BUCKET_MARCA = 'marca-clinica'

const TIPOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024

const SELECT_MARCA = 'hero_url, logo_url, logo_escala, logo_pos_x, logo_pos_y'

export function extensaoDoTipo(tipo: string): string | null {
  return TIPOS[tipo] ?? null
}

export function normalizarEscalaDaLogo(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor)
  if (!Number.isFinite(n)) return LOGO_ESCALA_PADRAO
  const limitado = Math.min(LOGO_ESCALA_MAX, Math.max(LOGO_ESCALA_MIN, n))
  return Math.round(limitado * 100) / 100
}

export function normalizarPosicaoDaLogo(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor)
  if (!Number.isFinite(n)) return LOGO_POS_PADRAO
  const limitado = Math.min(100, Math.max(0, n))
  return Math.round(limitado * 100) / 100
}

export function normalizarEnquadramento(entrada: Partial<EnquadramentoDaLogo>): EnquadramentoDaLogo {
  return {
    escala: normalizarEscalaDaLogo(entrada.escala ?? LOGO_ESCALA_PADRAO),
    posX: normalizarPosicaoDaLogo(entrada.posX ?? LOGO_POS_PADRAO),
    posY: normalizarPosicaoDaLogo(entrada.posY ?? LOGO_POS_PADRAO),
  }
}

/**
 * Imagem no quadro fixo.
 * Zoom = `transform: scale` (não muda o layout). Quadro tem overflow:hidden.
 * `contain` + posição: com zoom 100% a arte cabe; com zoom >100% dá pra
 * aproximar e deslocar o foco sem empurrar o menu.
 */
export function estiloImagemDaLogo(enq: EnquadramentoDaLogo): {
  objectFit: 'contain'
  objectPosition: string
  transform: string
  transformOrigin: string
  width: string
  height: string
} {
  const e = normalizarEnquadramento(enq)
  return {
    objectFit: 'contain',
    objectPosition: `${e.posX}% ${e.posY}%`,
    transform: `scale(${e.escala})`,
    transformOrigin: `${e.posX}% ${e.posY}%`,
    width: '100%',
    height: '100%',
  }
}

/** Tamanho fixo do quadro (zoom NÃO altera — só o scale da img). */
export function tamanhoQuadroDaLogo(base: { alturaPx: number; larguraPx: number }): {
  height: string
  width: string
} {
  return {
    height: `${base.alturaPx}px`,
    width: `${base.larguraPx}px`,
  }
}

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

export function ehUrlDaMarca(valor: unknown): valor is string {
  if (typeof valor !== 'string' || valor.length === 0) return false
  if (valor.startsWith('/marca/')) return true
  return caminhoDoStoragePublico(valor) !== null
}

type LinhaMarca = {
  hero_url: string | null
  logo_url: string | null
  logo_escala?: number | string | null
  logo_pos_x?: number | string | null
  logo_pos_y?: number | string | null
}

function marcaDaLinha(linha: LinhaMarca | null): MarcaDaClinica {
  if (!linha) return { ...MARCA_VAZIA }
  return {
    heroUrl: ehUrlDaMarca(linha.hero_url) ? linha.hero_url : null,
    logoUrl: ehUrlDaMarca(linha.logo_url) ? linha.logo_url : null,
    logoEscala: normalizarEscalaDaLogo(linha.logo_escala ?? LOGO_ESCALA_PADRAO),
    logoPosX: normalizarPosicaoDaLogo(linha.logo_pos_x ?? LOGO_POS_PADRAO),
    logoPosY: normalizarPosicaoDaLogo(linha.logo_pos_y ?? LOGO_POS_PADRAO),
  }
}

export async function carregarMarca(): Promise<MarcaDaClinica> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('clinic_settings')
      .select(SELECT_MARCA)
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
    .select(SELECT_MARCA)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Falha ao gravar a marca.')
  }

  if (antiga && antiga !== url) {
    await apagarArquivoAntigo(antiga)
  }

  return marcaDaLinha(data as LinhaMarca)
}

export async function atualizarEnquadramentoDaLogo(
  entrada: Partial<EnquadramentoDaLogo>,
): Promise<MarcaDaClinica> {
  const e = normalizarEnquadramento(entrada)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('clinic_settings')
    .update({
      logo_escala: e.escala,
      logo_pos_x: e.posX,
      logo_pos_y: e.posY,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', true)
    .select(SELECT_MARCA)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Falha ao gravar o enquadramento da logo.')
  }

  return marcaDaLinha(data as LinhaMarca)
}

/** @deprecated use atualizarEnquadramentoDaLogo */
export async function atualizarEscalaDaLogo(escala: number): Promise<MarcaDaClinica> {
  const atual = await carregarMarca()
  return atualizarEnquadramentoDaLogo({
    escala,
    posX: atual.logoPosX,
    posY: atual.logoPosY,
  })
}
