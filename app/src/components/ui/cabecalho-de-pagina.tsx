import type { ReactNode } from 'react'
import { juntar } from './classes'
import { LinhaDeKpis } from './kpi'
import { RotuloMiudo } from './rotulo-miudo'

/**
 * Cabeçalho que se repete em toda tela: rótulo de seção em acento, título
 * serifado grande, descrição curta à esquerda; linha de KPIs à direita,
 * alinhada ao topo.
 *
 * `kpis` recebe os `<Kpi>` soltos — a `<LinhaDeKpis>` já está aqui dentro, com
 * os 48px de intervalo. Numa tela estreita a linha desce para baixo do título
 * em vez de espremer o número serifado.
 */
export function CabecalhoDePagina({
  secao,
  titulo,
  descricao,
  kpis,
  className,
}: {
  secao: string
  titulo: ReactNode
  descricao?: ReactNode
  kpis?: ReactNode
  className?: string
}) {
  return (
    <header
      className={juntar('flex flex-wrap items-start justify-between gap-x-12 gap-y-6', className)}
    >
      <div className="space-y-2">
        <RotuloMiudo tom="acento">{secao}</RotuloMiudo>
        <h1 className="font-serif text-[40px] leading-[1.1]">{titulo}</h1>
        {descricao ? (
          <p className="max-w-[52ch] text-[13px] leading-relaxed text-texto-suave">{descricao}</p>
        ) : null}
      </div>
      {kpis ? <LinhaDeKpis>{kpis}</LinhaDeKpis> : null}
    </header>
  )
}
