import type { Sessao } from '@/auth/session'
import { BuscaGlobal } from '@/components/busca/busca-global'
import { NovoLead } from '@/components/lead/novo-lead'
import { NavegacaoLateral } from '@/components/navegacao-lateral'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar, Cartao, RotuloMiudo } from '@/components/ui'
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
  /** `YYYY-MM-DD` no calendário da clínica. Ausente = hoje. */
  hojeISO?: string
  /** Logo pública (`/marca/...`). Ausente = filete dourado. */
  logoUrl?: string | null
}

/**
 * Casca do sistema: duas colunas ocupando a viewport inteira.
 *
 * **A sidebar é fixa na tela.** Ela é `sticky top-0` com `h-dvh` própria, e o
 * miolo da navegação é a única parte dela com rolagem. O que rola é o documento
 * — nem o `<main>` nem nenhum ancestral tem `overflow`, porque um `overflow`
 * no meio do caminho criaria um novo contexto de rolagem e o `sticky` passaria
 * a grudar nele, ou seja, em nada. Era esse o bug: a lateral subia junto com o
 * conteúdo.
 *
 * Componente **síncrono e sem I/O**: todos os números chegam prontos por prop,
 * vindos de `carregarDadosDaCasca` no layout. Isso mantém a casca renderizável
 * num teste sem banco, e é o que permite `contadores` ausente significar
 * exatamente o que significa hoje — banco vazio, tudo zero, nenhum contador na
 * tela.
 */
export function AppShell({
  sessao,
  contadores,
  realizadoDoMesCentavos = 0,
  hojeISO,
  logoUrl = null,
  children,
}: { sessao: Sessao; children: React.ReactNode } & DadosDaCasca) {
  const itens = itensDeNavegacao(sessao.role)
  const numeros: ContadoresDaCasca = { ...CONTADORES_ZERADOS, ...contadores }
  const hoje = hojeISO ?? dataDaClinica(new Date())
  const meta = progressoDaMeta(realizadoDoMesCentavos, hoje)

  return (
    <div className="flex min-h-dvh bg-fundo text-texto">
      <nav
        aria-label="Navegação principal"
        className="sticky top-0 flex h-dvh w-64 shrink-0 flex-col border-r border-linha bg-fundo px-6 py-8"
      >
        <div>
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[72px] shrink-0 items-center justify-between gap-4 border-b border-linha px-6">
          <BuscaGlobal />
          <div className="flex items-center gap-4">
            {/* `suppressHydrationWarning` não cabe aqui: a data é resolvida no
                servidor, no fuso da clínica, e vai ao HTML já formatada — o
                relógio do navegador de quem abre a tela não participa. */}
            <span className="hidden text-[13px] text-texto-suave sm:inline">
              {formatarDiaComData(hoje)}
            </span>
            <ThemeToggle />
            <NovoLead />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  )
}

/**
 * Meta do mês. O valor grande é o **realizado**, não o alvo: é o número que
 * muda todo dia. Com o banco vazio dá `R$ 0`, barra zerada e
 * "0% alcançado · N dias restantes" — estado correto, não estado de erro.
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
