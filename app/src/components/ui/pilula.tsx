import Link from 'next/link'
import type { ComponentProps } from 'react'
import { juntar } from './classes'

/**
 * Pílula — o único formato de botão e de chip do sistema. Raio total, sem
 * sombra, borda de 1px quando tem borda.
 *
 * Três variantes:
 * - `solida`: ação principal. NOVO LEAD, HOJE, WhatsApp, NOVO PROCEDIMENTO.
 * - `contorno`: ação secundária. ESCURO, Semana anterior, Editar, Desativar,
 *   Agendar, Desligar envio.
 * - `suave`: estado, não ação. SALVO.
 *
 * Três componentes em vez de um polimórfico: o `<Link>` do Next e o `<button>`
 * têm props incompatíveis, e um componente único acabaria com o tipo `any` de
 * um lado ou com um `as` no outro. Quem precisar de um elemento que não está
 * aqui usa `classesDePilula()` direto.
 */
export type VarianteDePilula = 'solida' | 'contorno' | 'suave'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full text-[11px] uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const VARIANTES: Record<VarianteDePilula, string> = {
  solida: 'bg-solido px-5 py-2.5 text-solido-texto hover:opacity-90',
  contorno:
    'border border-linha bg-transparent px-5 py-2.5 text-texto hover:border-acento hover:text-acento',
  suave: 'bg-superficie-2 px-5 py-2.5 text-texto-suave',
}

export function classesDePilula(variante: VarianteDePilula = 'contorno', extra?: string): string {
  return juntar(BASE, VARIANTES[variante], extra)
}

/** Pílula que executa alguma coisa. `type="button"` por padrão, de propósito. */
export function Pilula({
  variante = 'contorno',
  className,
  type = 'button',
  ...resto
}: { variante?: VarianteDePilula } & ComponentProps<'button'>) {
  return <button type={type} className={classesDePilula(variante, className)} {...resto} />
}

/** Pílula que navega dentro do app. */
export function PilulaLink({
  variante = 'contorno',
  className,
  ...resto
}: { variante?: VarianteDePilula } & ComponentProps<typeof Link>) {
  return <Link className={classesDePilula(variante, className)} {...resto} />
}

/** Pílula que só informa — não recebe foco e não faz nada ao ser clicada. */
export function PilulaTexto({
  variante = 'suave',
  className,
  ...resto
}: { variante?: VarianteDePilula } & ComponentProps<'span'>) {
  return <span className={classesDePilula(variante, className)} {...resto} />
}
