/**
 * Marca visual da clínica — foto do login e logo.
 *
 * ---------------------------------------------------------------------------
 * ONDE MORA O DADO
 * ---------------------------------------------------------------------------
 * Não há tabela ainda: migration não pode ser aplicada por quem escreve o
 * código. Arquivos ficam em `public/marca/uploads/` e o mapa em
 * `public/marca/marca.json`. O login e a tela de configuração leem daí.
 *
 * Quando virar Storage + `clinic_branding`, troque só este módulo — as telas
 * continuam pedindo `MarcaDaClinica`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type MarcaDaClinica = {
  /** Caminho público da foto do login, ou null. */
  heroUrl: string | null
  /** Caminho público da logo, ou null. */
  logoUrl: string | null
}

export const MARCA_VAZIA: MarcaDaClinica = { heroUrl: null, logoUrl: null }

const DIR_PUBLICO = path.join(process.cwd(), 'public', 'marca')
const DIR_UPLOADS = path.join(DIR_PUBLICO, 'uploads')
const ARQUIVO_MAPA = path.join(DIR_PUBLICO, 'marca.json')

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

function ehUrlPublicaDaMarca(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.startsWith('/marca/')
}

/** Lê o mapa. Arquivo ausente ou quebrado = clínica sem marca (estado normal). */
export async function carregarMarca(): Promise<MarcaDaClinica> {
  try {
    const bruto = await readFile(ARQUIVO_MAPA, 'utf8')
    const json = JSON.parse(bruto) as Partial<MarcaDaClinica>
    return {
      heroUrl: ehUrlPublicaDaMarca(json.heroUrl) ? json.heroUrl : null,
      logoUrl: ehUrlPublicaDaMarca(json.logoUrl) ? json.logoUrl : null,
    }
  } catch {
    return { ...MARCA_VAZIA }
  }
}

async function gravarMapa(marca: MarcaDaClinica): Promise<void> {
  await mkdir(DIR_PUBLICO, { recursive: true })
  await writeFile(ARQUIVO_MAPA, `${JSON.stringify(marca, null, 2)}\n`, 'utf8')
}

/**
 * Grava um arquivo em `uploads/` e devolve a URL pública.
 * Quem chama valida tipo/tamanho antes.
 */
export async function salvarArquivoDaMarca(
  bytes: Uint8Array,
  tipo: string,
  papel: 'hero' | 'logo',
): Promise<string> {
  const extensao = extensaoDoTipo(tipo)
  if (!extensao) throw new Error('Tipo de imagem não suportado.')

  await mkdir(DIR_UPLOADS, { recursive: true })
  const nome = `${papel}-${Date.now()}.${extensao}`
  await writeFile(path.join(DIR_UPLOADS, nome), bytes)
  return `/marca/uploads/${nome}`
}

export async function atualizarCampoDaMarca(
  campo: 'heroUrl' | 'logoUrl',
  url: string | null,
): Promise<MarcaDaClinica> {
  const atual = await carregarMarca()
  const proxima: MarcaDaClinica = { ...atual, [campo]: url }
  await gravarMapa(proxima)
  return proxima
}
