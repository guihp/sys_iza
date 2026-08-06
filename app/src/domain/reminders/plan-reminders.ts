/**
 * Planejamento dos lembretes de uma consulta e de um atendimento.
 *
 * Módulo puro: sem I/O, sem Supabase, sem React, sem Next. Recebe o que já se
 * sabe sobre a consulta ou o atendimento e devolve a lista do que deve ser
 * enviado, quando e por onde. Quem grava em `reminder_jobs` é a Server Action;
 * quem decide o que existe é este arquivo, e é por isso que cada gatilho e cada
 * borda de opt-out têm teste unitário sem banco e sem mock.
 *
 * São cinco gatilhos, três de agenda e dois de pós-atendimento:
 *
 *   1. `confirmacao`      — véspera, 09:00 locais, WhatsApp e e-mail.
 *   2. `vespera_curta`    — 3 horas antes, só WhatsApp.
 *   3. `pos_procedimento` — 24 horas depois do atendimento, só WhatsApp.
 *   4. `avaliacao`        — 7 dias depois do atendimento, só WhatsApp.
 *   5. `retorno`          — 7 dias antes do vencimento, WhatsApp e e-mail.
 *
 * A janela de silêncio (`quiet-hours.ts`) NÃO é aplicada aqui. Ela roda no
 * despacho, porque o que importa é a hora real do envio: entre planejar e
 * enviar cabe atraso do worker, e um job planejado para as 20:00 que só sai às
 * 21:30 tem de ser barrado. Fixar o horário no planejamento daria uma garantia
 * falsa.
 */

import { dataDaClinica, dataDoDiaDeCalendario, deslocarData, instanteDaClinica } from '@/lib/datetime'

export type ReminderKind =
  | 'confirmacao'
  | 'vespera_curta'
  | 'pos_procedimento'
  | 'avaliacao'
  | 'retorno'

export type Canal = 'whatsapp' | 'email'

export type JobPlanejado = {
  /** Consulta que originou o lembrete. Nulo nos gatilhos de pós-atendimento. */
  appointmentId: string | null
  /** Atendimento que originou o lembrete. Nulo nos gatilhos de agenda. */
  attendanceId: string | null
  patientId: string
  kind: ReminderKind
  channel: Canal
  agendadoPara: Date
  /**
   * Identidade do lembrete, estável entre execuções. É ela que a constraint
   * `unique` de `reminder_jobs` usa para transformar reprocessamento em
   * no-op — ver a nota sobre idempotência mais abaixo.
   */
  chaveIdempotencia: string
}

export type EntradaConsulta = {
  appointmentId: string
  patientId: string
  inicio: Date
  aceitaWhatsapp: boolean
  aceitaEmail: boolean
  /**
   * Instante de referência para descartar o que já passou. Injetável para que o
   * teste não dependa da data em que roda; em produção é o `new Date()` de quem
   * chama.
   */
  agora?: Date
}

export type EntradaAtendimento = {
  attendanceId: string
  patientId: string
  realizadoEm: Date
  /**
   * Vencimento do retorno, ou `null` quando não há retorno.
   *
   * Dia de calendário, não instante: a coluna `retorno_vencimento` é `date` no
   * Postgres e chega aqui ancorada por `diaDeCalendario()` — meia-noite UTC do
   * mesmo dia. Por isso o dia é lido de volta em UTC, e não no fuso da clínica:
   * ler a âncora de 18/12 no relógio de São Paulo daria 17/12 às 21:00, e o
   * lembrete sairia um dia adiantado.
   */
  retornoVencimento: Date | null
  aceitaWhatsapp: boolean
  aceitaEmail: boolean
  agora?: Date
}

const HORA_EM_MS = 3_600_000
const DIA_EM_MS = 24 * HORA_EM_MS

/** Horas antes da consulta em que sai o lembrete curto do mesmo dia. */
export const ANTECEDENCIA_VESPERA_CURTA_HORAS = 3

/** Horas depois do procedimento em que saem as orientações de cuidado. */
export const ATRASO_POS_PROCEDIMENTO_HORAS = 24

/** Dias depois do procedimento em que se pergunta pelo resultado. */
export const ATRASO_AVALIACAO_DIAS = 7

/**
 * Dias de antecedência do aviso de retorno.
 *
 * Sete, e não os trinta da janela `vencendo` da fila de retornos
 * (`JANELA_VENCENDO_DIAS`, em `compute-return.ts`): são coisas diferentes. A
 * fila é a tela de trabalho da secretária, que precisa de mês para conseguir
 * falar com todo mundo; a mensagem automática é um toque só, e um mês antes o
 * paciente esquece antes de a data chegar.
 */
export const ANTECEDENCIA_RETORNO_DIAS = 7

