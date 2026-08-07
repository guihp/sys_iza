/**
 * O carregamento da página de marketing: os dois lados, num estado só.
 *
 * Existe separado da `page.tsx` pelo mesmo motivo de `configuracoes/google/
 * estado.ts`: a decisão "a página está ligada? o que ela mostra?" é testável
 * sem renderizar nada, e é onde moram os caminhos de degradação — que são a
 * parte que mais importa aqui, já que a credencial não existe.
 *
 * ---------------------------------------------------------------------------
 * Três desfechos, e nenhum deles é uma tela quebrada
 * ---------------------------------------------------------------------------
 *   1. **desligada** — sem `META_ADS_TOKEN`. A rota existe, explica o que falta
 *      e como obter, e não chama a Meta. É o estado de hoje e vai continuar
 *      sendo até o dono gerar o token no Business. Mesmo desenho do Google
 *      Agenda;
 *   2. **ligada, mas a Meta falhou** — token expirado, limite de requisições,
 *      rede. A tabela aparece com o lado do BANCO preenchido e um aviso discreto
 *      no lugar do gasto. Metade da informação é melhor do que uma tela de erro:
 *      quantas pacientes aquele anúncio trouxe é dado nosso e continua válido;
 *   3. **ligada e ok** — a tabela inteira.
 *
 * O bloco de saúde do dataset é acessório em qualquer um dos três: ele só
 * aparece quando a Meta devolve, e some calado quando não.
 */

import {
  cruzar,
  totalizar,
  type LinhaDeMarketing,
  type TotaisDeMarketing,
} from './cruzamento'
import {
  criarMarketingApiClient,
  type EstadoDoDataset,
  type MarketingApiClient,
  type Periodo,
} from '@/integrations/meta/marketing-api'
import { serverEnv } from '@/lib/env'
import { carregarDesfechosPorAnuncio } from '@/lib/marketing'
import type { createServerClient } from '@/lib/supabase/server'

type Cliente = Awaited<ReturnType<typeof createServerClient>>

export type EstadoDaPagina =
  | { ligada: false }
  | {
      ligada: true
      periodo: Periodo
      linhas: LinhaDeMarketing[]
      totais: TotaisDeMarketing
      dataset: EstadoDoDataset | null
      /** Mensagem já sanitizada da Meta. `null` quando a leitura foi bem. */
      avisoDaApi: string | null
      /** Mensagem do Supabase. `null` quando a leitura foi bem. */
      avisoDoBanco: string | null
    }

export type OpcoesDeCarregamento = {
  supabase: Cliente
  periodo: Periodo
  /**
   * Adaptador pronto. **Omitir lê o ambiente**, que é o caminho de produção;
   * `null` força o estado "desligada", usado no teste.
   */
  cliente?: MarketingApiClient | null
  /**
   * `META_DATASET_ID`. Omitir lê o ambiente. Vazio ou nulo apenas suprime o
   * bloco de saúde do dataset — ele não é condição para a página existir, e é
   * por isso que a página de marketing acende com o token de anúncios sozinho,
   * mesmo sem dataset nenhum criado.
   */
  datasetId?: string | null
}

export async function carregarMarketing(opcoes: OpcoesDeCarregamento): Promise<EstadoDaPagina> {
  const { supabase, periodo } = opcoes

  const cliente = opcoes.cliente === undefined ? criarMarketingApiClient() : opcoes.cliente
  if (!cliente) return { ligada: false }

  const datasetId =
    opcoes.datasetId === undefined ? (serverEnv().META_DATASET_ID ?? null) : opcoes.datasetId

  // Em paralelo porque são fontes independentes: o banco não espera a Meta, e a
  // saúde do dataset não espera os insights. Cada promessa tem `catch` PRÓPRIO,
  // antes do `Promise.all` — sem isso a rejeição de uma cancelaria o resultado
  // das outras, que é exatamente o desfecho 2: a Meta falha e o lado do banco
  // precisa chegar inteiro à tela mesmo assim.
  const [insights, banco, dataset] = await Promise.all([
    cliente
      .insightsPorAnuncio(periodo)
      .then((linhas) => ({ linhas, erro: null as string | null }))
      .catch((causa: unknown) => ({
        linhas: [],
        // A mensagem do adaptador já vem sanitizada — o token nunca está nela.
        erro: causa instanceof Error ? causa.message : String(causa),
      })),
    carregarDesfechosPorAnuncio(supabase),
    // `estadoDoDataset` não lança por contrato; o catch é cinto e suspensório.
    datasetId ? cliente.estadoDoDataset(datasetId).catch(() => null) : Promise.resolve(null),
  ])

  const linhas = cruzar(insights.linhas, banco.desfechos)

  return {
    ligada: true,
    periodo,
    linhas,
    totais: totalizar(linhas),
    dataset,
    avisoDaApi: insights.erro,
    avisoDoBanco: banco.erro,
  }
}
