import { juntar } from './classes'
import { iniciaisDoNome } from './iniciais'

/**
 * Avatar: círculo de 32px, fundo acento-suave, iniciais em 11px na cor do
 * acento. Sem foto — a clínica não guarda retrato de paciente.
 *
 * `aria-hidden` de propósito: em todo lugar do desenho o avatar aparece colado
 * ao nome que ele abrevia (sidebar, linha da tabela de retornos, cartão do
 * funil), e anunciar "MS" antes de "Maria Silva" só atrapalharia quem usa
 * leitor de tela. Se um dia ele aparecer sozinho, quem usar precisa dar o
 * rótulo no elemento de fora.
 */
export function Avatar({ nome, className }: { nome: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      title={nome}
      className={juntar(
        'inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-acento-suave font-serif text-[13.5px] text-acento',
        className,
      )}
    >
      {iniciaisDoNome(nome)}
    </span>
  )
}
