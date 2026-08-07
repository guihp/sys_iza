import { Cormorant_Garamond, Jost } from 'next/font/google'

/**
 * Fontes do mockup Login.dc.html (Cormorant Garamond + Jost).
 * Só no grupo `(auth)` — o resto do app continua no sans do sistema.
 */

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-login-serif',
  display: 'swap',
})

const jost = Jost({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-login-sans',
  display: 'swap',
})

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${cormorant.variable} ${jost.variable} h-full`}>{children}</div>
}
