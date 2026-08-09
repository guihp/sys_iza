import { redirect } from 'next/navigation'
import { requireSessao } from '@/auth/session'

/**
 * Entrada de Configurações: Dra. cai em Meta; secretária em Notificações
 * (única aba que ela tem).
 */
export default async function PaginaDeConfiguracoes() {
  const sessao = await requireSessao()
  if (sessao.role === 'secretaria') {
    redirect('/configuracoes/notificacoes')
  }
  redirect('/configuracoes/meta')
}
