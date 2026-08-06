'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { juntar } from '@/components/ui'
import {
  formatarContador,
  itemAtivo,
  type ContadoresDaCasca,
  type ItemDeNavegacao,
} from './navegacao'

/**
 * A lista do menu.
 *
 * Componente de cliente por um motivo só: saber qual item está aceso exige o
 * caminho atual, e `usePathname` não existe no servidor. Toda a regra de quem
 * vê o quê já foi resolvida antes, em `itensDeNavegacao(role)` — o que chega
 * aqui é a lista final, então não há nada escondido com CSS.
 */
export function NavegacaoLateral({
  itens,
  contadores,
}: {
  itens: ItemDeNavegacao[]
  contadores: ContadoresDaCasca
}) {
  const caminho = usePathname()

  return (
    <ul className="space-y-2">
      {itens.map((item) => {
        const ativo = itemAtivo(item, caminho)
        const contador = formatarContador(item, contadores)

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={ativo ? 'page' : undefined}
              // Sem isto o nome acessível sai colado — "Funil12" — porque os
              // dois spans são irmãos sem nó de texto no meio. A vírgula é o
              // que faz o leitor de tela pausar entre o rótulo e o contador.
              aria-label={contador ? `${item.rotulo}, ${contador}` : undefined}
              className={juntar(
                'flex items-center gap-3 rounded-cartao px-3.5 py-2.5 text-[14px] transition-colors',
                ativo
                  ? 'border border-linha bg-superficie'
                  : 'border border-transparent hover:bg-superficie/60',
              )}
            >
              <span
                aria-hidden="true"
                className={juntar(
                  'size-1.5 shrink-0 rounded-full',
                  ativo ? 'bg-acento' : 'bg-texto-suave',
                )}
              />
              <span className="flex-1 truncate">{item.rotulo}</span>
              {contador ? (
                <span className="shrink-0 text-[11px] text-texto-suave">{contador}</span>
              ) : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
