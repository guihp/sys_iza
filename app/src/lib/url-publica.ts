/**
 * Origem pública do app a partir dos headers do pedido (Coolify / proxy).
 *
 * Prefere `x-forwarded-host` + `x-forwarded-proto` (domínio da nuvem).
 * Sem host → string vazia (a UI cai em placeholder).
 */

export function urlPublicaDoApp(cabecalhos: Headers): string {
  const hostBruto = cabecalhos.get('x-forwarded-host') ?? cabecalhos.get('host')
  if (!hostBruto) return ''

  // Alguns proxies mandam lista: "app.exemplo.com, localhost:3000"
  const host = hostBruto.split(',')[0]?.trim()
  if (!host) return ''

  const protoBruto = cabecalhos.get('x-forwarded-proto')
  const protoLista = protoBruto?.split(',')[0]?.trim().toLowerCase()
  const proto =
    protoLista === 'http' || protoLista === 'https'
      ? protoLista
      : host.startsWith('localhost') || host.startsWith('127.0.0.1')
        ? 'http'
        : 'https'

  return `${proto}://${host}`.replace(/\/$/, '')
}
