/**
 * Estágios do funil.
 *
 * Módulo separado de `acoes.ts` por dois motivos. O técnico: um arquivo
 * `'use server'` só pode exportar função assíncrona, então uma constante não
 * cabe lá. O de desenho: esta é a única definição da ordem e dos rótulos do
 * funil, e é dela que saem as colunas do kanban, o enum do zod na Server Action
 * e o texto na tela. Ordem igual à das Global Constraints e ao enum
 * `patient_stage` do banco.
 */

export const ESTAGIOS = [
  'lead',
  'contato',
  'agendado',
  'compareceu',
  'paciente',
  'retorno',
  'descartado',
] as const

export type PatientStage = (typeof ESTAGIOS)[number]

/** Texto que a equipe lê na coluna. O valor do banco nunca vai à tela. */
export const ROTULOS: Record<PatientStage, string> = {
  lead: 'Lead',
  contato: 'Em contato',
  agendado: 'Agendado',
  compareceu: 'Compareceu',
  paciente: 'Paciente',
  retorno: 'Retorno',
  descartado: 'Descartado',
}

/** Guarda de tipo para valor vindo do DOM (dataTransfer, select) ou do banco. */
export function ehEstagio(valor: unknown): valor is PatientStage {
  return typeof valor === 'string' && (ESTAGIOS as readonly string[]).includes(valor)
}

/**
 * Agrupa por estágio devolvendo as sete chaves sempre presentes, mesmo vazias:
 * o kanban precisa desenhar a coluna vazia, não pulá-la.
 */
export function agruparPorEstagio<T extends { stage: PatientStage }>(
  itens: T[],
): Record<PatientStage, T[]> {
  const grupos = Object.fromEntries(ESTAGIOS.map((estagio) => [estagio, [] as T[]])) as Record<
    PatientStage,
    T[]
  >
  for (const item of itens) {
    // Estágio desconhecido (enum novo no banco, código antigo na tela) é
    // ignorado em vez de derrubar a página inteira.
    if (ehEstagio(item.stage)) grupos[item.stage].push(item)
  }
  return grupos
}
