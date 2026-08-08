import Link from 'next/link'
import { juntar } from '@/components/ui'
import {
  ABAS_DA_FICHA,
  ROTULOS_DAS_ABAS,
  type AbaDaFicha,
} from '@/domain/clinical/prontuario'

/**
 * Abas da ficha — navegação por query `?aba=`.
 * Server Component: só links, sem estado de cliente.
 */
export function AbasDaFicha({
  pacienteId,
  ativa,
}: {
  pacienteId: string
  ativa: AbaDaFicha
}) {
  return (
    <nav aria-label="Seções da ficha" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-min gap-1 border-b border-linha px-1">
        {ABAS_DA_FICHA.map((aba) => {
          const ativaAgora = aba === ativa
          return (
            <li key={aba}>
              <Link
                href={`/pacientes/${pacienteId}?aba=${aba}`}
                aria-current={ativaAgora ? 'page' : undefined}
                className={juntar(
                  'block min-h-11 whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                  ativaAgora
                    ? 'border-b-2 border-acento font-medium text-texto'
                    : 'border-b-2 border-transparent text-texto-suave hover:text-texto',
                )}
              >
                {ROTULOS_DAS_ABAS[aba]}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
