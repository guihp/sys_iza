/**
 * Ponte entre a tabela `appointments` e o Google Agenda.
 *
 * Mesma divisão de `lib/lembretes.ts`: o I/O de banco mora aqui, o adaptador
 * (`@/integrations/google/calendar`) só fala HTTP, e a montagem do evento é uma
 * função pura testada sem rede. Também pelo mesmo motivo prático — arquivo com
 * `'use server'` só exporta função async, e transformar isto num endpoint
 * público deixaria qualquer POST mexer na agenda da Dra.
 *
 * ---------------------------------------------------------------------------
 * O contrato: esta função NUNCA lança
 * ---------------------------------------------------------------------------
 * Ela é chamada depois de a consulta já estar gravada, e o Google é um espelho
 * de conveniência. Uma exceção escapando daqui subiria pela Server Action e a
 * secretária veria "não foi possível agendar" para uma consulta que ESTÁ na
 * agenda — o pior desfecho possível, porque ela remarcaria por cima.
 *
 * Por isso o corpo inteiro vive dentro de um `try`, inclusive a criação do
 * cliente: `serverEnv()` lança quando o ambiente está incompleto, e nem isso
 * pode derrubar o agendamento.
 *
 * ---------------------------------------------------------------------------
 * Ciclo de vida do evento
 * ---------------------------------------------------------------------------
 * Uma função só cobre os três momentos, decidindo pelo estado atual da linha:
 *
 *   - consulta ativa, sem `google_event_id` → cria o evento e guarda o id;
 *   - consulta ativa, com `google_event_id` → PATCH no evento existente. É o
 *     caminho da REMARCAÇÃO: o mesmo evento muda de horário no celular da Dra.,
 *     em vez de aparecer um segundo bloco no horário velho;
 *   - consulta cancelada, com `google_event_id` → apaga o evento no Google e
 *     zera a coluna. É o caminho do CANCELAMENTO: o horário some do celular
 *     dela, e o `null` deixa a linha pronta para uma recriação futura;
 *   - consulta cancelada, sem evento → não há o que fazer.
 *
 * `google_event_id` nulo é sempre a verdade segura: significa "não existe
 * evento lá" e leva a próxima sincronia a criar. Um id apontando para evento
 * inexistente, ao contrário, produziria PATCH falhando para sempre — daí a
 * coluna ser limpa no cancelamento.
 *
 * Nenhuma tela chama ainda os caminhos de remarcação e cancelamento: mudar
 * status e horário de consulta é trabalho de uma task posterior, e quando essa
 * ação existir basta ela chamar esta mesma função depois do `update`.
 */

import type { createServerClient } from '@/lib/supabase/server'
import {
  criarGoogleCalendarClient,
  montarEvento,
  type GoogleCalendarClient,
} from '@/integrations/google/calendar'

type Cliente = Awaited<ReturnType<typeof createServerClient>>

export type SituacaoDaSincronia =
  /** Não há credencial do Google configurada. Estado normal, não é falha. */
  | 'desligada'
  | 'criado'
  | 'atualizado'
  | 'removido'
  /** Consulta cancelada que nunca chegou a ter evento. */
  | 'sem evento'

export type ResultadoDaSincronia =
  | { ok: true; situacao: SituacaoDaSincronia }
  | { ok: false; erro: string }

/** Forma bruta da linha com os dois relacionamentos, como em `agenda/page.tsx`. */
type LinhaDaConsulta = {
  id: string
  inicio: string
  fim: string
  status: string
  observacoes: string | null
  google_event_id: string | null
  patients: { nome_completo: string } | null
  procedures: { nome: string } | null
}

function descrever(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa)
}

/**
 * Espelha a consulta no Google Agenda.
 *
 * @param cliente Adaptador já pronto. Omitir usa o ambiente — que é o caminho
 * de produção; `null` força o modo desligado, usado no teste.
 */
export async function sincronizarConsultaNoGoogle(
  supabase: Cliente,
  appointmentId: string,
  cliente?: GoogleCalendarClient | null,
): Promise<ResultadoDaSincronia> {
  try {
    const google = cliente === undefined ? criarGoogleCalendarClient() : cliente
    // Sem credencial não há erro nenhum a registrar: a clínica simplesmente não
    // ligou a integração. Sair calado aqui é o que permite o sistema rodar
    // indefinidamente sem conta no Google Cloud.
    if (!google) return { ok: true, situacao: 'desligada' }

    const { data, error } = await supabase
      .from('appointments')
      .select(
        'id, inicio, fim, status, observacoes, google_event_id, patients(nome_completo), procedures(nome)',
      )
      .eq('id', appointmentId)
      .single()

    if (error || !data) {
      return avisar(`não foi possível ler a consulta ${appointmentId}`, error?.message)
    }

    const consulta = data as unknown as LinhaDaConsulta

    if (consulta.status === 'cancelado') {
      if (!consulta.google_event_id) return { ok: true, situacao: 'sem evento' }

      await google.removerEvento(consulta.google_event_id)
      await supabase
        .from('appointments')
        .update({ google_event_id: null })
        .eq('id', appointmentId)
      return { ok: true, situacao: 'removido' }
    }

    const evento = montarEvento({
      // Paciente ou procedimento apagado deixa o relacionamento nulo. O evento
      // ainda vale — é um horário ocupado na agenda dela —, então o rótulo
      // degrada em vez de a sincronia falhar.
      pacienteNome: consulta.patients?.nome_completo ?? 'Paciente',
      procedimentoNome: consulta.procedures?.nome ?? 'Consulta',
      inicio: new Date(consulta.inicio),
      fim: new Date(consulta.fim),
      observacoes: consulta.observacoes,
    })

    if (consulta.google_event_id) {
      await google.atualizarEvento(consulta.google_event_id, evento)
      return { ok: true, situacao: 'atualizado' }
    }

    const { eventId } = await google.criarEvento(evento)

    const { error: erroAoGravar } = await supabase
      .from('appointments')
      .update({ google_event_id: eventId })
      .eq('id', appointmentId)

    if (erroAoGravar) {
      // O evento existe lá, mas o vínculo não ficou registrado aqui. Não dá para
      // desfazer com segurança (apagar poderia remover um evento legítimo em
      // caso de corrida), então o caso é registrado para alguém olhar.
      return avisar('o evento foi criado mas o id não pôde ser gravado', erroAoGravar.message)
    }

    return { ok: true, situacao: 'criado' }
  } catch (causa) {
    return avisar('falha ao sincronizar com o Google Agenda', descrever(causa))
  }
}

/**
 * Registra e devolve a falha.
 *
 * `console.warn` e não `error`: nada aqui é urgente, e a mensagem já vem
 * sanitizada pelo adaptador — a chave privada nunca chega ao log.
 */
function avisar(contexto: string, detalhe?: string): { ok: false; erro: string } {
  const erro = detalhe ? `${contexto}: ${detalhe}` : contexto
  console.warn(`[google-agenda] ${erro}`)
  return { ok: false, erro }
}
