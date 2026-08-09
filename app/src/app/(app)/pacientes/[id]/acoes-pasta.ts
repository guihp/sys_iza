'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirDra, ErroDePermissao } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import { ehAnguloFoto } from '@/domain/clinical/prontuario'
import {
  extensaoDeMime,
  removerArquivoDoPaciente,
  subirArquivoDoPaciente,
  TAMANHO_MAXIMO_ARQUIVO_BYTES,
  tituloDeNomeArquivo,
} from '@/lib/pasta-paciente'
import { createServerClient } from '@/lib/supabase/server'
import { textoOpcional } from '../campos'
import type { ResultadoDaAcao } from './tipos'

async function sessaoDra() {
  try {
    return exigirDra(await getSessao())
  } catch (erro) {
    if (erro instanceof ErroDePermissao) return null
    throw erro
  }
}

export async function subirFoto(formData: FormData): Promise<ResultadoDaAcao> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. sobe fotos clínicas.' }

  const pacienteId = z.uuid().safeParse(formData.get('pacienteId'))
  if (!pacienteId.success) return { ok: false, erro: 'Paciente inválido.' }

  const anguloBruto = formData.get('angulo')
  // Upload unificado: ângulo opcional — default `frontal` (enum + default do banco).
  const angulo = ehAnguloFoto(anguloBruto) ? anguloBruto : 'frontal'

  const arquivo = formData.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, erro: 'Escolha uma imagem (JPEG, PNG ou WebP).' }
  }
  const ext = extensaoDeMime(arquivo.type, true)
  if (!ext) return { ok: false, erro: 'Use JPEG, PNG ou WebP.' }
  if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO_BYTES) {
    return { ok: false, erro: 'Arquivo acima de 15 MB.' }
  }

  const supabase = await createServerClient()
  const { data: sessaoFoto, error: erroSessao } = await supabase
    .from('photo_sessions')
    .insert({
      patient_id: pacienteId.data,
      registrado_por: sessao.userId,
    })
    .select('id')
    .single()

  if (erroSessao || !sessaoFoto) {
    return { ok: false, erro: 'Não foi possível criar a sessão. Tente de novo.' }
  }

  const nome = `${randomUUID()}.${ext}`
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const upload = await subirArquivoDoPaciente(supabase, {
    pacienteId: pacienteId.data,
    pasta: 'fotos',
    bytes,
    mimeType: arquivo.type,
    nomeArquivo: nome,
  })
  if ('erro' in upload) {
    return { ok: false, erro: 'Falha no upload. Confira o bucket paciente-arquivos.' }
  }

  const { error } = await supabase.from('photos').insert({
    session_id: sessaoFoto.id,
    patient_id: pacienteId.data,
    angulo,
    storage_path: upload.path,
    mime_type: arquivo.type,
    tamanho_bytes: arquivo.size,
    registrado_por: sessao.userId,
  })

  if (error) {
    await removerArquivoDoPaciente(supabase, upload.path)
    return { ok: false, erro: 'Upload ok, mas o registro falhou.' }
  }

  revalidatePath(`/pacientes/${pacienteId.data}`)
  return { ok: true }
}

export async function subirArquivo(formData: FormData): Promise<ResultadoDaAcao> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. sobe arquivos clínicos.' }

  const pacienteId = z.uuid().safeParse(formData.get('pacienteId'))
  if (!pacienteId.success) return { ok: false, erro: 'Paciente inválido.' }

  const arquivo = formData.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, erro: 'Escolha um arquivo (imagem ou PDF).' }
  }
  const ext = extensaoDeMime(arquivo.type, false)
  if (!ext) return { ok: false, erro: 'Use JPEG, PNG, WebP ou PDF.' }
  if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO_BYTES) {
    return { ok: false, erro: 'Arquivo acima de 15 MB.' }
  }

  // Upload unificado: título = nome do arquivo; categoria default `outro`.
  const titulo =
    textoOpcional(formData.get('titulo')) ?? tituloDeNomeArquivo(arquivo.name)
  if (!titulo) return { ok: false, erro: 'Informe um título.' }

  const categoria = textoOpcional(formData.get('categoria')) ?? 'outro'

  const supabase = await createServerClient()
  const nome = `${randomUUID()}.${ext}`
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const upload = await subirArquivoDoPaciente(supabase, {
    pacienteId: pacienteId.data,
    pasta: 'arquivos',
    bytes,
    mimeType: arquivo.type,
    nomeArquivo: nome,
  })
  if ('erro' in upload) {
    return { ok: false, erro: 'Falha no upload. Confira o bucket paciente-arquivos.' }
  }

  const { error } = await supabase.from('patient_files').insert({
    patient_id: pacienteId.data,
    titulo,
    categoria,
    storage_path: upload.path,
    mime_type: arquivo.type,
    tamanho_bytes: arquivo.size,
    registrado_por: sessao.userId,
  })

  if (error) {
    await removerArquivoDoPaciente(supabase, upload.path)
    return { ok: false, erro: 'Upload ok, mas o registro falhou.' }
  }

  revalidatePath(`/pacientes/${pacienteId.data}`)
  return { ok: true }
}

export async function removerArquivo(entrada: {
  pacienteId: string
  id: string
  tipo: 'foto' | 'arquivo'
}): Promise<ResultadoDaAcao> {
  const sessao = await sessaoDra()
  if (!sessao) return { ok: false, erro: 'Só a Dra. remove arquivos clínicos.' }

  const pacienteId = z.uuid().safeParse(entrada.pacienteId)
  const id = z.uuid().safeParse(entrada.id)
  if (!pacienteId.success || !id.success) return { ok: false, erro: 'Identificador inválido.' }

  const supabase = await createServerClient()
  const tabela = entrada.tipo === 'foto' ? 'photos' : 'patient_files'

  const { data: linha, error: erroLeitura } = await supabase
    .from(tabela)
    .select('id, storage_path, patient_id')
    .eq('id', id.data)
    .eq('patient_id', pacienteId.data)
    .maybeSingle()

  if (erroLeitura || !linha) return { ok: false, erro: 'Arquivo não encontrado.' }

  await removerArquivoDoPaciente(supabase, linha.storage_path)
  const { error } = await supabase.from(tabela).delete().eq('id', id.data)
  if (error) return { ok: false, erro: 'Não foi possível remover o registro.' }

  revalidatePath(`/pacientes/${pacienteId.data}`)
  return { ok: true }
}
