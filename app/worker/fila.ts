/**
 * A fila de lembretes vista pelo Postgres.
 *
 * É a implementação de `Deps` do despacho: tudo que toca banco mora aqui, e
 * `worker/dispatch.ts` fica sem saber que Supabase existe. A separação não é
 * estética — é o que permite testar a política de retentativa e a janela de
 * silêncio sem subir um banco.
 *
 * Roda com o client `service_role` (`src/lib/supabase/admin.ts`), que ignora
 * RLS. O worker não tem sessão de usuário: ele age em nome do sistema, precisa
 * enxergar a fila inteira e é o único que grava `enviado`.
 *
 * ---------------------------------------------------------------------------
 * A reserva
 * ---------------------------------------------------------------------------
 * O ponto crítico do arquivo é `reservarPendentes`. Ler a fila com um `select`
 * e sair despachando funciona com um worker no ar — e o Coolify sobe o container
 * novo antes de derrubar o velho, então em todo deploy há alguns segundos com
 * dois. Os dois leriam as mesmas linhas e a paciente receberia tudo em dobro.
 *
 * A saída é não confiar no `select`. Ele só escolhe candidatos; a posse vem de
 * um `update` condicional que tira a linha de `pendente` e devolve o que
 * conseguiu pegar. Sob READ COMMITTED, dois `update` sobre a mesma linha
 * serializam: o segundo espera, reavalia o `where` contra a versão já
 * atualizada, não casa, e recebe zero linhas. Só se despacha o que voltou do
 * `returning` — ver `supabase/migrations/0008_reserva_de_lembretes.sql`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Canal, ReminderKind } from '@/domain/reminders/plan-reminders'
import { renderizarTemplate } from '@/domain/reminders/template'
import {
  dataDaClinica,
  formatarDataExtensa,
  formatarDataExtensaComAno,
  horaDaClinica,
} from '@/lib/datetime'
import type { Deps, JobPendente, ResultadoDaFalha } from './dispatch'

/**
 * Quantos jobs um ciclo pega por vez.
 *
 * Cinquenta é folgado para esta clínica — o pico real é a rajada das 09:00, com
 * as confirmações da véspera. O limite existe para o caso patológico: worker
 * parado por horas, fila acumulada, e um lote sem teto que levaria mais de cinco
 * minutos para escoar e ainda seguraria as linhas reservadas o tempo todo. Com
 * teto, a fila drena em lotes e cada ciclo termina.
 */
export const TAMANHO_DO_LOTE = 50

/**
 * O `select` da fila, com os vínculos de que a mensagem precisa.
 *
 * Um job vem de uma consulta OU de um atendimento (constraint
 * `reminder_jobs_uma_origem`), então os dois vínculos são pedidos e um deles vem
 * nulo. Pedir os dois numa consulta só evita um segundo round-trip por job.
 */
const COLUNAS_DA_FILA = `
  id, kind, channel, tentativas,
  patients ( nome_completo, como_prefere_ser_chamado, telefone, email ),
  appointments ( inicio, procedures ( nome ) ),
  attendance_records ( retorno_vencimento, procedures ( nome ) )
`

/** Relação embutida do PostgREST: objeto, lista ou nada. Ver `primeiro()`. */
type Embutido<T> = T | T[] | null | undefined

export type PacienteDaFila = {
  nome_completo: string
  como_prefere_ser_chamado: string | null
  telefone: string | null
  email: string | null
}

export type LinhaDaFila = {
  id: string
  kind: ReminderKind
  channel: Canal
  tentativas: number
  patients: Embutido<PacienteDaFila>
  appointments: Embutido<{ inicio: string; procedures: Embutido<{ nome: string }> }>
  attendance_records: Embutido<{
    retorno_vencimento: string | null
    procedures: Embutido<{ nome: string }>
  }>
}

export type TemplateDeMensagem = {
  kind: ReminderKind
  channel: Canal
  assunto: string | null
  corpo: string
}

/**
 * Normaliza a relação embutida.
 *
 * O PostgREST devolve objeto para relação muitos-para-um e lista para
 * um-para-muitos, e a classificação já mudou entre versões do Supabase. Aceitar
 * as duas formas custa três linhas e evita o worker parar de achar o telefone da
 * paciente depois de um upgrade da plataforma — falha que só apareceria em
 * produção, como um lote inteiro de lembretes marcado "sem telefone cadastrado".
 */
