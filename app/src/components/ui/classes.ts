/**
 * Concatenação de classes.
 *
 * Deliberadamente burra: junta o que não é vazio e nada mais. Não existe
 * `tailwind-merge` no projeto, então **nenhuma primitiva daqui traz uma
 * utilitária que o consumidor provavelmente vá querer trocar** — padding, por
 * exemplo, não vem embutido em `<Cartao>`. Duas classes conflitantes na mesma
 * string não se resolvem pela ordem do atributo, e sim pela ordem no CSS
 * gerado; embutir padding e depois "sobrescrever" por `className` daria um
 * resultado que depende do alfabeto.
 */
export function juntar(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
