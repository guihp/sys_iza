import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

export type Sessao = { userId: string; nome: string; role: 'dra' | 'secretaria' }

export async function getSessao(): Promise<Sessao | null> {
  const supabase = await createServerClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null

  const { data: perfil } = await supabase
    .from('profiles')
    .select('nome, role, ativo')
    .eq('id', auth.user.id)
    .single()

  if (!perfil || !perfil.ativo) return null
  return { userId: auth.user.id, nome: perfil.nome, role: perfil.role }
}

export async function requireSessao(): Promise<Sessao> {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')
  return sessao
}
