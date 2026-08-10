'use server'

import { revalidatePath } from 'next/cache'
import { exigirDra, ErroDePermissao } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import {
  atualizarCampoDaMarca,
  atualizarEnquadramentoDaLogo,
  extensaoDoTipo,
  normalizarEnquadramento,
  salvarArquivoDaMarca,
  TAMANHO_MAXIMO_BYTES,
  type EnquadramentoDaLogo,
  type MarcaDaClinica,
} from '@/lib/marca'

export type ResultadoDaMarca =
  | { ok: true; marca: MarcaDaClinica }
  | { ok: false; erro: string }

async function exigirDraNaMarca() {
  const sessao = await getSessao()
  try {
    exigirDra(sessao)
  } catch (erro) {
    if (erro instanceof ErroDePermissao) return null
    throw erro
  }
  return sessao
}

function revalidarMarca() {
  revalidatePath('/login')
  revalidatePath('/configuracoes/marca')
  revalidatePath('/', 'layout')
  revalidatePath('/manifest.webmanifest')
}

async function gravarCampo(
  campo: 'heroUrl' | 'logoUrl',
  papel: 'hero' | 'logo',
  dados: FormData,
): Promise<ResultadoDaMarca> {
  if (!(await exigirDraNaMarca())) {
    return { ok: false, erro: 'Só a doutora altera a marca da clínica.' }
  }

  const arquivo = dados.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, erro: 'Escolha uma imagem (JPEG, PNG ou WebP).' }
  }
  if (!extensaoDoTipo(arquivo.type)) {
    return { ok: false, erro: 'Use JPEG, PNG ou WebP.' }
  }
  if (arquivo.size > TAMANHO_MAXIMO_BYTES) {
    return { ok: false, erro: 'A imagem precisa ter no máximo 5 MB.' }
  }

  try {
    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    const url = await salvarArquivoDaMarca(bytes, arquivo.type, papel)
    const marca = await atualizarCampoDaMarca(campo, url)
    revalidarMarca()
    return { ok: true, marca }
  } catch {
    return { ok: false, erro: 'Não foi possível salvar a imagem. Tente de novo.' }
  }
}

export async function salvarFotoDoLogin(dados: FormData): Promise<ResultadoDaMarca> {
  return gravarCampo('heroUrl', 'hero', dados)
}

export async function salvarLogo(dados: FormData): Promise<ResultadoDaMarca> {
  return gravarCampo('logoUrl', 'logo', dados)
}

export async function salvarEnquadramentoDaLogo(
  entrada: EnquadramentoDaLogo,
): Promise<ResultadoDaMarca> {
  if (!(await exigirDraNaMarca())) {
    return { ok: false, erro: 'Só a doutora altera a marca da clínica.' }
  }
  try {
    const marca = await atualizarEnquadramentoDaLogo(normalizarEnquadramento(entrada))
    revalidarMarca()
    return { ok: true, marca }
  } catch {
    return { ok: false, erro: 'Não foi possível salvar o enquadramento.' }
  }
}

/** Compat: só zoom (mantém posição atual no banco via lib). */
export async function salvarZoomDaLogo(escala: number): Promise<ResultadoDaMarca> {
  if (!(await exigirDraNaMarca())) {
    return { ok: false, erro: 'Só a doutora altera a marca da clínica.' }
  }
  try {
    const marca = await atualizarEnquadramentoDaLogo({ escala })
    revalidarMarca()
    return { ok: true, marca }
  } catch {
    return { ok: false, erro: 'Não foi possível salvar o zoom da logo.' }
  }
}

export async function removerFotoDoLogin(): Promise<ResultadoDaMarca> {
  if (!(await exigirDraNaMarca())) {
    return { ok: false, erro: 'Só a doutora altera a marca da clínica.' }
  }
  const marca = await atualizarCampoDaMarca('heroUrl', null)
  revalidarMarca()
  return { ok: true, marca }
}

export async function removerLogo(): Promise<ResultadoDaMarca> {
  if (!(await exigirDraNaMarca())) {
    return { ok: false, erro: 'Só a doutora altera a marca da clínica.' }
  }
  const marca = await atualizarCampoDaMarca('logoUrl', null)
  revalidarMarca()
  return { ok: true, marca }
}
