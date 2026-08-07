/**
 * Como cada número do cruzamento aparece na tela.
 *
 * Funções puras, separadas de `cruzamento.ts` pela mesma divisão do catálogo de
 * procedimentos: lá o cálculo, aqui a leitura. É aqui que a decisão do projeto
 * — *"KPI mostra `0` ou `—`, nunca `NaN`"* — vira texto de verdade.
 *
 * A convenção do arquivo inteiro: **`null` significa "não dá para dizer" e vira
 * `—`; zero significa zero e vira `0`.** São coisas diferentes e a tela precisa
 * distinguir. Um CAC de `R$ 0` diria que a paciente saiu de graça; `—` diz que
 * ainda não houve paciente para dividir.
 */

/**
 * `Intl.NumberFormat('pt-BR')` separa `R$` do número com ESPAÇO NÃO SEPARÁVEL
 * (U+00A0), não com espaço comum. Duas strings que parecem idênticas na tela
 * falham na comparação, e isso já custou tempo neste projeto.
 *
 * A troca por espaço comum acontece uma vez, aqui, para que teste e tela falem
 * a mesma língua. O visual é o mesmo — a quebra de linha entre `R$` e o valor,
 * que o U+00A0 evita, não acontece nestas células, que são curtas e não
 * quebram.
 */
function semEspacoTeimoso(texto: string): string {
  // Escrito como escape, e não com o caractere literal: um U+00A0 solto no
  // código-fonte é invisível para quem revisa o diff.
  return texto.replace(/\u00A0/g, ' ')
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const MOEDA_REDONDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const INTEIRO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** Ausência de valor. Um caractere só, e sempre o mesmo, em toda a tela. */
export const TRACINHO = '—'

/**
 * Centavos → `R$ 179,96`. `null` → `—`.
 *
 * Zero vira `R$ 0,00` de propósito, ao contrário de `formatarPreco` do catálogo
 * (que escreve "Sem custo"): aqui zero é um fato de gasto — anúncio pausado
 * gastou zero no período — e não uma cortesia.
 */
export function formatarMoeda(centavos: number | null): string {
  if (centavos === null || !Number.isFinite(centavos)) return TRACINHO
  return semEspacoTeimoso(MOEDA.format(centavos / 100))
}

/** Centavos → `R$ 180`, sem centavos. Para KPI, que é leitura de relance. */
export function formatarMoedaRedonda(centavos: number | null): string {
  if (centavos === null || !Number.isFinite(centavos)) return TRACINHO
  return semEspacoTeimoso(MOEDA_REDONDA.format(centavos / 100))
}

/** Contagem → `1.234`. Nunca `null`: contagem ausente é zero, e zero é zero. */
export function formatarInteiro(valor: number): string {
  return Number.isFinite(valor) ? INTEIRO.format(Math.round(valor)) : '0'
}

/**
 * Razão de 0 a 1 → `43%`. `null` → `—`.
 *
 * Sem casa decimal: a diferença entre 42,8% e 43% não muda decisão nenhuma
 * nesta clínica, e o ruído atrapalha a leitura da coluna.
 */
export function formatarTaxa(razao: number | null): string {
  if (razao === null || !Number.isFinite(razao)) return TRACINHO
  return `${Math.round(razao * 100)}%`
}

/**
 * ROI → `3,2×`. `null` → `—`.
 *
 * Múltiplo, e não porcentagem: `320%` e `220% de retorno` se confundem o tempo
 * todo (com ou sem o custo dentro), enquanto "3,2 vezes o que foi gasto" só tem
 * uma leitura.
 */
export function formatarRoi(roi: number | null): string {
  if (roi === null || !Number.isFinite(roi)) return TRACINHO
  return `${roi.toFixed(1).replace('.', ',')}×`
}

/**
 * O anúncio veio do Instagram ou do Facebook.
 *
 * `null` some da tela em vez de virar "Desconhecido": o webhook simplesmente
 * nem sempre traz `sourceApp`, e um rótulo para isso só ocuparia espaço.
 */
export function formatarOrigem(sourceApp: string | null): string | null {
  if (sourceApp === 'instagram') return 'Instagram'
  if (sourceApp === 'facebook') return 'Facebook'
  return null
}

/** `2026-08-06` → `6 de ago`. Rótulo curto do período no cabeçalho. */
const MESES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const

export function formatarDiaCurto(dataISO: string): string {
  const dia = Number(dataISO.slice(8, 10))
  const mes = MESES[Number(dataISO.slice(5, 7)) - 1]
  if (!Number.isFinite(dia) || !mes) return dataISO
  return `${dia} de ${mes}`
}
