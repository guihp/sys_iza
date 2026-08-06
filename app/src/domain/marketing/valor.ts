/**
 * O valor que acompanha o `Purchase`.
 *
 * Módulo puro: sem I/O, sem React, sem Next.
 *
 * ---------------------------------------------------------------------------
 * Por que o valor não vai exato
 * ---------------------------------------------------------------------------
 * A restrição legal do plano é explícita: nunca enviar nome de procedimento nem
 * nada de prontuário. O valor monetário parece escapar dessa regra por não ser
 * um campo clínico — e escapa mesmo, tecnicamente. O problema é outro: o catálogo
 * de procedimentos tem preços distintos, e um `Purchase` de exatamente
 * R$ 1.847,00 identifica o procedimento tão bem quanto o nome dele para quem
 * tiver a tabela de preços em mãos. É reidentificação por valor, e ela é
 * conhecida o suficiente para não dar para alegar surpresa.
 *
 * A mitigação é arredondar à centena antes de sair daqui. R$ 1.847 e R$ 1.812
 * viram os dois R$ 1.800, e a faixa deixa de apontar para uma linha do catálogo.
 * A Meta otimiza igual — a granularidade que ela usa é de faixa, não de real.
 *
 * ---------------------------------------------------------------------------
 * Por que ao mais próximo, e não para baixo
 * ---------------------------------------------------------------------------
 * Truncar seria mais "conservador" e é a escolha errada por dois motivos:
 * enviesa toda a receita para baixo (o ROI da tela ficaria sistematicamente
 * pessimista, e ninguém corrige uma métrica que sempre erra para o mesmo lado), e
 * jogaria qualquer coisa abaixo de R$ 100 para zero. Ao mais próximo o erro
 * cancela no agregado, que é onde o número é lido.
 *
 * ---------------------------------------------------------------------------
 * Aritmética
 * ---------------------------------------------------------------------------
 * Tudo em inteiro, em centavos, do começo ao fim — mesmo cuidado de
 * `reaisParaCentavos` em configuracoes/procedimentos/formatacao.ts. Ponto
 * flutuante aqui não é preciosismo teórico: `18.47 * 100` dá 1846.9999999999998,
 * e a diferença entre arredondar 1846 e 1847 aparece na borda dos R$ 50 exatos.
 */

/** R$ 100,00 em centavos. É o degrau do arredondamento. */
export const PASSO_DO_ARREDONDAMENTO_CENTAVOS = 10_000

/**
 * Centavos → centavos, arredondados à centena de reais mais próxima.
 *
 * Meio-degrau exato (R$ 50) sobe, que é a convenção de arredondamento que todo
 * mundo espera de "arredondar".
 *
 * Negativo não é preço, é bug de quem chamou — e como este número vai para um
 * terceiro, devolver o negativo arredondado seria propagar o bug para fora do
 * sistema. Vira zero, que a Meta trata como conversão sem valor.
 */
export function arredondarValorParaCentena(centavos: number): number {
  if (!Number.isFinite(centavos) || centavos <= 0) return 0

  const inteiro = Math.round(centavos)
  const resto = inteiro % PASSO_DO_ARREDONDAMENTO_CENTAVOS

  return resto * 2 >= PASSO_DO_ARREDONDAMENTO_CENTAVOS
    ? inteiro - resto + PASSO_DO_ARREDONDAMENTO_CENTAVOS
    : inteiro - resto
}

/**
 * Centavos arredondados → o número que vai no campo `value` do evento.
 *
 * A Meta quer o valor na unidade da moeda (1800, não 180000). A divisão é exata
 * e sem risco de ponto flutuante porque a entrada é sempre múltipla de
 * `PASSO_DO_ARREDONDAMENTO_CENTAVOS`: o resultado é sempre um inteiro de reais
 * terminado em dois zeros.
 */
export function valorDoEventoEmReais(centavos: number): number {
  return arredondarValorParaCentena(centavos) / 100
}
