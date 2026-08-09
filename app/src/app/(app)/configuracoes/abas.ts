/**
 * Abas da área de Configurações.
 *
 * Módulo puro: a lista e a regra de "qual aba está ativa" são testáveis sem
 * React. O layout só renderiza o que este módulo devolve.
 */

import type { Sessao } from '@/auth/session'

export type AbaDeConfiguracoes = {
  href: string
  rotulo: string
  /** Papéis que enxergam a aba. Ausente = só a Dra. (padrão das configs). */
  papeis?: Sessao['role'][]
}

/**
 * Ordem do menu interno. Meta primeiro: é o ajuste que a Dra. muda com
 * frequência (todo mês). Notificações no fim da operação diária: dra e
 * secretaria ligam push no próprio device. Google: sincronia opcional.
 */
export const ABAS_DE_CONFIGURACOES: AbaDeConfiguracoes[] = [
  { href: '/configuracoes/meta', rotulo: 'Meta', papeis: ['dra'] },
  { href: '/configuracoes/marca', rotulo: 'Marca', papeis: ['dra'] },
  { href: '/configuracoes/mensagens', rotulo: 'Mensagens', papeis: ['dra'] },
  { href: '/configuracoes/procedimentos', rotulo: 'Procedimentos', papeis: ['dra'] },
  {
    href: '/configuracoes/notificacoes',
    rotulo: 'Notificações',
    papeis: ['dra', 'secretaria'],
  },
  { href: '/configuracoes/google', rotulo: 'Google Agenda', papeis: ['dra'] },
  {
    href: '/configuracoes/api',
    rotulo: 'API',
    papeis: ['dra', 'secretaria'],
  },
]

/** Abas visíveis para o papel logado. */
export function abasParaPapel(role: Sessao['role']): AbaDeConfiguracoes[] {
  return ABAS_DE_CONFIGURACOES.filter((aba) => !aba.papeis || aba.papeis.includes(role))
}

/**
 * Qual aba acende para este caminho.
 *
 * Prefixo com barra: `/configuracoes/meta` não acende por causa de um futuro
 * `/configuracoes/metalurgia`, e `/configuracoes/procedimentos/123` mantém
 * Procedimentos aceso.
 */
export function abaAtiva(
  caminho: string | null,
  abas: AbaDeConfiguracoes[] = ABAS_DE_CONFIGURACOES,
): string | null {
  if (!caminho) return null
  const encontrada = abas.find(
    (aba) => caminho === aba.href || caminho.startsWith(`${aba.href}/`),
  )
  return encontrada?.href ?? null
}
