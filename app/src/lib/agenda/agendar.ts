/**
 * Núcleo de agendamento compartilhado pela Server Action e pela API HTTP.
 *
 * Fora de `'use server'` de propósito: a diretiva só permite exportar função
 * async, e este módulo exporta schema Zod + tipo de resultado usados pela
 * rota `/api/agenda/agendar` e pelos testes.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { detectarConflito, type Slot } from '@/domain/scheduling/conflict'
import { validarHorarioDeAtendimento } from '@/domain/scheduling/working-hours'
import { enfileirarConversoes } from '@/lib/conversoes'
import { dataDaClinica, deslocarData, horaDaClinica, instanteDaClinica } from '@/lib/datetime'
import { sincronizarConsultaNoGoogle } from '@/lib/google-agenda'
import { executarCriacaoDeLead } from '@/lib/leads/criar'
import { planejarLembretesDaConsulta } from '@/lib/lembretes'
import { avisarEquipeDeNovoAgendamento } from '@/lib/push/enviar'

const CAMINHO_AGENDA = '/agenda'
const CAMINHO_FUNIL = '/crm'

/** Código do Postgres para violação de constraint de exclusão. */
const SOBREPOSICAO = '23P01'

export const schemaAgendamento = z
  .object({
    /** Paciente já no funil. Mutuamente exclusivo com `pacienteNovo`. */
    pacienteId: z.uuid().optional(),
    /**
     * Cadastro mínimo na hora do agendamento (nome; telefone opcional).
     * Cria o lead e marca a consulta no mesmo pedido.
     */
    pacienteNovo: z
      .object({
        nome: z
          .string()
          .trim()
          .min(1, 'Informe o nome da paciente.')
          .max(120, 'Nome longo demais.'),
        telefone: z.string().trim().max(40).optional(),
      })
      .optional(),
    procedimentoId: z.uuid(),
    /**
     * Instante absoluto em ISO 8601 com `Z`. Quem monta essa string é o
     * formulário, com `instanteDaClinica()` — função pura que aplica o fuso da
     * clínica explicitamente e por isso devolve o mesmo instante no servidor, no
     * navegador da secretária e no celular da Dra., independente do fuso de cada
     * um. Se aqui chegasse hora local sem fuso, a consulta cairia três horas fora.
     */
    inicio: z.iso.datetime(),
  })
  .superRefine((dados, ctx) => {
    const temId = Boolean(dados.pacienteId)
    const temNovo = Boolean(dados.pacienteNovo)
    if (temId === temNovo) {
      ctx.addIssue({
        code: 'custom',
        message: temId
          ? 'Informe só paciente da lista ou paciente novo — não os dois.'
          : 'Preencha paciente, procedimento e horário para agendar.',
      })
    }
  })

/**
 * Resultado de agendar.
 *
 * Retorno em vez de exceção porque, em produção, o Next apaga a mensagem de
 * qualquer erro lançado numa Server Action e entrega ao cliente um texto
 * genérico — proteção contra vazar detalhe de servidor. Só que "já existe
 * consulta às 14:00" é exatamente a informação que a secretária precisa ler
 * para escolher outro horário. Erro de negócio, portanto, é valor de retorno;
 * exceção fica para o que é de fato inesperado.
 */
export type ResultadoDeAgendamento = { ok: true; id: string } | { ok: false; erro: string }

/**
 * Marca uma consulta e dispara os mesmos efeitos colaterais da UI
 * (lembretes, Google, Meta, push à equipe).
 *
 * `atorId` pode ser `null` quando a chamada veio pela API com `API_KEY`
 * (sem sessão de usuário). O `audit_log.ator` aceita null.
 *
 * Três barreiras, nesta ordem, e nenhuma delas dispensa a outra:
 *   1. Horário de atendimento (`validarHorarioDeAtendimento`)
 *   2. Conflito (`detectarConflito`)
 *   3. A constraint `appointments_sem_sobreposicao`, no banco
 */
