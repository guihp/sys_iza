/**
 * Ponte entre o planejamento puro de lembretes e a tabela `reminder_jobs`.
 *
 * Aqui mora o I/O que `src/domain/reminders/` não pode ter: ler o consentimento
 * e os contatos do paciente, e gravar a fila. A regra — quantos lembretes, para
 * quando, por qual canal — continua inteira no domínio, coberta por teste sem
 * banco.
 *
 * Módulo comum às duas Server Actions que planejam lembrete (`agendarConsulta` e
 * `registrarAtendimento`) e, por isso, deliberadamente fora de um arquivo
 * `'use server'`: arquivo com essa diretiva só pode exportar função async, e
 * transformar este helper em endpoint público seria expor o planejamento de
 * lembrete a qualquer POST.
 */

import type { createServerClient } from '@/lib/supabase/server'
import {
  consentimentoDeContato,
  planejarLembretes,
  planejarLembretesPosAtendimento,
  type JobPlanejado,
} from '@/domain/reminders/plan-reminders'

type Cliente = Awaited<ReturnType<typeof createServerClient>>

/**
 * Resultado do planejamento.
 *
 * `criados` conta as linhas que a fila de fato aceitou — pode ser menor que o
 * planejado quando o `on conflict do nothing` engole uma chave que já existia,
 * e pode ser zero legitimamente (paciente sem canal, consulta em cima da hora).
 */
export type ResultadoDoPlanejamento = { ok: true; criados: number } | { ok: false; erro: string }

type ContatoDoPaciente = {
  telefone: string | null
  email: string | null
  aceita_whatsapp: boolean
  aceita_email: boolean
}

async function lerContato(
  supabase: Cliente,
  patientId: string,
): Promise<ContatoDoPaciente | null> {
  const { data, error } = await supabase
    .from('patients')
    .select('telefone, email, aceita_whatsapp, aceita_email')
    .eq('id', patientId)
    .single()

  if (error || !data) return null
  return data as ContatoDoPaciente
}

/**
 * Grava os jobs planejados.
 *
 * `ignoreDuplicates` traduz para `on conflict do nothing` sobre
 * `chave_idempotencia`: planejar duas vezes a mesma consulta não duplica
 * mensagem nem devolve erro. Quem garante isso é a constraint do banco, não uma
 * checagem daqui — entre "ler se já existe" e "gravar" cabe outra requisição.
 */
async function gravar(supabase: Cliente, jobs: JobPlanejado[]): Promise<ResultadoDoPlanejamento> {
  if (jobs.length === 0) return { ok: true, criados: 0 }

  const { data, error } = await supabase
    .from('reminder_jobs')
    .upsert(
      jobs.map((job) => ({
        appointment_id: job.appointmentId,
        attendance_id: job.attendanceId,
        patient_id: job.patientId,
        kind: job.kind,
        channel: job.channel,
        agendado_para: job.agendadoPara.toISOString(),
        chave_idempotencia: job.chaveIdempotencia,
      })),
      { onConflict: 'chave_idempotencia', ignoreDuplicates: true },
    )
    .select('id')

  if (error) return { ok: false, erro: error.message }
  return { ok: true, criados: data?.length ?? 0 }
}

/**
 * Cancela lembretes ainda pendentes de uma consulta.
 *
 * Usado em remarcação e cancelamento. Além de marcar `cancelado`, reescreve
 * `chave_idempotencia` com sufixo único: a chave original é `{consulta}:{tipo}:
 * {canal}` sem horário, e o upsert de replanejamento usa `ignoreDuplicates` —
 * sem liberar a chave, jobs cancelados bloqueariam os novos para sempre.
 */
export async function cancelarLembretesPendentesDaConsulta(
  supabase: Cliente,
  appointmentId: string,
): Promise<{ ok: true; cancelados: number } | { ok: false; erro: string }> {
  const { data, error } = await supabase
    .from('reminder_jobs')
    .select('id, chave_idempotencia')
    .eq('appointment_id', appointmentId)
    .eq('status', 'pendente')

  if (error) return { ok: false, erro: error.message }

  const agora = Date.now()
  let cancelados = 0
  for (const job of data ?? []) {
    const { error: erroUpdate } = await supabase
      .from('reminder_jobs')
      .update({
        status: 'cancelado',
        chave_idempotencia: `${job.chave_idempotencia}:cancelado:${agora}:${job.id}`,
      })
      .eq('id', job.id)
      .eq('status', 'pendente')

    if (erroUpdate) return { ok: false, erro: erroUpdate.message }
    cancelados += 1
  }

  return { ok: true, cancelados }
}

/** Lembretes de agenda: confirmação na véspera e aviso curto no dia. */
export async function planejarLembretesDaConsulta(
  supabase: Cliente,
  consulta: { appointmentId: string; patientId: string; inicio: Date },
): Promise<ResultadoDoPlanejamento> {
  const contato = await lerContato(supabase, consulta.patientId)
  if (!contato) return { ok: false, erro: 'Paciente não encontrado para planejar lembretes.' }

  const consentimento = consentimentoDeContato({
    aceitaWhatsapp: contato.aceita_whatsapp,
    aceitaEmail: contato.aceita_email,
    telefone: contato.telefone,
    email: contato.email,
  })

  return gravar(
    supabase,
    planejarLembretes({
      appointmentId: consulta.appointmentId,
      patientId: consulta.patientId,
      inicio: consulta.inicio,
      ...consentimento,
    }),
  )
}

/** Lembretes de pós-atendimento: cuidados, avaliação e aviso de retorno. */
export async function planejarLembretesDoAtendimento(
  supabase: Cliente,
  atendimento: {
    attendanceId: string
    patientId: string
    realizadoEm: Date
    /** Âncora de dia de calendário, vinda de `diaDeCalendario()`. */
    retornoVencimento: Date | null
  },
): Promise<ResultadoDoPlanejamento> {
  const contato = await lerContato(supabase, atendimento.patientId)
  if (!contato) return { ok: false, erro: 'Paciente não encontrado para planejar lembretes.' }

  const consentimento = consentimentoDeContato({
    aceitaWhatsapp: contato.aceita_whatsapp,
    aceitaEmail: contato.aceita_email,
    telefone: contato.telefone,
    email: contato.email,
  })

  return gravar(
    supabase,
    planejarLembretesPosAtendimento({
      attendanceId: atendimento.attendanceId,
      patientId: atendimento.patientId,
      realizadoEm: atendimento.realizadoEm,
      retornoVencimento: atendimento.retornoVencimento,
      ...consentimento,
    }),
  )
}
