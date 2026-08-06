/**
 * Geometria da grade semanal da agenda.
 *
 * Módulo separado de `acoes.ts` pelo mesmo motivo de `crm/estagios.ts`: arquivo
 * `'use server'` só exporta função assíncrona, e aqui há constantes. E separado
 * da tela porque posicionar um bloco na grade é conta, não pintura — conta que
 * erra fácil na virada do dia e no arredondamento de meia hora, e que por isso
 * merece teste próprio.
 *
 * Tudo raciocina no relógio de parede de São Paulo, via `@/lib/datetime`.
 */

import {
  dataDaClinica,
  deslocarData,
  diaDaSemanaDaData,
  formatarDataExtensa,
  minutosDoDiaNaClinica,
} from '@/lib/datetime'

/** Primeira e última hora desenhadas na grade. */
export const PRIMEIRA_HORA = 8
export const ULTIMA_HORA = 20
/** Altura de uma linha da grade, em minutos. */
export const PASSO_MINUTOS = 30

/** Minutos do dia de cada linha da grade: 480, 510, … 1170. */
export const FAIXAS: readonly number[] = Array.from(
  { length: ((ULTIMA_HORA - PRIMEIRA_HORA) * 60) / PASSO_MINUTOS },
  (_, indice) => PRIMEIRA_HORA * 60 + indice * PASSO_MINUTOS,
)

/** Cabeçalho de cada coluna, na ordem em que a grade desenha. */
export const ROTULOS_DOS_DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

/**
 * Segunda-feira da semana de uma data.
 *
 * A grade da clínica vai de segunda a domingo, e `diaDaSemanaDaData` numera com
 * domingo em zero. Sem o ajuste, domingo recuaria um dia só e abriria a semana
 * seguinte, deixando o próprio domingo fora da tela.
 */
export function inicioDaSemana(dataISO: string): string {
  const dia = diaDaSemanaDaData(dataISO)
  const recuo = dia === 0 ? 6 : dia - 1
  return deslocarData(dataISO, -recuo)
}

/** As sete datas da semana que começa em `inicioISO`. */
export function diasDaSemana(inicioISO: string): string[] {
  return Array.from({ length: 7 }, (_, indice) => deslocarData(inicioISO, indice))
}

export type PosicaoNaGrade = {
  /** Índice da linha em que o bloco começa, base zero. */
  linhaInicial: number
  /** Quantas linhas ele ocupa. Nunca menor que 1. */
  linhas: number
  /** O bloco foi cortado porque começa antes ou termina depois da grade. */
  transbordou: boolean
}

/**
 * Onde um intervalo entra na coluna de um dia, ou `null` se não entra.
 *
 * Não entra em três casos: é de outro dia no calendário da clínica, termina
 * antes do começo da grade, ou começa depois do fim dela. Consulta que só
 * atravessa a borda é cortada e marcada com `transbordou`, para a tela poder
 * avisar em vez de mentir sobre o horário.
 */
export function posicionarNaGrade(
  intervalo: { inicio: Date; fim: Date },
  dataISO: string,
): PosicaoNaGrade | null {
  if (dataDaClinica(intervalo.inicio) !== dataISO) return null

  const inicioEmMinutos = minutosDoDiaNaClinica(intervalo.inicio)
  // Medido a partir do início, e não pelo relógio do instante final: consulta
  // que termina à meia-noite daria 0, e no dia da virada do horário de verão a
  // diferença entre os dois relógios acrescentaria uma hora que não existe.
  const duracao = Math.round((intervalo.fim.getTime() - intervalo.inicio.getTime()) / 60_000)
  const fimEmMinutos = inicioEmMinutos + duracao

  const abertura = PRIMEIRA_HORA * 60
  const fechamento = ULTIMA_HORA * 60
  if (fimEmMinutos <= abertura || inicioEmMinutos >= fechamento) return null

  const cortadoNoInicio = inicioEmMinutos < abertura
  const cortadoNoFim = fimEmMinutos > fechamento

  const inicioVisivel = Math.max(inicioEmMinutos, abertura)
  const fimVisivel = Math.min(fimEmMinutos, fechamento)

  // `floor` no início e `ceil` no fim: o bloco cobre toda linha que ele toca,
  // mesmo de raspão. Um procedimento de 45 minutos ocupa duas linhas — não pode
  // terminar no meio de uma.
  const linhaInicial = Math.floor((inicioVisivel - abertura) / PASSO_MINUTOS)
  const linhaFinal = Math.ceil((fimVisivel - abertura) / PASSO_MINUTOS)

  return {
    linhaInicial,
    linhas: Math.max(1, linhaFinal - linhaInicial),
    transbordou: cortadoNoInicio || cortadoNoFim,
  }
}

/** `'2026-08-10'` → `'10 de agosto a 16 de agosto de 2026'`. */
export function rotuloDoPeriodo(inicioISO: string): string {
  const fimISO = deslocarData(inicioISO, 6)
  const anoInicio = inicioISO.slice(0, 4)
  const anoFim = fimISO.slice(0, 4)

  // Semana que vira o ano precisa dos dois anos, ou "28 de dezembro a 3 de
  // janeiro de 2027" sugeriria que dezembro também é de 2027.
  const inicio =
    anoInicio === anoFim
      ? formatarDataExtensa(inicioISO)
      : `${formatarDataExtensa(inicioISO)} de ${anoInicio}`

  return `${inicio} a ${formatarDataExtensa(fimISO)} de ${anoFim}`
}
