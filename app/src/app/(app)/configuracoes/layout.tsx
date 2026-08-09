import { requireSessao } from '@/auth/session'
import { AbasDeConfiguracoes } from './abas-nav'

/**
 * Casca das telas sob `/configuracoes/*`.
 *
 * Abas para dra e secretaria: a secretária só vê Notificações (push no device).
 * Rotas exclusivas da Dra. continuam com `notFound()` na própria página.
 */
export default async function LayoutDeConfiguracoes({
  children,
}: {
  children: React.ReactNode
}) {
  const sessao = await requireSessao()

  return (
    <div className="space-y-6">
      <AbasDeConfiguracoes role={sessao.role} />
      {children}
    </div>
  )
}
