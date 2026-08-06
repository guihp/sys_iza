import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
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

  if (error) {
    return (
      <section className="space-y-6">
        <h1 className="font-serif text-2xl">Mensagens</h1>
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar os textos. Recarregue a página.
        </p>
      </section>
    )
  }

  return (
    <section className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Mensagens</h1>
        <p className="text-sm text-texto/60">
          O texto de cada lembrete automático. Escreva{' '}
          <code className="rounded bg-superficie px-1">{'{{nome}}'}</code> onde o nome da paciente
          deve entrar — a prévia abaixo de cada campo mostra como a mensagem chega. Para parar de
          enviar um lembrete, use Desligar: o texto fica guardado.
        </p>
      </header>

      <EditorDeMensagens templates={(data ?? []) as TemplateSalvo[]} />
    </section>
  )
}
