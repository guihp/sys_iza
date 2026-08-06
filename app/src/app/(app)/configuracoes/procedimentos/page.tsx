import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina, Kpi } from '@/components/ui'
import { createServerClient } from '@/lib/supabase/server'
import { formatarTicketMedio, kpisDoCatalogo } from './kpis-do-catalogo'
import { TabelaDeProcedimentos, type Procedimento } from './tabela'

export const metadata = { title: 'Procedimentos' }

const COLUNAS_BASE =
  'id, nome, duracao_minutos, preco_centavos, default_return_interval_days' as const

/**
 * Lê o catálogo ativo.
 *
 * Tenta `categoria` (migration `0009_procedures_categoria.sql`). Se a coluna
 * ainda não existir no banco, o PostgREST recusa o select — aí a leitura cai
 * de volta às colunas base e a tela segue sem subtítulo de categoria. Não
 * aplicar a migration aqui: regra do projeto.
 */
async function carregarProcedimentosAtivos() {
  const supabase = await createServerClient()

  const comCategoria = await supabase
    .from('procedures')
    .select(`${COLUNAS_BASE}, categoria`)
    .eq('ativo', true)
    .order('nome')

  if (!comCategoria.error) {
    return { data: (comCategoria.data ?? []) as Procedimento[], error: null }
  }

  const semCategoria = await supabase
    .from('procedures')
    .select(COLUNAS_BASE)
    .eq('ativo', true)
    .order('nome')

  return {
    data: (semCategoria.data ?? []) as Procedimento[],
    error: semCategoria.error,
  }
}

/**
 * Catálogo de procedimentos. A secretária enxerga a tabela (precisa da duração
 * e do preço para agendar), mas só a Dra. recebe os controles de edição — e a
 * autorização de verdade está na Server Action e na RLS, não nesta condição.
 */
export default async function PaginaDeProcedimentos() {
  const sessao = await requireSessao()
  const { data, error } = await carregarProcedimentosAtivos()
  const procedimentos = data
  const kpis = kpisDoCatalogo(procedimentos)

  return (
    <section className="space-y-6">
      <CabecalhoDePagina
        secao="Catálogo clínico"
        titulo="Procedimentos"
        descricao="Duração e preço padrão de cada procedimento, e em quantos dias ele gera um retorno. Procedimento sem retorno não entra na fila de reativação."
        kpis={
          <>
            <Kpi rotulo="Ativos" valor={kpis.ativos} sublegenda="no catálogo" />
            <Kpi
              rotulo="Ticket médio"
              valor={formatarTicketMedio(kpis.ticketMedioCentavos)}
              sublegenda="preço padrão"
            />
            <Kpi
              rotulo="Geram retorno"
              valor={kpis.geramRetorno}
              sublegenda="alimentam reativação"
            />
          </>
        }
      />

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar o catálogo. Recarregue a página.
        </p>
      ) : (
        <TabelaDeProcedimentos
          procedimentos={procedimentos}
          podeEditar={sessao.role === 'dra'}
        />
      )}
    </section>
  )
}
