import { requireSessao } from '@/auth/session'
import { AppShell } from '@/components/app-shell'
import { carregarDadosDaCasca } from '@/components/shell-dados'
import { carregarMarca } from '@/lib/marca'

/**
 * Layout de tudo que exige login. `requireSessao()` é a autorização de
 * verdade (o proxy faz só a checagem otimista) e redireciona para `/login`
 * quando não há sessão válida ou o perfil está inativo.
 *
 * A sessão resolvida aqui alimenta o `AppShell`, que decide o menu pelo papel:
 * a secretária não recebe sequer o link das telas de configuração. Os números
 * da lateral — contadores e meta do mês — são lidos aqui, e não dentro da
 * casca, para o `AppShell` continuar sendo um componente síncrono e sem I/O.
 */
export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  const sessao = await requireSessao()
  const [{ contadores, realizadoDoMesCentavos, hojeISO }, marca] = await Promise.all([
    carregarDadosDaCasca(sessao),
    carregarMarca(),
  ])

  return (
    <AppShell
      sessao={sessao}
      contadores={contadores}
      realizadoDoMesCentavos={realizadoDoMesCentavos}
      hojeISO={hojeISO}
      logoUrl={marca.logoUrl}
    >
      {children}
    </AppShell>
  )
}
