/**
 * Meta de faturamento do mês — o cartão no rodapé da sidebar.
 *
 * ---------------------------------------------------------------------------
 * ATENÇÃO: A META É UMA CONSTANTE, NÃO UM DADO.
 * ---------------------------------------------------------------------------
 * Não existe no banco nenhuma tabela de configuração da clínica, e portanto não
 * existe fonte de verdade para "quanto a Dra. quer faturar neste mês". As duas
 * saídas honestas eram uma migration `0009_configuracoes_clinica.sql` ou uma
 * constante marcada; a constante venceu por um motivo concreto: a migration não
 * pode ser aplicada por quem escreve o código (regra do projeto), então até o
 * dono rodá-la a tabela não existiria e a consulta falharia — o cartão
 * precisaria cair de volta nesta mesma constante. Duas fontes para o mesmo
 * número, uma delas morta, é pior do que uma fonte só, declarada.
 *
 * Quando a meta virar configurável, o caminho é: criar
 * `public.clinic_settings` (linha única, `meta_mensal_centavos integer not
 * null`, RLS de leitura para a equipe e escrita só para a dra), ler dali em
 * `carregarMetaDoMes` e apagar esta constante. Nada mais desta lista muda.
 *
 * O REALIZADO, esse sim, é dado de verdade: sai da soma do preço de catálogo
 * dos atendimentos registrados no mês. Com o banco vazio dá R$ 0, 0% e a barra
 * zerada — que é o estado correto da tela hoje, não um erro.
 */

import { diasNoMes } from '@/lib/datetime'

/** Meta mensal em centavos. Valor de partida combinado; troque aqui. */
export const META_MENSAL_CENTAVOS = 4_500_000

const MOEDA_CHEIA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

export type ProgressoDaMeta = {
  /** Somatório dos atendimentos do mês, em centavos. */
  realizadoCentavos: number
  metaCentavos: number
  /** Inteiro de 0 a 100 para desenhar a barra — nunca passa de 100. */
  percentualDaBarra: number
  /** Inteiro do texto. Pode passar de 100 quando a Dra. bater a meta. */
  percentualAlcancado: number
  /** Dias que ainda faltam no mês, contando hoje. */
  diasRestantes: number
}

/**
 * Monta o cartão a partir do realizado e do dia de hoje **na clínica**
 * (`dataDaClinica(new Date())`). Função pura: sem `new Date()` aqui dentro,
 * para o teste poder fixar o dia sem mexer no relógio do processo.
 *
 * `diasRestantes` conta hoje. No último dia do mês o cartão diz "1 dia
 * restante", e não "0 dias restantes" — ainda dá para atender hoje.
 */
export function progressoDaMeta(realizadoCentavos: number, hojeISO: string): ProgressoDaMeta {
  const meta = META_MENSAL_CENTAVOS
  // Meta zerada dividiria por zero e mandaria `Infinity` para a tela. Com meta
  // desligada a barra fica zerada, que é o estado neutro.
  const bruto = meta > 0 ? (realizadoCentavos / meta) * 100 : 0

  const diaDoMes = Number(hojeISO.slice(8, 10))

  return {
    realizadoCentavos,
    metaCentavos: meta,
    percentualDaBarra: Math.max(0, Math.min(100, Math.round(bruto))),
    percentualAlcancado: Math.max(0, Math.round(bruto)),
    diasRestantes: Math.max(0, diasNoMes(hojeISO) - diaDoMes + 1),
  }
}

/** Centavos → `R$ 12.450`. Sem centavos: o cartão da meta é leitura de relance. */
export function formatarValorRedondo(centavos: number): string {
  return MOEDA_CHEIA.format(centavos / 100)
}

/** `0% alcançado · 25 dias restantes`. Singular no dia certo. */
export function descreverProgresso(progresso: ProgressoDaMeta): string {
  const dias = progresso.diasRestantes
  const plural = dias === 1 ? 'dia restante' : 'dias restantes'
  return `${progresso.percentualAlcancado}% alcançado · ${dias} ${plural}`
}
