import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina } from '@/components/ui'
import { createServerClient } from '@/lib/supabase/server'
import { EditorDeMensagens, type TemplateSalvo } from './editor'

export const metadata = { title: 'Mensagens' }

/**
 * Os textos que a clínica manda para as pacientes.
 *
 * Exclusiva da Dra., e por um motivo que não é de privacidade: o que se escreve
 * aqui sai assinado por ela, fala de cuidado pós-procedimento e chega a todas as
 * pacientes de uma vez. Orientação de cuidado é ato clínico mesmo escrita fora
 * do prontuário — a mesma razão que faz as policies de escrita da migration 0007
 * exigirem `is_dra()`.
 *
 * `notFound()` em vez de "acesso negado", como em `/configuracoes/google`: não há
 * por que confirmar à secretária que a tela existe. E ele não é a autorização —
 * é cortesia de navegação. Quem barra a escrita é o `exigirDra` das Server
 * Actions e a RLS atrás dele.
 */
export default async function PaginaDeMensagens() {
  const sessao = await requireSessao()
  if (sessao.role !== 'dra') notFound()

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('message_templates')
    .select('kind, channel, assunto, corpo, ativo')

  return (
    <section className="space-y-6">
      <CabecalhoDePagina
        secao="Automação"
        titulo="Mensagens"
        descricao={
          <>
            O texto de cada lembrete automático. Escreva{' '}
            <code className="text-acento">{'{{nome}}'}</code> onde o nome da paciente
            deve entrar — a prévia mostra como a mensagem chega. Para parar um
            envio, use Desligar: o texto fica guardado.
          </>
        }
      />

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar os textos. Recarregue a página.
        </p>
      ) : (
        <EditorDeMensagens templates={(data ?? []) as TemplateSalvo[]} />
      )}
    </section>
  )
}