/** Hora local em que sai a confirmação da véspera e o aviso de retorno. */
const HORA_DO_AVISO = 9

/**
 * Consentimento efetivo por canal.
 *
 * Duas condições, e as duas são obrigatórias: o paciente aceitar aquele canal
 * (`aceita_whatsapp` / `aceita_email`, na tabela `patients`) **e** existir
 * endereço para onde mandar. Quem optou por não receber não recebe — é o pedido
 * explícito da pessoa e não se contorna. Quem aceitou mas não deixou telefone
 * também não recebe, por motivo diferente: não há para onde enviar, e planejar
 * um job sem destino só produziria falha de envio no worker horas depois, longe
 * de qualquer tela onde alguém pudesse consertar.
 */
export function consentimentoDeContato(paciente: {
  aceitaWhatsapp: boolean
  aceitaEmail: boolean
  telefone: string | null
  email: string | null
}): { aceitaWhatsapp: boolean; aceitaEmail: boolean } {
  return {
    aceitaWhatsapp: paciente.aceitaWhatsapp && !!paciente.telefone?.trim(),
    aceitaEmail: paciente.aceitaEmail && !!paciente.email?.trim(),
  }
}

function canaisAtivos(aceitaWhatsapp: boolean, aceitaEmail: boolean): Canal[] {
  const lista: Canal[] = []
  if (aceitaWhatsapp) lista.push('whatsapp')
  if (aceitaEmail) lista.push('email')
  return lista
}

/**
 * 09:00 do relógio da clínica no dia anterior ao da consulta.
 *
 * O dia sai de `dataDaClinica`, não de uma subtração de 24 horas sobre o
 * instante: a consulta das 23:00 de Brasília já é o dia seguinte em UTC, e
 * contar em milissegundos mandaria a confirmação na antevéspera. Pelo mesmo
 * motivo o horário volta por `instanteDaClinica`, que consulta a tzdata — sob
 * horário de verão as 09:00 locais não são o mesmo offset do resto do ano.
 */
function avisoDaVespera(inicio: Date): Date {
  const vespera = deslocarData(dataDaClinica(inicio), -1)
  return instanteDaClinica(vespera, HORA_DO_AVISO * 60)
}

/**
 * 09:00 do relógio da clínica, `ANTECEDENCIA_RETORNO_DIAS` antes do vencimento.
 *
 * O dia sai da âncora em UTC (ver `EntradaAtendimento.retornoVencimento`) e a
 * hora volta pelo fuso da clínica: o vencimento é dia de calendário, o envio é
 * um instante, e a conversão entre os dois acontece exatamente aqui.
 */
function avisoDeRetorno(vencimento: Date): Date {
  const dia = deslocarData(dataDoDiaDeCalendario(vencimento), -ANTECEDENCIA_RETORNO_DIAS)
  return instanteDaClinica(dia, HORA_DO_AVISO * 60)
}

/**
 * Lembrete cujo instante já passou não é criado.
 *
 * Vale para os cinco gatilhos, e é decisão consciente — não um efeito colateral.
 * Toda mensagem daqui fala de um evento futuro: "sua consulta é amanhã", "seu
 * horário é hoje às 14h", "seu retorno está chegando". Entregue depois do fato,
 * ela é ruído no melhor caso e constrangimento no pior — a paciente que já foi
 * atendida às 14h recebendo às 18h um aviso de que o horário é às 14h.
 *
 * Filtrar aqui e não no despacho porque é aqui que a informação existe: o worker
 * vê um job pendente com hora vencida e não tem como distinguir "nasceu
 * atrasado" de "o worker caiu por duas horas e este é um envio legítimo em
 * atraso". Na prática isto significa que consulta marcada em cima da hora sai
 * sem lembrete nenhum — que é o certo: quem acabou de marcar por telefone não
 * precisa ser lembrado da conversa que teve há cinco minutos.
 */
function aindaVaiAcontecer(momento: Date, agora: Date): boolean {
  return momento.getTime() > agora.getTime()
}

/**
 * Lembretes de uma consulta recém-marcada.
 *
 * Sobre a chave de idempotência: ela é `{consulta}:{tipo}:{canal}`, sem o
 * horário. Reprocessar a mesma consulta não duplica lembrete — o segundo insert
 * esbarra na constraint `unique` do banco, não numa checagem da aplicação. A
 * contrapartida é que remarcar a consulta não reescreve sozinho os jobs já
 * planejados: quando a remarcação existir, ela precisará cancelar os pendentes
 * (status `cancelado`) e replanejar, e é de propósito que a chave torne isso
 * uma decisão explícita em vez de uma duplicação silenciosa.
 */
