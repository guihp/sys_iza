import type { ReactNode } from 'react'
import { juntar } from './classes'
import { RotuloMiudo } from './rotulo-miudo'

/**
 * KPI do cabeçalho de página: rótulo miúdo em cima, número serifado de 32px no
 * meio, sublegenda de 11px embaixo.
 *
 * O `valor` é `ReactNode` e não `number` porque o banco está vazio e vai
 * continuar vazio: a tela precisa poder mostrar `0`, `—` ou `R$ 0` sem que a
 * primitiva force uma formatação. **`NaN` e esqueleto de carregamento eterno
 * não são estados válidos** — quem calcula resolve isso antes de chegar aqui.
 */
export function Kpi({
  rotulo,
  valor,
  sublegenda,
  className,
}: {
  rotulo: string
  valor: ReactNode
  sublegenda?: ReactNode
  className?: string
}) {
  return (
    <div className={juntar('flex flex-col items-start gap-1', className)}>
      <RotuloMiudo>{rotulo}</RotuloMiudo>
      <p className="font-serif text-[32px] leading-none">{valor}</p>
      {sublegenda ? <p className="text-[11px] text-texto-suave">{sublegenda}</p> : null}
    </div>
  )
}

/** A linha de três KPIs à direita do cabeçalho da página, com 48px entre eles. */
export function LinhaDeKpis({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={juntar('flex flex-wrap items-start gap-x-12 gap-y-6', className)}>
      {children}
    </div>
  )
}