function primeiro<T>(valor: Embutido<T>): T | null {
  if (!valor) return null
  return Array.isArray(valor) ? (valor[0] ?? null) : valor
}

/**
 * Como o paciente é chamado na mensagem.
 *
 * O apelido do cadastro vem primeiro porque é o que a paciente respondeu quando
 * perguntaram como prefere ser chamada. Sem ele, o primeiro nome — e não o nome
 * completo, que numa mensagem de WhatsApp soa a cobrança de banco.
 */
function tratamento(paciente: PacienteDaFila | null): string {
  if (!paciente) return ''
  const apelido = paciente.como_prefere_ser_chamado?.trim()
  return apelido || paciente.nome_completo.trim().split(/\s+/)[0] || ''
}

/**
 * As variáveis que os textos de `message_templates` podem citar.
 *
 * Toda formatação de data passa por `src/lib/datetime.ts`, que resolve
 * America/Sao_Paulo pela tzdata. É o mesmo motivo de sempre: o container roda em
 * UTC, e uma consulta às 22:00 de Brasília formatada pelo relógio do servidor
 * anunciaria o dia seguinte para a paciente.
 */
function variaveisDoLembrete(linha: LinhaDaFila): Record<string, string> {
  const consulta = primeiro(linha.appointments)
  const atendimento = primeiro(linha.attendance_records)

  const inicio = consulta ? new Date(consulta.inicio) : null
  const procedimento =
    primeiro(consulta?.procedures)?.nome ?? primeiro(atendimento?.procedures)?.nome ?? 'procedimento'

  return {
    nome: tratamento(primeiro(linha.patients)),
    // Sem o ano: estas mensagens falam de hoje ou de amanhã.
    data: inicio ? formatarDataExtensa(dataDaClinica(inicio)) : '',
    hora: inicio ? horaDaClinica(inicio) : '',
    procedimento,
    // Com o ano: retorno cai meses à frente e às vezes no ano seguinte.
    data_retorno: atendimento?.retorno_vencimento
      ? formatarDataExtensaComAno(atendimento.retorno_vencimento)
      : '',
  }
}

/**
 * Linha da fila + textos → job pronto para despachar.
 *
 * Puro, e é aqui que a mensagem que a paciente lê toma forma — daí o teste
 * unitário. Template ausente ou desligado produz corpo vazio de propósito: o
 * despacho reconhece isso e falha o job com uma mensagem que nomeia a causa, em
 * vez de este arquivo lançar e derrubar o lote inteiro por causa de uma linha.
 */
export function montarJob(linha: LinhaDaFila, templates: TemplateDeMensagem[]): JobPendente {
  const template = templates.find((t) => t.kind === linha.kind && t.channel === linha.channel)
  const variaveis = variaveisDoLembrete(linha)
  const paciente = primeiro(linha.patients)

  return {
    id: linha.id,
    kind: linha.kind,
    channel: linha.channel,
    telefone: paciente?.telefone ?? null,
    email: paciente?.email ?? null,
    assunto: template?.assunto ? renderizarTemplate(template.assunto, variaveis) : null,
    corpo: template ? renderizarTemplate(template.corpo, variaveis) : '',
    tentativas: linha.tentativas,
  }
}

function falhar(contexto: string, erro: unknown): never {
  const detalhe = (erro as { message?: string } | null)?.message ?? String(erro)
  throw new Error(`${contexto}: ${detalhe}`)
}

/**
 * A metade de `Deps` que fala com o banco. Os dois provedores de envio ficam de
 * fora de propósito: eles não têm nada a ver com a fila, e juntá-los aqui faria
 * este arquivo depender da Evolution e do Resend só para satisfazer um tipo.
 * Quem une as duas metades é `worker/index.ts`.
 */
export type FilaSupabase = Omit<Deps, 'whatsapp' | 'email'> & {
  /**
   * Quantos jobs ficaram presos em `enviando`.
   *
   * Só acontece quando o processo morre sem chance de encerrar — `SIGKILL`,
   * queda de energia. O encerramento limpo espera o ciclo terminar, então deploy
   * normal não deixa nada aqui. Devolve `null` se a contagem falhar: é
   * observabilidade, e não pode impedir o worker de subir.
   */
  contarReservasPresas(): Promise<number | null>
}

