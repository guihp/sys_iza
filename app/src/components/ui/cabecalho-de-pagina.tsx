import type { ReactNode } from 'react'
import { juntar } from './classes'
import { LinhaDeKpis } from './kpi'
import { RotuloMiudo } from './rotulo-miudo'

/**
 * Cabeçalho que se repete em toda tela: rótulo de seção em acento, título
 * serifado grande, descrição curta à esquerda; linha de KPIs à direita,
 * alinhada embaixo (Funil Clinica.dc.html). Divisor de 1px sob o bloco.
 *
 * `kpis` recebe os `<Kpi>` soltos — a `<LinhaDeKpis>` já está aqui dentro.
 * Numa tela estreita a linha desce para baixo do título.
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
    <header className={juntar('space-y-6', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-[30px] gap-y-6">
        <div className="flex max-w-[640px] flex-col gap-2">
          <RotuloMiudo tom="acento">{secao}</RotuloMiudo>
          <h1 className="font-serif text-[28px] leading-[1.05] tracking-[0.005em] sm:text-[34px] lg:text-[40px]">
            {titulo}
          </h1>
          {descricao ? (
            <p className="max-w-[52ch] text-[14px] leading-[1.6] text-texto-suave">{descricao}</p>
          ) : null}
        </div>
        {kpis ? <LinhaDeKpis>{kpis}</LinhaDeKpis> : null}
      </div>
      <div aria-hidden className="h-px bg-linha" />
    </header>
  )
}
