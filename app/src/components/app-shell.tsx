'use client'

import { useEffect, useId, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { Sessao } from '@/auth/session'
import { BuscaGlobal } from '@/components/busca/busca-global'
import { NovoLead } from '@/components/lead/novo-lead'
import { NavegacaoLateral } from '@/components/navegacao-lateral'
import { BotaoInstalarApp } from '@/components/pwa/instalar-app'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar, Cartao, RotuloMiudo, juntar } from '@/components/ui'
import { dataDaClinica, formatarDiaComData } from '@/lib/datetime'
import {
  descreverProgresso,
  formatarValorRedondo,
  progressoDaMeta,
  type ProgressoDaMeta,
} from '@/lib/meta'
import {
  CONTADORES_ZERADOS,
  itensDeNavegacao,
  papelPorExtenso,
  type ContadoresDaCasca,
} from './navegacao'

/**
 * Reexportados para não quebrar quem já importava daqui. A definição mora em
 * `./navegacao`, que é módulo puro e testável sem renderizar a casca.
 */
export { itensDeNavegacao }
export type { ItemDeNavegacao, ContadoresDaCasca } from './navegacao'

export type DadosDaCasca = {
  contadores?: Partial<ContadoresDaCasca>
  /** Realizado do mês, em centavos. Ausente = R$ 0, que é o estado de hoje. */
  realizadoDoMesCentavos?: number
  /** Alvo do mês em centavos. Ausente = fallback `META_MENSAL_CENTAVOS`. */
  metaDoMesCentavos?: number
  /** `YYYY-MM-DD` no calendário da clínica. Ausente = hoje. */
  hojeISO?: string
  /** Logo pública (`/marca/...`). Ausente = filete dourado. */
  logoUrl?: string | null
}

/**
 * Casca do sistema: duas colunas na viewport.
 *
 * **Desktop (`lg+`):** sidebar fixa na tela — coluna `h-dvh` sticky; o miolo da
 * navegação rola; o conteúdo rola no `<main>`.
 *
 * **Telefone e tablet em retrato (`< lg`):** a sidebar vira gaveta overlay.
 * O conteúdo usa a largura inteira; o menu abre pelo botão no cabeçalho.
 *
 * Componente de cliente: o estado aberto/fechado da gaveta e o fechamento ao
 * navegar exigem hooks. Continua sem I/O — números chegam por prop do layout.
 */
