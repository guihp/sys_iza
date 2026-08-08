/**
 * Pasta clínica: fotos e arquivos no bucket privado `paciente-arquivos`.
 *
 * URLs públicas nunca. Leitura sempre por URL assinada de curta duração.
 * Upload e metadados passam pela Server Action autenticada + RLS.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const BUCKET_PACIENTE = 'paciente-arquivos'

/** 15 minutos — tempo de uma consulta na tela, sem reutilizar link depois. */
export const URL_ASSINADA_SEGUNDOS = 15 * 60

export const TAMANHO_MAXIMO_ARQUIVO_BYTES = 15 * 1024 * 1024

const TIPOS_IMAGEM: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const TIPOS_ARQUIVO: Record<string, string> = {
  ...TIPOS_IMAGEM,
  'application/pdf': 'pdf',
}

export function extensaoDeMime(tipo: string, soImagem = false): string | null {
  const mapa = soImagem ? TIPOS_IMAGEM : TIPOS_ARQUIVO
  return mapa[tipo] ?? null
}

/**
 * Caminho no bucket: `{patientId}/fotos|arquivos/{uuid}.{ext}`.
 * Prefixo por paciente facilita políticas futuras e limpeza sob LGPD.
 */
export function caminhoNoBucket(
  pacienteId: string,
  pasta: 'fotos' | 'arquivos',
  nomeArquivo: string,
): string {
  return `${pacienteId}/${pasta}/${nomeArquivo}`
}

export async function subirArquivoDoPaciente(
  supabase: SupabaseClient,
  {
    pacienteId,
    pasta,
    bytes,
    mimeType,
    nomeArquivo,
  }: {
    pacienteId: string
    pasta: 'fotos' | 'arquivos'
    bytes: Uint8Array
    mimeType: string
    nomeArquivo: string
  },
): Promise<{ path: string } | { erro: string }> {
  const path = caminhoNoBucket(pacienteId, pasta, nomeArquivo)
  const { error } = await supabase.storage.from(BUCKET_PACIENTE).upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  })
  if (error) return { erro: error.message }
  return { path }
}

export async function urlAssinadaDoArquivo(
  supabase: SupabaseClient,
  path: string,
  segundos = URL_ASSINADA_SEGUNDOS,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_PACIENTE)
    .createSignedUrl(path, segundos)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function removerArquivoDoPaciente(
  supabase: SupabaseClient,
  path: string,
): Promise<{ ok: true } | { erro: string }> {
  const { error } = await supabase.storage.from(BUCKET_PACIENTE).remove([path])
  if (error) return { erro: error.message }
  return { ok: true }
}
