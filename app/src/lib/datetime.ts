/**
 * Timezone da clínica.
 *
 * Toda regra de negócio do sistema — horário de atendimento, grade da agenda,
 * janela de silêncio dos lembretes — raciocina no relógio de parede de São
 * Paulo. O banco guarda `timestamptz`, o container roda em UTC e o navegador
 * roda no fuso de quem abriu a tela. Nenhum dos três serve como referência: o
 * único fuso certo é o da clínica, sempre explícito.
 *
 * A conversão sai do `Intl`, que carrega a base tzdata do sistema. É de
 * propósito: o Brasil já teve horário de verão (até 2019) e pode voltar a ter.
 * Um "menos três horas" escrito na mão acerta hoje e erra no dia do decreto —
 * e erra calado, remarcando consulta de paciente uma hora fora.
 *
 * Módulo puro: sem I/O, sem React, sem Next. Serve tanto ao `src/domain/`
 * quanto às telas.
 */

export const FUSO_CLINICA = 'America/Sao_Paulo'

const MINUTO = 60_000
const DIA = 86_400_000

/** Relógio de parede da clínica para um instante. */
export type Parede = {
  ano: number
  /** 1–12, como se lê num calendário — não o 0–11 do `Date`. */
  mes: number
  dia: number
  hora: number
  minuto: number
  segundo: number
  /** 0 = domingo … 6 = sábado, igual a `Date.prototype.getDay`. */
  diaDaSemana: number
}

// Um formatador só, criado uma vez: montar `Intl.DateTimeFormat` é caro e a
// agenda chama isto centenas de vezes ao desenhar uma semana.
const PARTES = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_CLINICA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const DATA_EXTENSA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
})

const DATA_EXTENSA_COM_ANO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function dois(valor: number): string {
  return String(valor).padStart(2, '0')
}

/** Decompõe um instante no relógio de parede da clínica. */
export function paredeDaClinica(instante: Date): Parede {
  const partes: Record<string, string> = {}
  for (const parte of PARTES.formatToParts(instante)) {
    if (parte.type !== 'literal') partes[parte.type] = parte.value
  }

  const ano = Number(partes.year)
  const mes = Number(partes.month)
  const dia = Number(partes.day)
  // `hour12: false` devolve 24 para a meia-noite em alguns runtimes; normalizar
  // aqui evita um "24:00" aparecendo na tela.
  const hora = Number(partes.hour) % 24
  const minuto = Number(partes.minute)
  const segundo = Number(partes.second)

  return {
    ano,
    mes,
    dia,
    hora,
    minuto,
    segundo,
    // O dia da semana sai da data já convertida, via UTC: pedir `weekday` ao
    // `Intl` daria texto, que teria de ser traduzido de volta para número.
    diaDaSemana: new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay(),
  }
}

/**
 * Quantos minutos o fuso da clínica está à frente do UTC naquele instante.
 * Negativo, porque São Paulo está a oeste: -180 em horário normal, -120 sob
 * horário de verão.
 */
export function offsetDaClinicaEmMinutos(instante: Date): number {
  const p = paredeDaClinica(instante)
  const comoSeFosseUTC = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo)
  // Arredonda para o minuto: `instante` pode carregar milissegundos, e offset de
  // fuso nunca tem fração de minuto.
  return Math.round((comoSeFosseUTC - instante.getTime()) / MINUTO)
}

/** Data no calendário da clínica, em `YYYY-MM-DD`. */
export function dataDaClinica(instante: Date): string {
  const { ano, mes, dia } = paredeDaClinica(instante)
  return `${ano}-${dois(mes)}-${dois(dia)}`
}

/** Hora no relógio da clínica, em `HH:MM`. */
export function horaDaClinica(instante: Date): string {
  const { hora, minuto } = paredeDaClinica(instante)
  return `${dois(hora)}:${dois(minuto)}`
}

/** Minutos decorridos desde a meia-noite local da clínica. */
export function minutosDoDiaNaClinica(instante: Date): number {
  const { hora, minuto } = paredeDaClinica(instante)
  return hora * 60 + minuto
}

/**
 * Caminho inverso: data e hora do relógio da clínica viram o instante UTC
 * correspondente.
 *
 * O offset depende do próprio instante que se quer descobrir — a pescadinha do
 * rabo na boca de toda conversão de fuso. Resolvido por aproximação: chuta-se
 * que o horário local é UTC, mede-se o offset ali, corrige-se, e mede-se de
 * novo. Duas passadas bastam porque o erro inicial é de no máximo umas horas e
 * a segunda medição já cai do lado certo de qualquer transição.
 *
 * Nas duas horas patológicas do ano de horário de verão o resultado é
 * aproximado, e é o comportamento aceito: a hora que não existiu (o relógio
 * pulou) cai no instante imediatamente anterior à virada, e a hora que
 * aconteceu duas vezes resolve para a primeira. Ambas as janelas caem de
 * madrugada, fora de qualquer horário de atendimento, e o que importa aqui é
 * nunca devolver `Invalid Date` no meio de um agendamento.
 */
