/**
 * Montagem da fila de retornos.
 *
 * Módulo separado de `page.tsx` porque é regra, não desenho: decidir quem
 * aparece na fila, em que ordem e com quantos dias de atraso é o tipo de coisa
 * que precisa de teste, e teste de função pura não precisa de banco nem de
 * renderização. Mesmo padrão de `agenda/grade.ts` e `crm/estagios.ts`.
 *
 * Sem I/O aqui: quem lê o banco é a página, quem calcula status é
 * `src/domain/returns/compute-return.ts`, e este arquivo é a costura entre os
 * dois.
 */

import {
  diasAteRetorno,
  statusRetorno,
  type StatusRetorno,
} from '@/domain/returns/compute-return'
import { diaDeCalendario } from '@/lib/datetime'

/** Um atendimento do prontuário, com o vencimento que ele gravou. */
export type AtendimentoDoPaciente = {
  atendimentoId: string
  pacienteId: string
  paciente: string
  telefone: string | null
  procedimento: string
  /** Instante ISO em que o atendimento foi realizado. */
  realizadoEm: string
  /**
   * `YYYY-MM-DD` da coluna `retorno_vencimento`, ou `null` quando aquele
   * atendimento não gerou retorno — por dispensa da Dra. ou porque o
   * procedimento não gera retorno e ninguém ajustou nada.
   */
  vencimento: string | null
}

/** Linha que de fato aparece na tela. Só `vencido` e `vencendo` chegam aqui. */
export type LinhaDaFila = AtendimentoDoPaciente & {
  vencimento: string
  status: Extract<StatusRetorno, 'vencido' | 'vencendo'>
  /** Positivo = dias que faltam; negativo = dias de atraso. */
  diasRestantes: number
}

/** Vencido antes de vencendo. Só isto define o agrupamento na tela. */
const PESO: Record<LinhaDaFila['status'], number> = { vencido: 0, vencendo: 1 }

/**
 * Reduz o prontuário ao último atendimento de cada paciente.
 *
 * É o passo que impede a fila de mentir. Uma paciente acumula atendimentos ao
 * longo dos anos, cada um com o seu vencimento, e só o mais recente descreve a
 * situação de agora: quem voltou mês passado não está atrasada porque o retorno
 * de 2024 venceu, e quem a Dra. dispensou do retorno no último atendimento não
 * pode continuar sendo cobrada por causa do penúltimo.
 *
 * Não confia na ordem em que os registros chegam — ordena por conta própria,
 * com o id como desempate para que a saída seja determinística mesmo se dois
 * atendimentos tiverem o mesmo instante.
 */
export function ultimoPorPaciente(registros: AtendimentoDoPaciente[]): AtendimentoDoPaciente[] {
  const ultimo = new Map<string, AtendimentoDoPaciente>()

  for (const registro of registros) {
    const atual = ultimo.get(registro.pacienteId)
    if (!atual || maisRecente(registro, atual)) ultimo.set(registro.pacienteId, registro)
  }

  return [...ultimo.values()]
}

function maisRecente(candidato: AtendimentoDoPaciente, atual: AtendimentoDoPaciente): boolean {
  const a = new Date(candidato.realizadoEm).getTime()
  const b = new Date(atual.realizadoEm).getTime()
  if (a !== b) return a > b
  return candidato.atendimentoId > atual.atendimentoId
}

/**
 * A fila: quem precisa ser chamado de volta, na ordem em que deve ser chamado.
 *
 * `hojeISO` é o dia de calendário **da clínica** (`dataDaClinica(new Date())`),
 * e é o único ponto em que fuso horário entra nesta conta. Depois disso as duas
 * pontas viram âncoras de calendário em UTC e a diferença entre elas é aritmética
 * exata — ver `diaDeCalendario` em `src/lib/datetime.ts`. Passar o dia do
 * servidor no lugar do dia da clínica marcaria como atrasada, das 21:00 em
 * diante, gente cujo retorno vence só amanhã.
 */
export function montarFila(registros: AtendimentoDoPaciente[], hojeISO: string): LinhaDaFila[] {
  const hoje = diaDeCalendario(hojeISO)

  const fila: LinhaDaFila[] = []

  for (const registro of ultimoPorPaciente(registros)) {
    if (!registro.vencimento) continue

    const vencimento = diaDeCalendario(registro.vencimento)
    const status = statusRetorno(vencimento, hoje)
    // 'em_dia' fica de fora porque não há o que fazer com ele hoje, e
    // 'sem_retorno' não chega aqui — o `continue` acima já filtrou.
    if (status !== 'vencido' && status !== 'vencendo') continue

    fila.push({
      ...registro,
      vencimento: registro.vencimento,
      status,
      diasRestantes: diasAteRetorno(vencimento, hoje),
    })
  }

  return fila.sort(
    (a, b) =>
      PESO[a.status] - PESO[b.status] ||
      a.vencimento.localeCompare(b.vencimento) ||
      // Desempate por nome para a lista não trocar de ordem entre dois
      // carregamentos iguais — a secretária percorre a fila de cima para baixo.
      a.paciente.localeCompare(b.paciente, 'pt-BR'),
  )
}

/** Os dois números do topo da tela. */
export function contarPorStatus(fila: LinhaDaFila[]): { vencidos: number; vencendo: number } {
  return {
    vencidos: fila.filter((linha) => linha.status === 'vencido').length,
    vencendo: fila.filter((linha) => linha.status === 'vencendo').length,
  }
}
