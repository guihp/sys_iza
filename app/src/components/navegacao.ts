/**
 * O menu lateral: quais itens existem, quem os enxerga e que número aparece ao
 * lado de cada um.
 *
 * Módulo puro, sem React: a regra de papel é a coisa mais séria desta casca —
 * é ela que impede a secretária de sequer ver o caminho das telas de
 * configuração — e regra dessa natureza se testa sem renderizar nada.
 */

import type { Sessao } from '@/auth/session'

/** Contadores que a casca busca no banco e distribui pelos itens. */
export type ContadoresDaCasca = {
  /** Leads ativos: todo mundo menos `paciente` e `descartado`. */
  funil: number
  /** Consultas de hoje, no calendário da clínica. */
  agendaHoje: number
  /** Retornos já vencidos. */
  retornosVencidos: number
  /** Templates de mensagem ligados. */
  mensagensAtivas: number
}

export type ChaveDeContador = keyof ContadoresDaCasca

/** Banco vazio é o estado normal desta clínica, não um caso de exceção. */
export const CONTADORES_ZERADOS: ContadoresDaCasca = {
  funil: 0,
  agendaHoje: 0,
  retornosVencidos: 0,
  mensagensAtivas: 0,
}

export type ItemDeNavegacao = {
  href: string
  rotulo: string
  /** Papéis que enxergam o item. Ausente = todo mundo enxerga. */
  papeis?: Sessao['role'][]
  /** Contador exibido à direita. Ausente = o item não conta nada. */
  contador?: ChaveDeContador
}

const NAVEGACAO: ItemDeNavegacao[] = [
  { href: '/crm', rotulo: 'Funil', contador: 'funil' },
  { href: '/pacientes', rotulo: 'Pacientes' },
  { href: '/agenda', rotulo: 'Agenda', contador: 'agendaHoje' },
  { href: '/retornos', rotulo: 'Retornos', contador: 'retornosVencidos' },
  // Cobranças dos atendimentos: a secretária também lê (RLS SELECT equipe) —
  // precisa ver o que falta entrar ao falar com a paciente. Sem baixa manual
  // na UI (cartão liquida no vencimento). Sem contador: o número útil é valor
  // em aberto, e valor não cabe no formato de contagem do menu.
  { href: '/financeiro', rotulo: 'Financeiro' },
  // Marketing fica com as telas de operação, e não com as de configuração, por
  // causa do que ela é: relatório que se lê toda semana, não ajuste que se faz
  // uma vez. Exclusiva da dra — a tela mostra quanto a clínica gasta, quanto
  // fatura e quanto custa cada paciente, que é informação de dona do negócio.
  // Sem contador: o número que importaria ali é o gasto, e gasto não cabe no
  // formato de contagem do menu.
  { href: '/marketing', rotulo: 'Marketing', papeis: ['dra'] },
  // Meta/Marca/Mensagens/Procedimentos/Google: Dra. Notificações: equipe
  // inteira (push no device). Contador de mensagens só é útil para a Dra.;
  // a secretária entra pela mesma porta e cai em Notificações.
  {
    href: '/configuracoes',
    rotulo: 'Configurações',
    contador: 'mensagensAtivas',
  },
]

/** Função pura: o menu é derivado do papel, não escondido com CSS. */
export function itensDeNavegacao(role: Sessao['role']): ItemDeNavegacao[] {
  return NAVEGACAO.filter((item) => !item.papeis || item.papeis.includes(role))
}

/**
 * O texto do contador, ou `null` quando não há o que mostrar.
 *
 * Zero é omitido de propósito: com o banco vazio, seis zeros enfileirados na
 * lateral pareceriam defeito de carregamento. O contador só aparece quando
 * conta alguma coisa.
 *
 * A agenda leva o sufixo "hoje" porque o número dela responde a outra pergunta
 * que a dos vizinhos — "3" ao lado de Agenda seria lido como três consultas ao
 * todo, e são três hoje.
 */
export function formatarContador(
  item: ItemDeNavegacao,
  contadores: ContadoresDaCasca,
): string | null {
  if (!item.contador) return null

  const valor = contadores[item.contador]
  if (!Number.isFinite(valor) || valor <= 0) return null

  return item.contador === 'agendaHoje' ? `${valor} hoje` : String(valor)
}

/**
 * O item está ativo para este caminho?
 *
 * Prefixo com barra, e não `startsWith` cru: `/crm` não pode acender por causa
 * de uma futura `/crmx`, e `/configuracoes` precisa continuar aceso em
 * `/configuracoes/meta`, `/configuracoes/marca`, etc.
 */
export function itemAtivo(item: ItemDeNavegacao, caminho: string | null): boolean {
  if (!caminho) return false
  return caminho === item.href || caminho.startsWith(`${item.href}/`)
}

/** Papel por extenso, como aparece no rodapé da sidebar. */
export function papelPorExtenso(role: Sessao['role']): string {
  return role === 'dra' ? 'Doutora' : 'Secretária'
}
