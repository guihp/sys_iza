import { requireSessao } from '@/auth/session'
import { AppShell } from '@/components/app-shell'

/**
 * Layout de tudo que exige login. `requireSessao()` é a autorização de
 * verdade (o proxy faz só a checagem otimista) e redireciona para `/login`
 * quando não há sessão válida ou o perfil está inativo.
 *
 * A sessão resolvida aqui alimenta o `AppShell`, que decide o menu pelo papel:
 * a secretária não recebe sequer o link das telas de configuração.
 */
export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  const sessao = await requireSessao()
  return <AppShell sessao={sessao}>{children}</AppShell>
}
