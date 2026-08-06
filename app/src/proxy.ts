import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicEnv } from '@/lib/env'

/**
 * Renova o cookie de sessão do Supabase a cada requisição e faz a checagem
 * otimista de autenticação: quem não está logado só enxerga `/login`.
 *
 * Em Next.js 16 a convenção `middleware.ts` foi renomeada para `proxy.ts`,
 * com a função exportada chamada `proxy` (ou default). Manter `middleware.ts`
 * ainda funciona, mas emite aviso de descontinuação; ter os dois arquivos é
 * erro de build.
 *
 * Isto NÃO substitui a autorização de verdade — a fonte da verdade continua
 * sendo `requireSessao()` no servidor mais a RLS no Postgres.
 */
export async function proxy(request: NextRequest) {
  let resposta = NextResponse.next({ request })

  const supabase = createServerClient(publicEnv.SUPABASE_URL, publicEnv.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => request.cookies.set(name, value))
        resposta = NextResponse.next({ request })
        lista.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options))
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  const ehRotaPublica = request.nextUrl.pathname.startsWith('/login')

  if (!data.user && !ehRotaPublica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return resposta
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
