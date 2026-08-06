import { requireSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import { TabelaDeProcedimentos, type Procedimento } from './tabela'

export const metadata = { title: 'Procedimentos' }

/**
 * Catálogo de procedimentos. A secretária enxerga a tabela (precisa da duração
 * e do preço para agendar), mas só a Dra. recebe os controles de edição — e a
 * autorização de verdade está na Server Action e na RLS, não nesta condição.
 */
export default async function PaginaDeProcedimentos() {
  const sessao = await requireSessao()
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('procedures')
    .select('id, nome, duracao_minutos, preco_centavos, default_return_interval_days')
    .eq('ativo', true)
    .order('nome')

  const procedimentos = (data ?? []) as Procedimento[]

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Procedimentos</h1>
        <p className="text-sm text-texto/60">
          Duração e preço padrão de cada procedimento, e em quantos dias ele gera um retorno.
          Procedimento sem retorno não entra na fila de retornos.
        </p>
      </header>

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
