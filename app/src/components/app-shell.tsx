import Link from 'next/link'
import type { Sessao } from '@/auth/session'
import { ThemeToggle } from '@/components/theme-toggle'

export type ItemDeNavegacao = {
  href: string
  rotulo: string
  /** Papéis que enxergam o item. Ausente = todo mundo enxerga. */
  papeis?: Sessao['role'][]
}

const NAVEGACAO: ItemDeNavegacao[] = [
  { href: '/crm', rotulo: 'Funil' },
  { href: '/agenda', rotulo: 'Agenda' },
  { href: '/retornos', rotulo: 'Retornos' },
  // Configurações são de escrita exclusiva da dra (ver `exigirDra`): não
  // adianta oferecer à secretária um link para uma tela que ela não opera.
  { href: '/configuracoes/procedimentos', rotulo: 'Procedimentos', papeis: ['dra'] },
  { href: '/configuracoes/mensagens', rotulo: 'Mensagens', papeis: ['dra'] },
  // Sincronia opcional com o Google Agenda: é a agenda pessoal da Dra. que está
  // do outro lado, e a tela mostra com qual conta o sistema fala com o Google.
  { href: '/configuracoes/google', rotulo: 'Google Agenda', papeis: ['dra'] },
]

/** Função pura: o menu é derivado do papel, não escondido com CSS. */
export function itensDeNavegacao(role: Sessao['role']): ItemDeNavegacao[] {
  return NAVEGACAO.filter((item) => !item.papeis || item.papeis.includes(role))
}

export function AppShell({ sessao, children }: { sessao: Sessao; children: React.ReactNode }) {
  const itens = itensDeNavegacao(sessao.role)

  return (
    <div className="min-h-dvh bg-fundo text-texto">
      <header className="flex items-center justify-between border-b border-linha px-6 py-4">
        <div>
          <p className="font-serif text-lg leading-tight">Dra. Izadora Barros</p>
          <p className="text-xs text-texto/50">CRO SP 173735</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-texto/70">
            {sessao.nome} · {sessao.role === 'dra' ? 'Doutora' : 'Secretaria'}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex">
        <nav aria-label="Navegação principal" className="w-52 shrink-0 border-r border-linha p-4">
          <ul className="space-y-1">
            {itens.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-lg px-3 py-2 text-sm hover:bg-superficie"
                >
                  {item.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