export function AppShell({
  sessao,
  contadores,
  realizadoDoMesCentavos = 0,
  metaDoMesCentavos,
  hojeISO,
  logoUrl = null,
  children,
}: { sessao: Sessao; children: React.ReactNode } & DadosDaCasca) {
  const itens = itensDeNavegacao(sessao.role)
  const numeros: ContadoresDaCasca = { ...CONTADORES_ZERADOS, ...contadores }
  const hoje = hojeISO ?? dataDaClinica(new Date())
  const meta = progressoDaMeta(realizadoDoMesCentavos, hoje, metaDoMesCentavos)
  const caminho = usePathname()
  const idDoMenu = useId()
  const [menuAberto, setMenuAberto] = useState(false)

  useEffect(() => {
    setMenuAberto(false)
  }, [caminho])

  useEffect(() => {
    if (!menuAberto) return
    function fecharComEsc(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setMenuAberto(false)
    }
    window.addEventListener('keydown', fecharComEsc)
    return () => window.removeEventListener('keydown', fecharComEsc)
  }, [menuAberto])

  return (
    <div className="flex h-dvh bg-fundo text-texto">
      {menuAberto ? (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-texto/35 lg:hidden"
          onClick={() => setMenuAberto(false)}
        />
      ) : null}

      <nav
        id={idDoMenu}
        aria-label="Navegação principal"
        className={juntar(
          'flex h-dvh w-[min(18rem,88vw)] shrink-0 flex-col border-r border-linha bg-fundo px-5 py-6 sm:px-6 sm:py-8',
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out',
          'pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'lg:sticky lg:top-0 lg:z-auto lg:w-64 lg:translate-x-0 lg:pt-8 lg:pb-8',
          menuAberto ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- upload local
              <img
                src={logoUrl}
                alt="Logo da clínica"
                className="mb-4 h-9 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <span aria-hidden="true" className="mb-4 block h-0.5 w-10 bg-acento" />
            )}
            <p className="font-serif text-[22px] leading-tight">Dra. Izadora Barros</p>
            <RotuloMiudo className="mt-2 block leading-[1.7]">
              Estética avançada ·<br />
              CRO SP 173735
            </RotuloMiudo>
          </div>
          <button
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-cartao border border-linha text-texto lg:hidden"
            aria-label="Fechar menu"
            onClick={() => setMenuAberto(false)}
          >
            <IconeFechar />
          </button>
        </div>

        {/* `min-h-0` é o que deixa o `overflow-y-auto` valer dentro de um flex:
            sem ele o item cresce além do contêiner em vez de rolar, e a rolagem
            escaparia para o documento — levando a sidebar junto. */}
        <div className="mt-8 min-h-0 flex-1 overflow-y-auto">
          <RotuloMiudo className="mb-3 block">Gestão</RotuloMiudo>
          <NavegacaoLateral itens={itens} contadores={numeros} />
        </div>

        <div className="mt-6 space-y-4">
          <CartaoDaMeta meta={meta} />
          <div className="flex items-center gap-3">
            <Avatar nome={sessao.nome} />
            <div className="min-w-0">
              <p className="truncate text-[13px] leading-tight">{sessao.nome}</p>
              <p className="text-[11px] text-texto-suave">{papelPorExtenso(sessao.role)}</p>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-linha px-4 py-3 sm:min-h-[72px] sm:flex-nowrap sm:gap-4 sm:px-6 sm:py-0">
          <button
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-cartao border border-linha text-texto lg:hidden"
            aria-expanded={menuAberto}
            aria-controls={idDoMenu}
            aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setMenuAberto((aberto) => !aberto)}
          >
            {menuAberto ? <IconeFechar /> : <IconeMenu />}
          </button>

          <div className="min-w-0 flex-1 basis-[12rem]">
            <BuscaGlobal />
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {/* `suppressHydrationWarning` não cabe aqui: a data é resolvida no
                servidor, no fuso da clínica, e vai ao HTML já formatada — o
                relógio do navegador de quem abre a tela não participa. */}
            <span className="hidden text-[13px] text-texto-suave md:inline">
              {formatarDiaComData(hoje)}
            </span>
            <BotaoInstalarApp />
            <ThemeToggle />
            <NovoLead />
          </div>
        </header>

        {/*
          Rolagem vertical fica no `<main>` (não no documento): a barra cai no
          rodapé da coluna de conteúdo. Páginas que precisam preencher a altura
          (funil) usam `flex-1 min-h-0` no miolo.
        */}
        <main
          className={juntar(
            'flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6 sm:py-8',
            menuAberto && 'max-lg:overflow-hidden',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * Meta do mês. O valor grande é o **realizado** (caixa recebido no mês), não
 * o alvo: é o número que muda todo dia. Com o banco vazio dá `R$ 0`, barra
 * zerada e "0% alcançado · N dias restantes" — estado correto, não erro.
 */
function CartaoDaMeta({ meta }: { meta: ProgressoDaMeta }) {
  return (
    <Cartao className="p-4">
      <RotuloMiudo className="block">Meta do mês</RotuloMiudo>
      <p className="mt-1 font-serif text-[28px] leading-none">
        {formatarValorRedondo(meta.realizadoCentavos)}
      </p>
      <div
        role="progressbar"
        aria-label="Progresso da meta do mês"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meta.percentualDaBarra}
        className="mt-3 h-1 w-full overflow-hidden rounded-full bg-linha"
      >
        <div className="h-full rounded-full bg-acento" style={{ width: `${meta.percentualDaBarra}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-texto-suave">{descreverProgresso(meta)}</p>
    </Cartao>
  )
}

function IconeMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconeFechar() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
