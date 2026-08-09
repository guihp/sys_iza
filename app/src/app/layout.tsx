import type { Metadata } from 'next'
import { Cormorant_Garamond, Jost } from 'next/font/google'
import { SCRIPT_TEMA_INICIAL } from '@/lib/tema'
import './globals.css'

/**
 * Tipografia do redesign (Funil Clinica.dc.html): Cormorant nos títulos,
 * Jost no resto. Variáveis alimentam `--font-serif` / `--font-sans` no CSS.
 */
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-login-serif',
  display: 'swap',
})

const jost = Jost({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-login-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Dra. Izadora Barros',
  description: 'Sistema de atendimento da clínica',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Clínica Izadora',
  },
  icons: {
    apple: '/icons/icon-192.png',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#a17c4b' },
    { media: '(prefers-color-scheme: dark)', color: '#c9a273' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="pt-BR"
      className={`h-full antialiased ${cormorant.variable} ${jost.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body className="flex min-h-full flex-col font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
