import { requireSessao } from '@/auth/session'

/**
 * Layout de tudo que exige login. `requireSessao()` é a autorização de
 * verdade (o proxy faz só a checagem otimista) e redireciona para `/login`
 * quando não há sessão válida ou o perfil está inativo.
 *
 * TODO(Task 4): envolver `children` em `<AppShell sessao={sessao}>`, que traz
 * navegação lateral, cabeçalho e alternador de tema. Enquanto o AppShell não
 * existe, este layout entrega só a proteção — nada de casca provisória.
 */
export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  await requireSessao()
  return <>{children}</>
}
