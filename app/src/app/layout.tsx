import type { Metadata } from 'next'
import { SCRIPT_TEMA_INICIAL } from '@/lib/tema'
import './globals.css'

export const metadata: Metadata = {
  title: 'Dra. Izadora Barros',
  description: 'Sistema de atendimento da clínica',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Antes da primeira pintura: evita o flash claro de quem já escolheu o escuro. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  )
}
