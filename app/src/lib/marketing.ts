/**
 * O lado do BANCO do cruzamento por `ad_id`.
 *
 * Mesma divisão de `lib/google-agenda.ts` e `lib/conversoes.ts`: o I/O mora
 * aqui, a regra fica em módulo puro (`app/(app)/marketing/cruzamento.ts`),
 * testável sem banco. Também pelo mesmo motivo prático — arquivo `'use server'`
 * só exporta função async, e nada disto é Server Action.
 *
 * ---------------------------------------------------------------------------
 * A CONSULTA: como o cruzamento por `ad_id` acontece
 * ---------------------------------------------------------------------------
 * Duas leituras, e não uma com aninhamento triplo. A primeira traz a atribuição
 * com o estágio da paciente; a segunda traz o preço de catálogo dos
 * atendimentos dela. Poderiam ser uma só
 * (`lead_attribution → patients → attendance_records → procedures`), mas o
 * aninhamento de três níveis do PostgREST multiplica linha por atendimento e
 * obrigaria a deduplicar a atribuição em memória — que é justamente o erro que
 * infla receita atribuída. Duas consultas rasas somam certo por construção.
 *
 *   1. `lead_attribution` com `ad_id` preenchido, embutindo `patients(stage)`.
 *      É esta linha que liga o anúncio ao desfecho: `ad_id` de um lado (gravado
 *      pelo n8n a partir de `externalAdReply.sourceId`), `patient_id` do outro.
 *      Usa o índice parcial `lead_attribution_anuncio_idx` da migration 0010.
 *
 *   2. `attendance_records` das pacientes encontradas, embutindo
 *      `procedures(preco_centavos)`. A receita atribuída é a soma do preço de
 *      CATÁLOGO do que foi realizado — não há tabela de pagamento neste sistema,
 *      e o preço do catálogo é a única fonte de valor que existe.
 *
 * ---------------------------------------------------------------------------
 * O que NÃO é lido, e é regra e não esquecimento
 * ---------------------------------------------------------------------------
 * Nome de paciente, telefone, nome de procedimento, observação clínica. A tela
 * de marketing é sobre ANÚNCIO, e agregado basta. Cruzar anúncio com nome de
 * paciente e procedimento numa mesma tabela produziria dado de saúde
 * identificável numa tela cujo propósito é outro — e `preco_centavos` sem o nome
 * do procedimento é só dinheiro.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  agruparDesfechos,
  type AtribuicaoDoBanco,
  type DesfechoDoAnuncio,
} from '@/app/(app)/marketing/cruzamento'
import { ehEstagio } from '@/app/(app)/crm/estagios'
import type { createServerClient } from '@/lib/supabase/server'

type Cliente = Awaited<ReturnType<typeof createServerClient>> | SupabaseClient

/**
 * Teto de linhas lidas, dos dois lados.
 *
 * Mesmo argumento de `TETO_DE_LINHAS` na fila de retornos: a clínica é de uma
 * profissional só, e o teto existe para que a consulta não cresça sem limite com
 * os anos, não porque se espera chegar perto dele.
 */
const TETO_DE_LINHAS = 5000

type LinhaDeAtribuicao = {
  ad_id: string | null
  ad_title: string | null
  source_app: string | null
  patient_id: string | null
  patients: { stage: string } | null
}

type LinhaDeAtendimento = {
  patient_id: string
  procedures: { preco_centavos: number } | null
}

export type ResultadoDoBanco = {
  desfechos: DesfechoDoAnuncio[]
  /**
   * Mensagem quando a leitura falhou. A página mostra um aviso e continua
   * desenhando o lado da Meta — meia tabela é melhor do que tela vermelha.
   */
  erro: string | null
}

/**
 * Lê o funil por anúncio.
 *
 * **Nunca lança.** Uma exceção aqui derrubaria a página inteira por causa de uma
 * coluna que a migration 0010 talvez ainda não tenha aplicado — e a regra do
 * projeto é que quem escreve o código não aplica migration. Sem a tabela, a
 * função devolve lista vazia e a mensagem, e a tela diz o que aconteceu.
 */
export async function carregarDesfechosPorAnuncio(supabase: Cliente): Promise<ResultadoDoBanco> {
  try {
    const atribuicoes = await supabase
      .from('lead_attribution')
      .select('ad_id, ad_title, source_app, patient_id, patients(stage)')
      .not('ad_id', 'is', null)
      .limit(TETO_DE_LINHAS)

    if (atribuicoes.error) {
      return { desfechos: [], erro: atribuicoes.error.message }
    }

    const linhas = ((atribuicoes.data ?? []) as unknown as LinhaDeAtribuicao[])
      .filter((linha): linha is LinhaDeAtribuicao & { ad_id: string } => Boolean(linha.ad_id))
      .map(
        (linha): AtribuicaoDoBanco => ({
          adId: linha.ad_id,
          adTitle: linha.ad_title,
          sourceApp: linha.source_app,
          patientId: linha.patient_id,
          // Estágio desconhecido (enum novo no banco, código antigo na tela)
          // conta como lead e não derruba a página — mesma degradação de
          // `agruparPorEstagio` no kanban.
          stage: ehEstagio(linha.patients?.stage) ? linha.patients.stage : null,
        }),
      )

    const receitaPorPaciente = await somarReceita(
      supabase,
      linhas.map((linha) => linha.patientId).filter((id): id is string => Boolean(id)),
    )

    return { desfechos: agruparDesfechos(linhas, receitaPorPaciente), erro: null }
  } catch (causa) {
    return { desfechos: [], erro: causa instanceof Error ? causa.message : String(causa) }
  }
}

/**
 * Receita por paciente, em centavos.
 *
 * Sem paciente vinculada não há consulta nenhuma: `in` com lista vazia devolveria
 * tudo em algumas versões do PostgREST e nada em outras — e nenhuma das duas é
 * uma resposta que valha uma ida ao banco. Com o banco vazio, que é o estado de
 * hoje, este caminho é o único que roda.
 */
async function somarReceita(
  supabase: Cliente,
  patientIds: readonly string[],
): Promise<Map<string, number>> {
  const receita = new Map<string, number>()
  const unicos = [...new Set(patientIds)]
  if (unicos.length === 0) return receita

  const atendimentos = await supabase
    .from('attendance_records')
    .select('patient_id, procedures(preco_centavos)')
    .in('patient_id', unicos)
    .limit(TETO_DE_LINHAS)

  // Falha aqui zera a receita mas preserva as contagens do funil — que é o dado
  // mais importante da tela. A alternativa, abortar tudo, trocaria uma coluna
  // vazia pela tabela inteira.
  if (atendimentos.error) return receita

  for (const linha of (atendimentos.data ?? []) as unknown as LinhaDeAtendimento[]) {
    const preco = linha.procedures?.preco_centavos
    if (typeof preco !== 'number' || !Number.isFinite(preco)) continue
    receita.set(linha.patient_id, (receita.get(linha.patient_id) ?? 0) + preco)
  }

  return receita
}