export function planejarLembretes(entrada: EntradaConsulta): JobPlanejado[] {
  const canais = canaisAtivos(entrada.aceitaWhatsapp, entrada.aceitaEmail)
  if (canais.length === 0) return []

  const agora = entrada.agora ?? new Date()
  const jobs: JobPlanejado[] = []

  const vinculo = {
    appointmentId: entrada.appointmentId,
    attendanceId: null,
    patientId: entrada.patientId,
  }

  // 1. Confirmação: véspera às 09:00, nos dois canais disponíveis. É a mensagem
  //    que reduz falta — dá tempo de a paciente avisar que não vem e de a
  //    secretária oferecer o horário para outra pessoa.
  const momentoConfirmacao = avisoDaVespera(entrada.inicio)
  if (aindaVaiAcontecer(momentoConfirmacao, agora)) {
    for (const channel of canais) {
      jobs.push({
        ...vinculo,
        kind: 'confirmacao',
        channel,
        agendadoPara: momentoConfirmacao,
        chaveIdempotencia: `${entrada.appointmentId}:confirmacao:${channel}`,
      })
    }
  }

  // 2. Véspera curta: 3h antes, só WhatsApp. E-mail não entra: mensagem de "é
  //    hoje às 14h" só serve se for lida nas próximas horas, e caixa de entrada
  //    não tem essa garantia.
  const momentoVespera = new Date(
    entrada.inicio.getTime() - ANTECEDENCIA_VESPERA_CURTA_HORAS * HORA_EM_MS,
  )
  if (entrada.aceitaWhatsapp && aindaVaiAcontecer(momentoVespera, agora)) {
    jobs.push({
      ...vinculo,
      kind: 'vespera_curta',
      channel: 'whatsapp',
      agendadoPara: momentoVespera,
      chaveIdempotencia: `${entrada.appointmentId}:vespera_curta:whatsapp`,
    })
  }

  return jobs
}

/**
 * Lembretes disparados por um atendimento registrado.
 *
 * Os dois primeiros contam tempo decorrido a partir do instante do atendimento
 * — "24 horas depois", "uma semana depois" — e por isso são aritmética de
 * milissegundos, sem fuso: o que importa é o intervalo, não a hora do relógio.
 * O terceiro é o oposto: nasce de um dia de calendário e vira instante pelo
 * relógio da clínica.
 */
export function planejarLembretesPosAtendimento(entrada: EntradaAtendimento): JobPlanejado[] {
  const canais = canaisAtivos(entrada.aceitaWhatsapp, entrada.aceitaEmail)
  if (canais.length === 0) return []

  const agora = entrada.agora ?? new Date()
  const jobs: JobPlanejado[] = []

  const vinculo = {
    appointmentId: null,
    attendanceId: entrada.attendanceId,
    patientId: entrada.patientId,
  }

  // 3 e 4. Cuidados e avaliação: só WhatsApp. São conversas — a paciente
  //        responde "está ardendo um pouco", e a Dra. responde de volta. Por
  //        e-mail viraria monólogo.
  if (entrada.aceitaWhatsapp) {
    const cuidados = new Date(
      entrada.realizadoEm.getTime() + ATRASO_POS_PROCEDIMENTO_HORAS * HORA_EM_MS,
    )
    if (aindaVaiAcontecer(cuidados, agora)) {
      jobs.push({
        ...vinculo,
        kind: 'pos_procedimento',
        channel: 'whatsapp',
        agendadoPara: cuidados,
        chaveIdempotencia: `${entrada.attendanceId}:pos_procedimento:whatsapp`,
      })
    }

    const avaliacao = new Date(entrada.realizadoEm.getTime() + ATRASO_AVALIACAO_DIAS * DIA_EM_MS)
    if (aindaVaiAcontecer(avaliacao, agora)) {
      jobs.push({
        ...vinculo,
        kind: 'avaliacao',
        channel: 'whatsapp',
        agendadoPara: avaliacao,
        chaveIdempotencia: `${entrada.attendanceId}:avaliacao:whatsapp`,
      })
    }
  }

  // 5. Retorno: uma semana antes do vencimento, nos dois canais. É o gatilho
  //    que traz a paciente de volta, e pode cair meses à frente — daí o cuidado
  //    de ancorar em dia de calendário e não em milissegundos.
  if (entrada.retornoVencimento) {
    const momento = avisoDeRetorno(entrada.retornoVencimento)
    if (aindaVaiAcontecer(momento, agora)) {
      for (const channel of canais) {
        jobs.push({
          ...vinculo,
          kind: 'retorno',
          channel,
          agendadoPara: momento,
          chaveIdempotencia: `${entrada.attendanceId}:retorno:${channel}`,
        })
      }
    }
  }

  return jobs
}