export function criarFilaSupabase(supabase: SupabaseClient): FilaSupabase {
  return {
    async reservarPendentes(agora) {
      // Passo 1 — candidatos. Usa `reminder_jobs_fila_idx`, o índice parcial em
      // `status = 'pendente'` da migration 0007.
      const { data: candidatos, error: erroDaLeitura } = await supabase
        .from('reminder_jobs')
        .select(COLUNAS_DA_FILA)
        .eq('status', 'pendente')
        .lte('agendado_para', agora.toISOString())
        .order('agendado_para')
        .limit(TAMANHO_DO_LOTE)

      if (erroDaLeitura) falhar('Falha ao ler a fila de lembretes', erroDaLeitura)

      const linhas = (candidatos ?? []) as unknown as LinhaDaFila[]
      if (linhas.length === 0) return []

      // Passo 2 — a posse. O `eq('status', 'pendente')` é o que impede duas
      // instâncias de despacharem a mesma linha: quem chegar depois reavalia o
      // filtro contra a linha já atualizada e leva zero.
      const { data: reservados, error: erroDaReserva } = await supabase
        .from('reminder_jobs')
        .update({ status: 'enviando' })
        .in(
          'id',
          linhas.map((l) => l.id),
        )
        .eq('status', 'pendente')
        .select('id')

      if (erroDaReserva) falhar('Falha ao reservar lembretes', erroDaReserva)

      const meus = new Set(((reservados ?? []) as { id: string }[]).map((r) => r.id))
      const ganhos = linhas.filter((l) => meus.has(l.id))
      if (ganhos.length === 0) return []

      // Passo 3 — os textos. Uma leitura por ciclo, não por job: são sete linhas
      // que mudam quando a Dra. edita a tela de mensagens, e lê-las dentro do
      // laço multiplicaria round-trips por nada. Ficam fora da reserva de
      // propósito — se esta leitura falhar, as linhas já reservadas voltam pelo
      // caminho normal de erro, sem ninguém ter recebido mensagem.
      const { data: textos, error: erroDosTemplates } = await supabase
        .from('message_templates')
        .select('kind, channel, assunto, corpo')
        .eq('ativo', true)

      if (erroDosTemplates) falhar('Falha ao ler os textos das mensagens', erroDosTemplates)

      const templates = (textos ?? []) as TemplateDeMensagem[]
      return ganhos.map((linha) => montarJob(linha, templates))
    },

    async marcarEnviado(id, providerMessageId) {
      const { error } = await supabase
        .from('reminder_jobs')
        .update({
          status: 'enviado',
          enviado_em: new Date().toISOString(),
          provider_message_id: providerMessageId,
          // Limpa o erro da tentativa anterior: a linha agora conta uma história
          // que terminou bem, e um erro antigo pendurado faria a equipe procurar
          // problema onde não há.
          erro: null,
        })
        .eq('id', id)
        // Trava final. A linha é nossa desde a reserva, e este filtro garante que
        // um estado alterado por outra instância — ou por uma secretária que
        // cancelou o lembrete no meio do envio — não seja sobrescrito.
        .eq('status', 'enviando')

      if (error) falhar(`Falha ao marcar o lembrete ${id} como enviado`, error)
    },

    async marcarFalha(id, desfecho: ResultadoDaFalha) {
      const { error } = await supabase
        .from('reminder_jobs')
        .update({
          // `pendente` devolve à fila; `falhou` encerra. Quem decidiu foi o
          // despacho, com base em `ErroDeEnvio.permanente` e no teto de
          // tentativas.
          status: desfecho.definitiva ? 'falhou' : 'pendente',
          erro: desfecho.erro,
          tentativas: desfecho.tentativas,
          ...(desfecho.proximaTentativa
            ? { agendado_para: desfecho.proximaTentativa.toISOString() }
            : {}),
        })
        .eq('id', id)
        .eq('status', 'enviando')

      if (error) falhar(`Falha ao registrar o erro do lembrete ${id}`, error)
    },

    async reagendar(id, novoMomento) {
      const { error } = await supabase
        .from('reminder_jobs')
        // Sem tocar em `tentativas`: adiar por causa da janela de silêncio não é
        // tentativa gasta. Contar aqui faria um lembrete planejado para as 22:00
        // chegar às 09:00 com um terço do orçamento de retentativa já queimado.
        .update({ status: 'pendente', agendado_para: novoMomento.toISOString() })
        .eq('id', id)
        .eq('status', 'enviando')

      if (error) falhar(`Falha ao reagendar o lembrete ${id}`, error)
    },

    async contarReservasPresas() {
      const { count, error } = await supabase
        .from('reminder_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'enviando')

      return error ? null : (count ?? 0)
    },
  }
}
