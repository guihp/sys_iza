import type { ComponentProps } from 'react'
import { juntar } from './classes'

/**
 * Cartão: superfície branca, borda de 1px, raio 12. Nada mais.
 *
 * **Sem padding por padrão** — e é decisão, não esquecimento. O spec pede 16px
 * dentro do cartão da meta e 14px no cartão do funil; sem `tailwind-merge` no
 * projeto, um `p-4` embutido não seria vencido por um `p-3.5` vindo por
 * `className` de forma confiável, porque quem decide o vencedor é a ordem no
 * CSS gerado e não a ordem no atributo. Quem usa escolhe o padding.
 *
 * `<Cartao>` é uma `<div>`. Quando o cartão for um `<li>`, um `<section>` ou um
 * `<article>` — caso do kanban e da lista de gatilhos —, use
 * `CLASSES_CARTAO` direto no elemento certo, em vez de aninhar uma div a mais.
 */
export const CLASSES_CARTAO = 'rounded-cartao border border-linha bg-superficie'

export function Cartao({ className, ...resto }: ComponentProps<'div'>) {
  return <div className={juntar(CLASSES_CARTAO, className)} {...resto} />
}
