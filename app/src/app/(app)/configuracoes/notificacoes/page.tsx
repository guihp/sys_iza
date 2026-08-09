import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina } from '@/components/ui'
import { ToggleNotificacoesPush } from './formulario'

export const metadata = { title: 'Notificações' }

/**
 * Preferência de push de novo agendamento — dra e secretaria.
 *
 * Cada device precisa ligar o toggle (subscription local). iOS só com PWA
 * instalado; o texto abaixo é honesto sobre o limite.
 */
export default async function PaginaDeNotificacoes() {
  await requireSessao()

  return (
    <section className="max-w-2xl space-y-8">
      <CabecalhoDePagina
        secao="Configurações"
        titulo="Notificações"
        descricao="Avisar neste aparelho quando alguém marcar uma consulta. Só a equipe recebe — pacientes continuam no WhatsApp/e-mail de lembrete."
      />

      <div className="space-y-4 rounded-xl border border-linha bg-superficie p-4">
        <h2 className="font-serif text-lg">Novo agendamento</h2>
        <p className="text-sm text-texto-suave">
          Quando a agenda gravar uma consulta, este dispositivo pode receber uma
          notificação com paciente, horário e procedimento.
        </p>
        <ToggleNotificacoesPush />
      </div>

      <div className="space-y-2 rounded-xl border border-linha p-4">
        <h2 className="font-serif text-lg">Limites (vale ler)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-texto-suave">
          <li>
            <strong className="font-medium text-texto">iPhone / iPad:</strong> Web Push só
            funciona com o app na Tela de Início (Safari → Compartilhar → Adicionar à Tela
            de Início) e iOS 16.4 ou superior. Abrir só no Safari sem instalar não basta.
          </li>
          <li>
            <strong className="font-medium text-texto">Safari no Mac:</strong> suporte
            limitado; prefira Chrome ou Edge, ou o PWA instalado.
          </li>
          <li>
            O sistema operacional pode adiar ou silenciar avisos se o app não for aberto
            há muito tempo — não é falha da clínica.
          </li>
          <li>
            <strong className="font-medium text-texto">Som:</strong> pedimos o tom do
            sistema (`silent: false`). iOS e Android quase nunca tocam um arquivo de som
            customizado — o aparelho usa o bip padrão de notificação. Não dá para forçar
            um áudio próprio em todos os aparelhos.
          </li>
          <li>
            Em desenvolvimento local, use <code className="text-texto">localhost</code> ou
            HTTPS; HTTP comum não registra service worker.
          </li>
        </ul>
      </div>
    </section>
  )
}
