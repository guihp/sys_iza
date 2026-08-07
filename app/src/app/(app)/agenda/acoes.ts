'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSessao } from '@/auth/session'
import { detectarConflito, type Slot } from '@/domain/scheduling/conflict'
import { validarHorarioDeAtendimento } from '@/domain/scheduling/working-hours'
import { enfileirarConversoes } from '@/lib/conversoes'
import { dataDaClinica, deslocarData, horaDaClinica, instanteDaClinica } from '@/lib/datetime'
import { sincronizarConsultaNoGoogle } from '@/lib/google-agenda'
import { planejarLembretesDaConsulta } from '@/lib/lembretes'
import { createServerClient } from '@/lib/supabase/server'

const CAMINHO_AGENDA = '/agenda'
const CAMINHO_FUNIL = '/crm'

/** Código do Postgres para violação de constraint de exclusão. */
const SOBREPOSICAO = '23P01'

const schema = z.object({
  pacienteId: z.uuid(),
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
 * Marca uma consulta.
 *
 * Três barreiras, nesta ordem, e nenhuma delas dispensa a outra:
 *   1. Horário de atendimento (`validarHorarioDeAtendimento`) — a clínica está
 *      aberta?
 *   2. Conflito (`detectarConflito`) — o horário já é de outra pessoa?
 *   3. A constraint `appointments_sem_sobreposicao`, no banco — fecha a janela
 *      de corrida entre a leitura da agenda e a gravação, que as duas primeiras
 *      não têm como fechar.
 *
 * As duas primeiras existem para dar uma mensagem em português a quem está
 * marcando; a terceira existe para garantir o dado. Se só houvesse a terceira, o
 * usuário levaria um erro de banco na cara; se só houvesse as duas primeiras,
 * dois agendamentos simultâneos passariam.
 *
 * Sem checagem de papel: marcar consulta é o trabalho diário da secretária, e a
 * policy "equipe agenda" da migration 0005 reflete isso.
 */
export async function agendarConsulta(entrada: unknown): Promise<ResultadoDeAgendamento> {
  const sessao = await requireSessao()

  const analise = schema.safeParse(entrada)
  if (!analise.success) {
    return { ok: false, erro: 'Preencha paciente, procedimento e horário para agendar.' }
  }
  const dados = analise.data

  const supabase = await createServerClient()

  // A duração sai do catálogo, não do formulário: é o procedimento que define
  // quanto tempo a cadeira fica ocupada, e deixar isso digitável abriria espaço
  // para agendar uma toxina em quinze minutos.
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

  // Janela de busca no calendário da CLÍNICA, não no dia UTC: às 21:00 de
  // Brasília o UTC já virou o dia, e um recorte por dia UTC perderia metade da
  // noite. As doze horas para trás pegam a consulta que começou antes da janela
  // e ainda está em andamento dentro dela.
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

  // O status vai inteiro para o domínio em vez de ser filtrado na consulta: a
  // regra "cancelado não ocupa horário" mora em conflict.ts, coberta por teste,
  // e é lá que ela deve ser aplicada.
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
      patient_id: dados.pacienteId,
      procedure_id: dados.procedimentoId,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
    })
    .select('id')
    .single()

  if (error || !consulta) {
    // A corrida que as checagens acima não pegam: outra pessoa gravou o mesmo
    // horário entre a nossa leitura e a nossa escrita. A constraint do banco
    // barrou, e aqui isso vira a mesma frase que o usuário leria pelo caminho
    // normal — não um código de Postgres.
    if (error?.code === SOBREPOSICAO) {
      return { ok: false, erro: 'Esse horário acabou de ser ocupado. Escolha outro.' }
    }
    return { ok: false, erro: 'Não foi possível agendar. Tente de novo.' }
  }

  // O funil acompanha a agenda: quem tem consulta marcada está em 'agendado'.
  // Vale também para quem já era paciente e voltou — o estágio descreve a
  // relação de agora, e a Task 8 move para 'compareceu' quando a consulta
  // acontecer. Falha aqui não desfaz o agendamento: a consulta marcada é o dado
  // que importa, o cartão do kanban se corrige no arrasto.
  //
  // O estágio de antes é lido primeiro porque é ele que diz quantos degraus o
  // funil subiu — e `Schedule` é justamente o evento por que a Meta otimiza.
  const { data: pacienteAntes } = await supabase
    .from('patients')
    .select('stage')
    .eq('id', dados.pacienteId)
    .single()

  await supabase.from('patients').update({ stage: 'agendado' }).eq('id', dados.pacienteId)

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'agendou',
    entidade: 'appointments',
    registro_id: consulta.id,
  })

  // Lembretes da consulta: confirmação na véspera e aviso curto no dia. O que
  // sai daqui depende do consentimento da paciente (`aceita_whatsapp` /
  // `aceita_email`) e de haver telefone e e-mail no cadastro — a decisão é do
  // domínio, em plan-reminders.ts.
  //
  // Falha aqui não desfaz o agendamento, pelo mesmo critério do estágio do funil
  // e do audit_log acima: a consulta marcada é o dado que importa, e derrubá-la
  // por causa de um lembrete deixaria a secretária com a paciente na linha e sem
  // horário. Lembrete que não foi planejado se recupera replanejando — a chave
  // de idempotência garante que replanejar não duplica.
  await planejarLembretesDaConsulta(supabase, {
    appointmentId: consulta.id,
    patientId: dados.pacienteId,
    inicio,
  })

  // Espelho no Google Agenda, para a Dra. ver o horário no celular junto com o
  // resto da vida dela. Efeito colateral best-effort, o último de todos e o mais
  // dispensável: a agenda de verdade é a tabela `appointments`.
  //
  // Sem try/catch aqui porque `sincronizarConsultaNoGoogle` já garante não
  // lançar — o try/catch dela envolve até a leitura do ambiente. Quando não há
  // credencial configurada, que é o estado da clínica hoje, ela sai calada: sem
  // erro na tela e sem uma linha de log a cada consulta marcada.
  await sincronizarConsultaNoGoogle(supabase, consulta.id)

  // Conversão para a Meta. `Schedule` é o evento por que a clínica decidiu
  // otimizar, então este é o ponto mais importante da corrente inteira — e
  // ainda assim é best-effort, pelo mesmo critério de tudo que veio depois do
  // `insert`: a consulta marcada é o dado que importa, e derrubá-la por causa
  // de um evento de marketing deixaria a secretária com a paciente na linha e
  // sem horário. `enfileirarConversoes` não lança; ver o contrato do módulo.
  await enfileirarConversoes(supabase, {
    patientId: dados.pacienteId,
    estagioAnterior: (pacienteAntes as { stage: string } | null)?.stage ?? null,
    estagioNovo: 'agendado',
  })

  revalidatePath(CAMINHO_AGENDA)
  revalidatePath(CAMINHO_FUNIL)
  return { ok: true, id: consulta.id }
}
