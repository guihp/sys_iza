/**
 * Horário de atendimento da clínica.
 *
 * Função pura, como a detecção de conflito: recebe um intervalo e devolve se ele
 * cabe no expediente. Nenhum acesso a banco, nenhum React, nenhum Next.
 *
 * A regra é irmã da de conflito, mas responde a outra pergunta. Conflito é
 * "esse horário já é de outra pessoa"; expediente é "a clínica está aberta". As
 * duas precisam passar para a consulta ser marcada, e falhar em cada uma delas
 * dá uma mensagem diferente para a secretária.
 *
 * Todo o raciocínio acontece no relógio de parede de São Paulo, via
 * `@/lib/datetime`. Comparar o `getUTCHours()` de um `timestamptz` com "08:00"
 * daria certo por três horas de sorte e erraria o resto do dia.
 */

import {
  dataDaClinica,
  diaDaSemanaDaData,
  minutosDoDiaNaClinica,
  paredeDaClinica,
} from '@/lib/datetime'

/** Faixa de expediente no relógio da clínica, em `HH:MM`. Fechada nas duas pontas. */
export type Faixa = { de: string; ate: string }

/**
 * Expediente da semana, indexado por dia: posição 0 é domingo e 6 é sábado —
 * mesma numeração de `Date.prototype.getDay`. Dia sem faixa nenhuma é dia
 * fechado.
 */
export type HorarioDeAtendimento = readonly (readonly Faixa[])[]

/** Intervalo a validar. Mesmo formato do `Slot` de `conflict.ts`, de propósito. */
export type Intervalo = { inicio: Date; fim: Date }

const DIAS_DA_SEMANA = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const

/**
 * Expediente da Clínica Izadora. Único lugar a mexer quando o horário mudar:
 * daqui saem a validação do agendamento e as faixas clicáveis da grade da
 * agenda, então as duas não têm como divergir.
 *
 * Domingo fechado; sábado só de manhã.
 */
export const HORARIO_PADRAO: HorarioDeAtendimento = [
  [], // domingo
  [{ de: '08:00', ate: '20:00' }], // segunda
  [{ de: '08:00', ate: '20:00' }], // terça
  [{ de: '08:00', ate: '20:00' }], // quarta
  [{ de: '08:00', ate: '20:00' }], // quinta
  [{ de: '08:00', ate: '20:00' }], // sexta
  [{ de: '08:00', ate: '13:00' }], // sábado
]

/** `'08:30'` → `510`. */
export function minutosDeHHMM(hhmm: string): number {
  const [hora, minuto] = hhmm.split(':').map(Number)
  return hora * 60 + minuto
}

/** Faixas de expediente de uma data `YYYY-MM-DD`. Vazio = fechado. */
export function faixasDoDia(
  dataISO: string,
  horario: HorarioDeAtendimento = HORARIO_PADRAO,
): readonly Faixa[] {
  return horario[diaDaSemanaDaData(dataISO)] ?? []
}

/** A clínica abre nessa data? */
export function clinicaAbreEm(
  dataISO: string,
  horario: HorarioDeAtendimento = HORARIO_PADRAO,
): boolean {
  return faixasDoDia(dataISO, horario).length > 0
}

export type ResultadoDeValidacao = { ok: true } | { ok: false; motivo: string }

/**
 * Valida um intervalo contra o expediente e devolve, quando recusa, um motivo
 * pronto para a tela — em português e dizendo o horário do dia em questão, não
 * um "fora do horário" genérico que obriga a secretária a adivinhar.
 */
export function validarHorarioDeAtendimento(
  intervalo: Intervalo,
  horario: HorarioDeAtendimento = HORARIO_PADRAO,
): ResultadoDeValidacao {
  if (!(intervalo.fim.getTime() > intervalo.inicio.getTime())) {
    return { ok: false, motivo: 'A consulta precisa terminar depois de começar.' }
  }

  const dataInicio = dataDaClinica(intervalo.inicio)

  // Fim exatamente na virada da meia-noite ainda pertence ao dia que acabou —
  // por isso o `fim` é medido um instante antes. Sem esse ajuste, uma consulta
  // que terminasse 00:00 seria acusada de virar o dia.
  const ultimoInstante = new Date(intervalo.fim.getTime() - 1)
  if (dataDaClinica(ultimoInstante) !== dataInicio) {
    return { ok: false, motivo: 'A consulta precisa começar e terminar no mesmo dia.' }
  }

  const faixas = faixasDoDia(dataInicio, horario)
  const nomeDoDia = DIAS_DA_SEMANA[paredeDaClinica(intervalo.inicio).diaDaSemana]

  if (faixas.length === 0) {
    return { ok: false, motivo: `A clínica não atende ${nomeDoDia}.` }
  }

  const inicioEmMinutos = minutosDoDiaNaClinica(intervalo.inicio)
  // O fim é contado a partir do início: ler o relógio do instante final daria
  // 0 numa consulta que termina à meia-noite, e no dia da virada do horário de
  // verão a diferença entre os dois relógios acrescentaria uma hora fantasma.
  const duracao = Math.round((intervalo.fim.getTime() - intervalo.inicio.getTime()) / 60_000)
  const fimEmMinutos = inicioEmMinutos + duracao

  const cabe = faixas.some(
    (faixa) => inicioEmMinutos >= minutosDeHHMM(faixa.de) && fimEmMinutos <= minutosDeHHMM(faixa.ate),
  )
  if (cabe) return { ok: true }

  const expediente = faixas.map((faixa) => `${faixa.de} às ${faixa.ate}`).join(' e das ')
  return {
    ok: false,
    motivo: `A clínica atende ${nomeDoDia} das ${expediente}. A consulta inteira precisa caber nesse intervalo.`,
  }
}

/** Versão booleana, para quando só interessa habilitar ou desabilitar um horário. */
export function dentroDoHorarioDeAtendimento(
  intervalo: Intervalo,
  horario: HorarioDeAtendimento = HORARIO_PADRAO,
): boolean {
  return validarHorarioDeAtendimento(intervalo, horario).ok
}
