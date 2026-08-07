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
  { href: '/agenda', rotulo: 'Agenda', contador: 'agendaHoje' },
  { href: '/retornos', rotulo: 'Retornos', contador: 'retornosVencidos' },
  // Configurações são de escrita exclusiva da dra (ver `exigirDra`): não
  // adianta oferecer à secretária um link para uma tela que ela não opera.
  { href: '/configuracoes/procedimentos', rotulo: 'Procedimentos', papeis: ['dra'] },
  { href: '/configuracoes/marca', rotulo: 'Marca', papeis: ['dra'] },
  {
    href: '/configuracoes/mensagens',
    rotulo: 'Mensagens',
    papeis: ['dra'],
    contador: 'mensagensAtivas',
  },
  // Sincronia opcional com o Google Agenda: é a agenda pessoal da Dra. que está
  // do outro lado, e a tela mostra com qual conta o sistema fala com o Google.
  { href: '/configuracoes/google', rotulo: 'Google Agenda', papeis: ['dra'] },
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
 * de uma futura `/crmx`, e `/configuracoes/procedimentos` precisa continuar
 * aceso em `/configuracoes/procedimentos/123`.
 */
export function itemAtivo(item: ItemDeNavegacao, caminho: string | null): boolean {
  if (!caminho) return false
  return caminho === item.href || caminho.startsWith(`${item.href}/`)
}

/** Papel por extenso, como aparece no rodapé da sidebar. */
export function papelPorExtenso(role: Sessao['role']): string {
  return role === 'dra' ? 'Doutora' : 'Secretária'
}
