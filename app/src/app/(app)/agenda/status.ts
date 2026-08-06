/**
 * Situação de uma consulta.
 *
 * Módulo separado de `acoes.ts` porque arquivo `'use server'` só exporta função
 * assíncrona. Como em `crm/estagios.ts`, esta é a única definição da lista e dos
 * rótulos: dela saem o enum do zod na Server Action, a cor do bloco na grade e o
 * texto que a equipe lê. Ordem e valores iguais ao enum `appointment_status` do
 * banco (migration 0001).
 */

export const STATUS_DE_CONSULTA = [
  'agendado',
  'confirmado',
  'compareceu',
  'faltou',
  'cancelado',
] as const

export type StatusDeConsulta = (typeof STATUS_DE_CONSULTA)[number]

/** Texto na tela. O valor do banco nunca vai à interface. */
export const ROTULOS_DE_STATUS: Record<StatusDeConsulta, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  compareceu: 'Compareceu',
  faltou: 'Faltou',
  cancelado: 'Cancelado',
}

/**
 * Cor de fundo do bloco na grade, por situação.
 *
 * Opacidade sobre cor sólida em vez de tom fixo: os mesmos valores funcionam no
 * tema claro e no escuro, sem uma segunda tabela para manter em dia. O status
 * também aparece escrito dentro do bloco — cor sozinha não comunica para quem
 * não distingue as duas pontas do espectro.
 */
export const CORES_DE_STATUS: Record<StatusDeConsulta, string> = {
  agendado: 'border-linha bg-superficie',
  confirmado: 'border-emerald-600/40 bg-emerald-500/15',
  compareceu: 'border-acento bg-acento/20',
  faltou: 'border-amber-600/40 bg-amber-500/15',
  cancelado: 'border-dashed border-linha bg-transparent opacity-60',
}

/** Guarda de tipo para valor vindo do banco ou do DOM. */
export function ehStatusDeConsulta(valor: unknown): valor is StatusDeConsulta {
  return typeof valor === 'string' && (STATUS_DE_CONSULTA as readonly string[]).includes(valor)
}
