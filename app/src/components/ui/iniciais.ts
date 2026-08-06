/**
 * Iniciais para o avatar.
 *
 * Função pura e testada porque erra em casos que aparecem todo dia no cadastro
 * de uma clínica: nome com preposição ("Maria da Silva" não é "MD"), nome de
 * uma palavra só, espaço sobrando de colagem, e o cadastro em branco que o
 * banco vazio produz.
 */

/**
 * Partículas que não são sobrenome. Ficam de fora do cálculo da segunda letra,
 * mas nunca ao ponto de zerar o resultado — "de Souza" continua devolvendo S.
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/**
 * `"Maria da Silva"` → `"MS"`. Primeira letra do primeiro nome e primeira letra
 * do último. Nome de uma palavra só devolve as duas primeiras letras dela;
 * nome vazio devolve travessão, para o avatar nunca aparecer em branco.
 */
export function iniciaisDoNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '—'

  const significativas = partes.filter(
    (parte) => !PARTICULAS.has(parte.toLocaleLowerCase('pt-BR')),
  )
  const usadas = significativas.length > 0 ? significativas : partes

  const primeira = usadas[0]
  if (usadas.length === 1) {
    return primeira.slice(0, 2).toLocaleUpperCase('pt-BR')
  }

  const ultima = usadas[usadas.length - 1]
  return `${primeira[0]}${ultima[0]}`.toLocaleUpperCase('pt-BR')
}
