'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Sessao } from '@/auth/session'
import { juntar } from '@/components/ui'
import { abaAtiva, abasParaPapel } from './abas'

/**
 * Abas internas de Configurações — links, sem estado próprio.
 * O caminho ativo vem do router; a regra de match mora em `abas.ts`.
 * A secretária só vê Notificações.
 */
export function AbasDeConfiguracoes({ role }: { role: Sessao['role'] }) {
  const caminho = usePathname()
  const abas = abasParaPapel(role)
  const ativa = abaAtiva(caminho, abas)

  return (
    <nav aria-label="Seções de configurações" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-min gap-1 border-b border-linha px-1">
        {abas.map((aba) => {
          const ativaAgora = aba.href === ativa
          return (
            <li key={aba.href}>
              <Link
                href={aba.href}
                aria-current={ativaAgora ? 'page' : undefined}
                className={juntar(
                  'block min-h-11 whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                  ativaAgora
                    ? 'border-b-2 border-acento font-medium text-texto'
                    : 'border-b-2 border-transparent text-texto-suave hover:text-texto',
                )}
              >
                {aba.rotulo}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
