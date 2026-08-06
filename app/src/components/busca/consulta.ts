/**
 * Interpretação do que a pessoa digitou na busca global.
 *
 * Módulo puro, separado da Server Action pelo motivo de sempre: `'use server'`
 * só exporta função assíncrona, e decidir o que é nome e o que é telefone é
 * regra que merece teste sem banco.
 *
 * O ponto delicado é o telefone. O cadastro guarda sempre E.164
 * (`+5511987654321`, ver `src/lib/phone.ts`), e a secretária digita o que está
 * no papel: `(11) 98765-4321`, `11 98765-4321`, ou só o final `98765`. As duas
 * pontas precisam ser normalizadas ou a busca não acha ninguém — e "não achei"
 * numa clínica é a paciente esperando no telefone.
 */

import { normalizarTelefone } from '@/lib/phone'

/** Abaixo disto a busca não sai: um caractere casaria com o cadastro inteiro. */
export const MINIMO_DE_CARACTERES = 2

/** Dígitos de menos não identificam ninguém; `11` acharia meio DDD do Brasil. */
const MINIMO_DE_DIGITOS = 3

export type AlvoDaBusca = {
  /** O termo já aparado, como será mostrado em "Nada encontrado para …". */
  termo: string
  /** Padrão `ilike` para `patients.nome_completo` e `procedures.nome`. */
  padraoNome: string
  /**
   * Padrão `ilike` para `patients.telefone`, ou `null` quando o termo não tem
   * dígitos suficientes para ser telefone.
   */
  padraoTelefone: string | null
}

/**
 * Escapa os curingas do `like`. Sem isto, um `%` digitado por engano viraria
 * "traga tudo", e um `_` casaria com qualquer caractere — busca que devolve o
 * cadastro inteiro é tão inútil quanto a que não devolve nada.
 */
function escaparLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (caractere) => `\\${caractere}`)
}

/**
 * Devolve `null` quando não há o que buscar — termo curto ou só espaço. Quem
 * chama não deve nem tocar no banco nesse caso.
 */
export function interpretarBusca(bruto: string): AlvoDaBusca | null {
  const termo = bruto.trim()
  if (termo.length < MINIMO_DE_CARACTERES) return null

  return {
    termo,
    padraoNome: `%${escaparLike(termo)}%`,
    padraoTelefone: padraoDeTelefone(termo),
  }
}

/** Quantos itens de cada grupo cabem no painel sem virar rolagem. */
export const TETO_POR_GRUPO = 6

export type PacienteEncontrado = {
  id: string
  nome: string
  telefone: string | null
}

export type ProcedimentoEncontrado = {
  id: string
  nome: string
  duracaoMinutos: number
  precoCentavos: number
}

export type ResultadoDaBusca = {
  termo: string
  pacientes: PacienteEncontrado[]
  procedimentos: ProcedimentoEncontrado[]
}

/**
 * Junta os achados por nome e os achados por telefone.
 *
 * São duas consultas separadas em vez de um `or` do PostgREST de propósito: o
 * `or` recebe os filtros dentro de uma string única, separados por vírgula, e
 * um nome com vírgula ou parêntese — "(11)" colado no campo, por exemplo —
 * mudaria a expressão em vez de ser procurado. Duas consultas simples não têm
 * como ser confundidas com sintaxe.
 *
 * Quem casou pelos dois critérios aparece uma vez só, e a ordem de quem casou
 * por nome é preservada.
 */
export function mesclarPacientes(
  ...listas: PacienteEncontrado[][]
): PacienteEncontrado[] {
  const vistos = new Set<string>()
  const juntos: PacienteEncontrado[] = []

  for (const lista of listas) {
    for (const paciente of lista) {
      if (vistos.has(paciente.id)) continue
      vistos.add(paciente.id)
      juntos.push(paciente)
    }
  }

  return juntos.slice(0, TETO_POR_GRUPO)
}

/**
 * O termo virando padrão de telefone.
 *
 * Quando dá para inferir um número brasileiro inteiro, o padrão é o E.164 sem o
 * `+` — `(11) 98765-4321` vira `%5511987654321%`, que casa com o
 * `+5511987654321` gravado. Quando é pedaço de número (a secretária lembra do
 * final), o padrão são os dígitos crus: E.164 é contíguo, então `%98765%` casa
 * com o miolo do que está no banco sem precisar saber o DDD.
 */
function padraoDeTelefone(termo: string): string | null {
  const digitos = termo.replace(/\D/g, '')
  if (digitos.length < MINIMO_DE_DIGITOS) return null

  const e164 = normalizarTelefone(termo)
  if (e164) return `%${e164.slice(1)}%`

  return `%${digitos}%`
}
