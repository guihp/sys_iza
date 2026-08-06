import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
import { serverEnv } from '@/lib/env'
import { estadoDoGoogle } from './estado'

export const metadata = { title: 'Google Agenda' }

const PASSOS: { titulo: string; detalhe: string }[] = [
  {
    titulo: 'Criar um projeto no Google Cloud e habilitar a Google Calendar API',
    detalhe: 'console.cloud.google.com → APIs e serviços → Ativar API → Google Calendar API.',
  },
  {
    titulo: 'Criar uma conta de serviço e gerar uma chave JSON',
    detalhe:
      'IAM e administrador → Contas de serviço → Criar → Chaves → Adicionar chave → JSON. ' +
      'O arquivo baixado traz client_email e private_key.',
  },
  {
    titulo: 'Compartilhar a agenda com o e-mail da conta de serviço',
    detalhe:
      'No Google Agenda, na agenda que vai receber as consultas: Configurações → ' +
      'Compartilhar com pessoas específicas → adicionar o client_email com a permissão ' +
      '"Fazer alterações em eventos". Sem este passo o Google recusa a escrita.',
  },
  {
    titulo: 'Preencher as três variáveis de ambiente e reiniciar o container',
    detalhe:
      'GOOGLE_SERVICE_ACCOUNT_EMAIL (o client_email), GOOGLE_PRIVATE_KEY (a private_key ' +
      'inteira, incluindo as linhas BEGIN e END) e GOOGLE_CALENDAR_ID (o e-mail da agenda).',
  },
]

/**
 * Estado da sincronia com o Google Agenda.
 *
 * Tela de leitura, sem botão: não há nada para clicar porque não há OAuth. A
 * credencial é uma conta de serviço, configurada por variável de ambiente —
 * decisão explicada em `@/integrations/google/calendar`. O que a tela faz é
 * responder às duas perguntas que a Dra. tem: "está ligado?" e "o que falta?".
 *
 * Exclusiva dela. A secretária não tem por que saber com qual conta de serviço
 * a clínica fala com o Google, e `notFound()` — em vez de "acesso negado" —
 * evita confirmar que a tela existe.
 */
export default async function PaginaDoGoogle() {
  const sessao = await requireSessao()
  if (sessao.role !== 'dra') notFound()

  const estado = estadoDoGoogle(serverEnv())

  return (
    <section className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Google Agenda</h1>
        <p className="text-sm text-texto/60">
          Espelha as consultas marcadas no seu Google Agenda, para você ver os horários no
          celular. É opcional: a agenda do sistema funciona igual com a sincronia desligada, e
          nenhuma consulta deixa de ser marcada se o Google falhar.
        </p>
      </header>

      {estado.ligada ? (
        <div className="space-y-3 rounded-xl border border-emerald-600/40 bg-emerald-500/10 p-4">
          <p className="text-sm font-medium">Sincronia ligada</p>
          <dl className="space-y-1 text-sm text-texto/70">
            <div className="flex gap-2">
              <dt className="text-texto/50">Agenda de destino:</dt>
              <dd>{estado.calendarId}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-texto/50">Conta de serviço:</dt>
              <dd className="break-all">{estado.contaDeServico}</dd>
            </div>
          </dl>
          <p className="text-sm text-texto/60">
            Se os eventos não aparecerem, confira se a agenda acima está compartilhada com a
            conta de serviço com a permissão &quot;Fazer alterações em eventos&quot;.
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-linha bg-superficie p-4">
          <p className="text-sm font-medium">Sincronia desligada</p>
          <p className="text-sm text-texto/60">
            Nenhuma credencial do Google está configurada. As consultas continuam sendo marcadas
            normalmente — elas só não aparecem no seu Google Agenda.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-serif text-lg">
          {estado.ligada ? 'Como isto foi configurado' : 'Como ligar'}
        </h2>
        <ol className="space-y-3">
          {PASSOS.map((passo, indice) => (
            <li key={passo.titulo} className="flex gap-3 text-sm">
              <span className="shrink-0 text-texto/40">{indice + 1}.</span>
              <span>
                <span className="block">{passo.titulo}</span>
                <span className="block text-texto/55">{passo.detalhe}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-texto/55">
          A chave privada dá acesso de escrita à agenda para sempre: ela vive só nas variáveis do
          servidor, nunca aparece nesta tela e nunca vai para o navegador.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-linha p-4">
        <h2 className="font-serif text-lg">O que a sincronia faz</h2>
        <ul className="space-y-1 text-sm text-texto/65">
          <li>
            Consulta marcada vira um evento com o nome da paciente e o procedimento. Nada de
            prontuário sai do sistema.
          </li>
          <li>Consulta remarcada muda o horário do mesmo evento, sem criar um segundo.</li>
          <li>Consulta cancelada apaga o evento da sua agenda.</li>
          <li>
            Se o Google estiver fora do ar, a consulta é marcada mesmo assim e fica sem evento —
            o sistema não tenta de novo sozinho.
          </li>
        </ul>
      </div>
    </section>
  )
}
