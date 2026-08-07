/**
 * A fila de conversões vista pelo Postgres.
 *
 * Implementação de `DepsDeConversoes` do despacho: tudo que toca banco mora
 * aqui, e `worker/despacho-conversoes.ts` fica sem saber que Supabase existe.
 * Mesma divisão de `worker/fila.ts`, e pelo mesmo motivo — a política de
 * retentativa e a janela de sete dias da Meta são testáveis sem subir um banco.
 *
 * Roda com o client `service_role`, que ignora RLS: o worker não tem sessão de
 * usuário e é o único que grava `enviado`.
 *
 * ---------------------------------------------------------------------------
 * A reserva
 * ---------------------------------------------------------------------------
 * Idêntica à de `reminder_jobs` (migration 0008), porque `meta_conversion_jobs`
 * foi desenhada como gêmea dela: o `select` só escolhe candidatos, e a posse vem
 * do `update ... where status = 'pendente' returning id`. Sob READ COMMITTED o
 * segundo worker reavalia o filtro contra a linha já atualizada e leva zero
 * linhas.
 *
 * O que muda é o dano de errar. Na fila de lembretes, envio duplicado é a
 * paciente recebendo a mesma mensagem duas vezes. Aqui é o Gerenciador de
 * Eventos contando dois `Schedule` para o mesmo agendamento — o anúncio parece
 * melhor do que é, e a Meta passa a otimizar por um sinal inflado.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { lerConversaoCongelada } from '@/integrations/meta/payload'
import type { ConversaoPendente, DepsDeConversoes, DesfechoDaConversao } from './despacho-conversoes'

/**
 * Quantos jobs um ciclo pega por vez.
 *
 * Cinquenta, igual à fila de lembretes. Aqui o pico realista é ainda menor — um
 * arrasto de cartão gera de um a cinco eventos —, e o teto existe pelo mesmo
 * caso patológico: worker parado por horas e fila acumulada. Com teto, ela drena
 * em lotes e cada ciclo termina.
 */
export const TAMANHO_DO_LOTE = 50

export type LinhaDaFilaDeConversoes = {
  id: string
  tentativas: number
  payload: unknown
}

/**
 * Linha do banco → job pronto para despachar.
 *
 * Puro e exportado por causa do que ele decide: o `payload` é `jsonb`, o banco
 * aceita qualquer objeto ali, e é `lerConversaoCongelada` que o filtra contra um
 * schema fechado — estripando qualquer campo que alguém tenha gravado a mais.
 * `evento: null` sai daqui quando o payload não passa, e o despacho o trata como
 * falha permanente com mensagem própria, em vez de este arquivo lançar e derrubar
 * o lote inteiro por causa de uma linha.
 *
 * O `payload` é a autoridade sobre o QUE enviar; as colunas `evento`, `event_id`
 * e `ocorrido_em` existem para o índice da fila, para os `check` do banco e para
 * a tela — não são relidas aqui, e as duas fontes não divergem porque quem grava
 * as duas é a mesma `ConversaoPlanejada`.
 */
export function montarConversao(linha: LinhaDaFilaDeConversoes): ConversaoPendente {
  return {
    id: linha.id,
    tentativas: linha.tentativas,
    evento: lerConversaoCongelada(linha.payload),
  }
}

function falhar(contexto: string, erro: unknown): never {
  const detalhe = (erro as { message?: string } | null)?.message ?? String(erro)
  throw new Error(`${contexto}: ${detalhe}`)
}

/** A metade de `DepsDeConversoes` que fala com o banco. O adaptador da Meta é
 * ligado por `worker/index.ts`, que é quem une as duas metades. */
export type FilaDeConversoesSupabase = Omit<DepsDeConversoes, 'meta'> & {
  /** Quantos jobs ficaram presos em `enviando`. Ver `contarReservasPresas` em `fila.ts`. */
  contarReservasPresas(): Promise<number | null>
}

export function criarFilaDeConversoes(supabase: SupabaseClient): FilaDeConversoesSupabase {
  return {
    async reservarPendentes() {
      // Passo 1 — candidatos. Usa `meta_conversion_jobs_fila_idx`, o índice
      // parcial em `status = 'pendente'` da migration 0010. Ordena por
      // `ocorrido_em`: numa fila represada, o evento mais antigo é o que mais
      // corre risco de estourar a janela de atribuição da Meta.
      const { data: candidatos, error: erroDaLeitura } = await supabase
        .from('meta_conversion_jobs')
        .select('id, tentativas, payload')
        .eq('status', 'pendente')
        .order('ocorrido_em')
        .limit(TAMANHO_DO_LOTE)

      if (erroDaLeitura) falhar('Falha ao ler a fila de conversões', erroDaLeitura)

      const linhas = (candidatos ?? []) as unknown as LinhaDaFilaDeConversoes[]
      if (linhas.length === 0) return []

      // Passo 2 — a posse.
      const { data: reservados, error: erroDaReserva } = await supabase
        .from('meta_conversion_jobs')
        .update({ status: 'enviando' })
        .in(
          'id',
          linhas.map((l) => l.id),
        )
        .eq('status', 'pendente')
        .select('id')

      if (erroDaReserva) falhar('Falha ao reservar conversões', erroDaReserva)

      const meus = new Set(((reservados ?? []) as { id: string }[]).map((r) => r.id))
      return linhas.filter((l) => meus.has(l.id)).map(montarConversao)
    },

    async marcarEnviado(id) {
      const { error } = await supabase
        .from('meta_conversion_jobs')
        .update({
          status: 'enviado',
          // `meta_conversion_jobs_enviado_tem_carimbo` recusa `enviado` sem esta
          // data, e é ela que responde "quando este evento chegou lá?" quando
          // alguém comparar com o Teste de Eventos do Gerenciador.
          enviado_em: new Date().toISOString(),
          // Limpa o erro da tentativa anterior: a linha agora conta uma história
          // que terminou bem.
          erro: null,
        })
        .eq('id', id)
        // Trava final: a linha é nossa desde a reserva, e este filtro impede
        // sobrescrever um estado mudado por outra instância — ou pela equipe
        // cancelando o envio na tela de configuração no meio do ciclo.
        .eq('status', 'enviando')

      if (error) falhar(`Falha ao marcar a conversão ${id} como enviada`, error)
    },

    async marcarFalha(id, desfecho: DesfechoDaConversao) {
      const { error } = await supabase
        .from('meta_conversion_jobs')
        .update({
          // `pendente` devolve à fila — e o próximo ciclo, cinco minutos depois,
          // é o recuo. `falhou` encerra.
          status: desfecho.definitiva ? 'falhou' : 'pendente',
          // A mensagem já vem sanitizada do adaptador. Esta coluna aparece na
          // tela da equipe, e o token de CAPI não pode chegar nela.
          erro: desfecho.erro,
          tentativas: desfecho.tentativas,
        })
        .eq('id', id)
        .eq('status', 'enviando')

      if (error) falhar(`Falha ao registrar o erro da conversão ${id}`, error)
    },

    async contarReservasPresas() {
      const { count, error } = await supabase
        .from('meta_conversion_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'enviando')

      return error ? null : (count ?? 0)
    },
  }
}
