import { requireSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import { Kanban, type PacienteDoFunil } from './kanban'

export const metadata = { title: 'Funil' }

/**
 * Funil de pacientes em kanban. Server Component: a consulta roda no servidor,
 * com o client autenticado por cookie, então a RLS de `patients` é quem decide
 * o que volta. Nenhuma chave chega ao browser.
 *
 * Sem filtro de estágio na query: são sete colunas na mesma tela, e uma leitura
 * só é mais barata que sete. O agrupamento acontece no kanban, por função pura.
 */
export default async function PaginaDoFunil() {
  await requireSessao()
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('patients')
    .select('id, nome_completo, telefone, lead_source, stage')
    .order('criado_em', { ascending: false })

  const pacientes = (data ?? []) as PacienteDoFunil[]

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Funil</h1>
        <p className="text-sm text-texto/60">
          Arraste o cartão para mudar o estágio, ou use o seletor dentro dele. Lead que não seguiu
          adiante vai para Descartado — paciente não se apaga.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar o funil. Recarregue a página.
        </p>
      ) : (
        <Kanban pacientes={pacientes} />
      )}
    </section>
  )
}
