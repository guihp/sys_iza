import { requireSessao } from '@/auth/session'
import { AppShell } from '@/components/app-shell'
import { carregarDadosDaCasca } from '@/components/shell-dados'
import { RegistrarServiceWorker } from '@/components/pwa/registrar-sw'
import { carregarMarca } from '@/lib/marca'

/**
 * Layout de tudo que exige login. `requireSessao()` é a autorização de
 * verdade (o proxy faz só a checagem otimista) e redireciona para `/login`
 * quando não há sessão válida ou o perfil está inativo.
 *
 * A sessão resolvida aqui alimenta o `AppShell`, que decide o menu pelo papel.
 * Os números da lateral — contadores e meta do mês — são lidos aqui, e não
 * dentro da casca, para o `AppShell` continuar sendo um componente síncrono e
 * sem I/O. O SW da PWA só registra depois do login (área autenticada).
 */
export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  const sessao = await requireSessao()
  const [{ contadores, realizadoDoMesCentavos, metaDoMesCentavos, hojeISO }, marca] =
    await Promise.all([carregarDadosDaCasca(sessao), carregarMarca()])

  return (
    <>
      <RegistrarServiceWorker />
      <AppShell
        sessao={sessao}
        contadores={contadores}
        realizadoDoMesCentavos={realizadoDoMesCentavos}
        metaDoMesCentavos={metaDoMesCentavos}
        hojeISO={hojeISO}
        logoUrl={marca.logoUrl}
        logoEscala={marca.logoEscala}
        logoPosX={marca.logoPosX}
        logoPosY={marca.logoPosY}
      >
        {children}
      </AppShell>
    </>
  )
}