export function instanteDaClinica(dataISO: string, minutosDoDia: number): Date {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  const alvo = Date.UTC(ano, mes - 1, dia) + minutosDoDia * MINUTO

  let instante = new Date(alvo)
  for (let passada = 0; passada < 2; passada += 1) {
    instante = new Date(alvo - offsetDaClinicaEmMinutos(instante) * MINUTO)
  }
  return instante
}

/** Aritmética de calendário sobre `YYYY-MM-DD`. Sem fuso envolvido. */
export function deslocarData(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  const movida = new Date(Date.UTC(ano, mes - 1, dia) + dias * DIA)
  return `${movida.getUTCFullYear()}-${dois(movida.getUTCMonth() + 1)}-${dois(movida.getUTCDate())}`
}

/** 0 = domingo … 6 = sábado, para uma data `YYYY-MM-DD`. */
export function diaDaSemanaDaData(dataISO: string): number {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

/** `2026-08-10` → `10 de agosto`. Para o cabeçalho das colunas da agenda. */
export function formatarDataExtensa(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return DATA_EXTENSA.format(new Date(Date.UTC(ano, mes - 1, dia)))
}

/**
 * `2026-12-03` → `3 de dezembro de 2026`.
 *
 * Com ano, ao contrário de `formatarDataExtensa`: retorno de procedimento cai
 * meses à frente e às vezes no ano seguinte, e "3 de dezembro" sem ano deixa a
 * Dra. adivinhando qual dezembro.
 */
export function formatarDataExtensaComAno(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return DATA_EXTENSA_COM_ANO.format(new Date(Date.UTC(ano, mes - 1, dia)))
}

/**
 * Nomes dos dias, indexados por `diaDaSemanaDaData` (0 = domingo).
 *
 * Tabela na mão, e não `Intl` com `weekday: 'long'`: em pt-BR o `Intl` devolve
 * "quinta-feira", e a barra superior pede "Quinta, 6 de agosto". Cortar o
 * "-feira" de um texto localizado é pior do que escrever os sete nomes.
 */
const DIAS_DA_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/** Meses abreviados em pt-BR, indexados a partir de 0. Tabela na mão pelo mesmo motivo. */
const MESES_CURTOS = [
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
]

/** `2026-08-06` → `Quinta, 6 de agosto`. A data de hoje na barra superior. */
export function formatarDiaComData(dataISO: string): string {
  return `${DIAS_DA_SEMANA[diaDaSemanaDaData(dataISO)]}, ${formatarDataExtensa(dataISO)}`
}

/**
 * `2026-01-09` → `9 jan 26`.
 *
 * Forma curta da tabela de retornos (atendida em / previsto). Sem zero à
 * esquerda no dia — o mockup escreve `9 jan 26`, não `09 jan 26`.
 */
export function formatarDataCurta(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return `${dia} ${MESES_CURTOS[mes - 1]} ${String(ano).slice(2)}`
}

/** Quantos dias tem o mês da data. Fevereiro bissexto sai certo pelo `Date`. */
export function diasNoMes(dataISO: string): number {
  const [ano, mes] = dataISO.split('-').map(Number)
  // Dia 0 do mês seguinte é o último dia deste mês.
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

/**
 * `YYYY-MM-DD` → o instante de meia-noite **UTC** daquele dia.
 *
 * Âncora de calendário, não conversão de fuso — e a diferença importa. O
 * vencimento de retorno é uma coluna `date` no Postgres: um dia do calendário,
 * sem hora e sem fuso. Para somar ou subtrair dias sobre ele é preciso virá-lo
 * `Date`, e a escolha da âncora decide se a conta erra.
 *
 * Ancorar no fuso da clínica (`instanteDaClinica`) seria o erro: sob horário de
 * verão dois dias vizinhos deixam de distar 24h exatas, e a contagem de dias da
 * fila de retornos passaria a errar por um em volta da virada. Ancorando em UTC,
 * todo dia tem exatamente 86.400.000 ms e a aritmética é exata o ano inteiro.
 *
 * O fuso entra uma vez só, antes disto: é `dataDaClinica(new Date())` quem
 * decide **qual** dia de calendário é hoje na clínica — às 22:00 de Brasília o
 * UTC já virou, e usar o dia do servidor marcaria paciente como atrasado um dia
 * antes da hora. Decidido o dia, o resto é calendário puro.
 */
export function diaDeCalendario(dataISO: string): Date {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, dia))
}

/** Inverso de `diaDeCalendario`: lê o dia da âncora, em UTC. */
export function dataDoDiaDeCalendario(instante: Date): string {
  return `${instante.getUTCFullYear()}-${dois(instante.getUTCMonth() + 1)}-${dois(instante.getUTCDate())}`
}
