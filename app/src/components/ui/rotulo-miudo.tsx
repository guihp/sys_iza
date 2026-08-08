import type { ComponentProps } from 'react'
import { juntar } from './classes'

/**
 * O rótulo miúdo — o padrão mais repetido do desenho.
 *
 * 10px, caixa alta, entreletra aberta. Aparece em cabeçalho de tabela, rótulo
 * de KPI, "GESTÃO", "MENSAGEM", "COMO A PACIENTE RECEBE".
 *
 * Dois tons: `suave` (o padrão) para rótulo de campo e de coluna, e `acento`
 * para o rótulo de seção da página — "PIPELINE CLÍNICO", "SEMANA CLÍNICA",
 * "REATIVAÇÃO", "CATÁLOGO CLÍNICO", "AUTOMAÇÃO".
 */
export type TomDoRotulo = 'suave' | 'acento'

const TONS: Record<TomDoRotulo, string> = {
  suave: 'text-texto-suave',
  acento: 'text-acento',
}

/** Só as classes, para quem precisa aplicá-las a um `<th>` ou a um `<legend>`. */
export function classesDeRotuloMiudo(tom: TomDoRotulo = 'suave'): string {
  // Mockup Funil Clinica.dc.html: seção .22em, KPI .18em — meio-termo .18em.
  return juntar('text-[10px] uppercase tracking-[0.18em]', TONS[tom])
}

export function RotuloMiudo({
  tom = 'suave',
  className,
  ...resto
}: { tom?: TomDoRotulo } & ComponentProps<'span'>) {
  return <span className={juntar(classesDeRotuloMiudo(tom), className)} {...resto} />
}
