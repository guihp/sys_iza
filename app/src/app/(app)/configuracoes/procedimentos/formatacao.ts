/**
 * Formatação e leitura dos campos de procedimento.
 *
 * Funções puras, sem React, sem Supabase e sem Next: o preço em centavos e o
 * intervalo de retorno em dias são regra de exibição/entrada que precisa de
 * teste próprio — é aqui que mora o risco de um preço entrar mil vezes maior.
 */

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Centavos → "R$ 1.800,00". Zero vira texto porque "R$ 0,00" lê como erro. */
export function formatarPreco(centavos: number): string {
  if (centavos === 0) return 'Sem custo'
  return MOEDA.format(centavos / 100)
}

/** Dias → "120 dias". `null` é a ausência de retorno, não zero dias. */
export function descreverRetorno(dias: number | null): string {
  if (dias === null) return 'Sem retorno'
  return dias === 1 ? '1 dia' : `${dias} dias`
}

/** Minutos → "60 min". Sempre o sufixo curto do mockup. */
export function formatarDuracao(minutos: number): string {
  return `${minutos} min`
}

const INTEIRO_PT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** Centavos → valor editável no campo de texto, sem símbolo de moeda (`12.400,00`). */
export function precoParaCampo(centavos: number): string {
  const reais = Math.floor(centavos / 100)
  const resto = String(centavos % 100).padStart(2, '0')
  return `${INTEIRO_PT.format(reais)},${resto}`
}

/**
 * Máximo de dígitos tratados como centavos no campo ao vivo. Além disso
 * `Number` perde precisão; 15 casas cobrem até ~R$ 9 trilhões.
 */
const MAX_DIGITOS_MOEDA = 15

/**
 * Máscara ao digitar (UX pt-BR de moeda): só os dígitos contam, da direita
 * para a esquerda como centavos. Digitar `1000000` → `10.000,00`.
 * Campo vazio se não houver dígito; colar `R$ 1.800,00` extrai os dígitos.
 */
export function mascararMoedaAoDigitar(texto: string): string {
  const digitos = texto.replace(/\D/g, '').slice(0, MAX_DIGITOS_MOEDA)
  if (digitos === '') return ''
  return precoParaCampo(Number(digitos))
}

/**
 * Texto digitado → centavos. Devolve `null` quando não dá para ler um valor
 * não negativo. Aceita "R$ 1.800,00", "1.800", "1800,00" e "1800.50".
 */
export function reaisParaCentavos(texto: string): number | null {
  const bruto = texto.trim()
  // Preço não é desconto: sinal negativo é entrada inválida, não valor a somar.
  if (bruto === '' || bruto.includes('-')) return null

  const limpo = bruto.replace(/[^\d.,]/g, '')
  if (limpo === '') return null

  const normalizado = normalizarSeparadores(limpo)
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null

  // Aritmética em string: `10.005 * 100` em ponto flutuante dá 1000.49…,
  // que arredondaria para baixo o que o usuário digitou como meio centavo.
  const [inteiro, fracao = ''] = normalizado.split('.')
  const tresCasas = `${fracao}000`.slice(0, 3)
  const centavosDaFracao =
    Number(tresCasas.slice(0, 2)) + (Number(tresCasas[2]) >= 5 ? 1 : 0)

  return Number(inteiro) * 100 + centavosDaFracao
}

/**
 * Deixa o número com ponto decimal. Em pt-BR a vírgula é o separador decimal
 * e o ponto é o de milhar — e "1.800", sem vírgula, é mil e oitocentos.
 */
function normalizarSeparadores(valor: string): string {
  if (valor.includes(',')) return valor.replace(/\./g, '').replace(/,/g, '.')

  const partes = valor.split('.')
  const ehMilhar = partes.length > 1 && partes[partes.length - 1].length === 3
  return ehMilhar ? partes.join('') : valor
}