export async function executarAgendamento(
  supabase: SupabaseClient,
  entrada: unknown,
  atorId: string | null,
): Promise<ResultadoDeAgendamento> {
  const analise = schemaAgendamento.safeParse(entrada)
  if (!analise.success) {
    return {
      ok: false,
      erro:
        analise.error.issues[0]?.message ??
        'Preencha paciente, procedimento e horário para agendar.',
    }
  }
  const dados = analise.data

  let pacienteId = dados.pacienteId
  if (dados.pacienteNovo) {
    const criado = await executarCriacaoDeLead(
      supabase,
      {
        nome: dados.pacienteNovo.nome,
        telefone: dados.pacienteNovo.telefone,
        origem: 'Agenda',
        procedimentoInteresseId: dados.procedimentoId,
      },
      atorId,
    )
    if (!criado.ok) return criado
    pacienteId = criado.pacienteId
  }

  if (!pacienteId) {
    return { ok: false, erro: 'Preencha paciente, procedimento e horário para agendar.' }
  }

  const { data: procedimento, error: erroProcedimento } = await supabase
    .from('procedures')
    .select('id, nome, duracao_minutos')
    .eq('id', dados.procedimentoId)
    .single()

  if (erroProcedimento || !procedimento) {
    return { ok: false, erro: 'Procedimento não encontrado no catálogo.' }
  }

  const inicio = new Date(dados.inicio)
  const fim = new Date(inicio.getTime() + procedimento.duracao_minutos * 60_000)

  const expediente = validarHorarioDeAtendimento({ inicio, fim })
  if (!expediente.ok) return { ok: false, erro: expediente.motivo }

  const diaNaClinica = dataDaClinica(inicio)
  const janelaInicio = new Date(instanteDaClinica(diaNaClinica, 0).getTime() - 12 * 3_600_000)
  const janelaFim = instanteDaClinica(deslocarData(diaNaClinica, 1), 0)

  const { data: doDia, error: erroAgenda } = await supabase
    .from('appointments')
    .select('id, inicio, fim, status')
    .gte('inicio', janelaInicio.toISOString())
    .lt('inicio', janelaFim.toISOString())

  if (erroAgenda) {
    return { ok: false, erro: 'Não foi possível conferir a agenda. Tente de novo.' }
  }

  const existentes: Slot[] = (doDia ?? []).map((consulta) => ({
    id: consulta.id,
    inicio: new Date(consulta.inicio),
    fim: new Date(consulta.fim),
    cancelado: consulta.status === 'cancelado',
  }))

  const conflito = detectarConflito({ inicio, fim }, existentes)
  if (conflito) {
    return {
      ok: false,
      erro: `Já existe consulta das ${horaDaClinica(conflito.inicio)} às ${horaDaClinica(conflito.fim)} nesse horário.`,
    }
  }

  const { data: consulta, error } = await supabase
    .from('appointments')
    .insert({
      patient_id: pacienteId,
      procedure_id: dados.procedimentoId,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
    })
    .select('id')
    .single()

  if (error || !consulta) {
    if (error?.code === SOBREPOSICAO) {
      return { ok: false, erro: 'Esse horário acabou de ser ocupado. Escolha outro.' }
    }
    return { ok: false, erro: 'Não foi possível agendar. Tente de novo.' }
  }

  const { data: pacienteAntes } = await supabase
    .from('patients')
    .select('stage, nome_completo')
    .eq('id', pacienteId)
    .single()

  await supabase.from('patients').update({ stage: 'agendado' }).eq('id', pacienteId)

  await supabase.from('audit_log').insert({
    ator: atorId,
    acao: 'agendou',
    entidade: 'appointments',
    registro_id: consulta.id,
  })

  await planejarLembretesDaConsulta(supabase, {
    appointmentId: consulta.id,
    patientId: pacienteId,
    inicio,
  })

  await sincronizarConsultaNoGoogle(supabase, consulta.id)

  await enfileirarConversoes(supabase, {
    patientId: pacienteId,
    estagioAnterior: (pacienteAntes as { stage: string } | null)?.stage ?? null,
    estagioNovo: 'agendado',
  })

  await avisarEquipeDeNovoAgendamento({
    nomePaciente: pacienteAntes?.nome_completo ?? 'Paciente',
    nomeProcedimento: procedimento.nome,
    inicio,
  })

  revalidatePath(CAMINHO_AGENDA)
  revalidatePath(CAMINHO_FUNIL)
  return { ok: true, id: consulta.id }
}
