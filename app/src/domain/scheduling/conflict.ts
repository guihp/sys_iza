/**
 * Detecção de conflito de horário na agenda.
 *
 * Função pura, sem I/O: quem carrega os agendamentos do banco é a Server Action,
 * quem decide se dois horários colidem é este módulo. É o que permite testar a
 * regra — inclusive as bordas — sem subir banco nenhum.
 *
 * A clínica tem uma profissional só. Por isso "conflito" aqui é sobreposição na
 * agenda inteira, e não por sala ou por profissional. Se um dia entrar uma
 * segunda cadeira, o que muda é o filtro da consulta, não esta regra.
 */

export type Slot = {
  /**
   * Identidade do agendamento já gravado. Ausente no agendamento novo — é
   * exatamente essa ausência que distingue "estou criando" de "estou remarcando".
   */
  id?: string
  inicio: Date
  fim: Date
  /**
   * Agendamento cancelado não ocupa horário. A consulta ao banco já poderia
   * filtrar por status, mas a regra vive aqui: assim ela é testável offline e
   * não depende de todo caller lembrar do `.neq('status', 'cancelado')`.
   */
  cancelado?: boolean
}

/**
 * Devolve o primeiro slot que colide com `novo`, ou `null` se o horário está
 * livre.
 *
 * Intervalos são semiabertos — `[inicio, fim)`. Consequência prática: a consulta
 * das 15:00 pode começar no mesmo instante em que a das 14:00 termina. Encostar
 * é agenda cheia, não conflito; tratar isso como colisão inviabilizaria uma
 * agenda de horários seguidos, que é como a clínica trabalha.
 *
 * Duas exceções ao teste de sobreposição, ambas necessárias:
 *   1. Um slot com o mesmo `id` do novo é o próprio agendamento sendo remarcado.
 *      Sem isso, mover uma consulta em quinze minutos acusaria conflito com ela
 *      mesma e remarcar seria impossível.
 *   2. Um slot cancelado libera o horário — foi para isso que ele foi cancelado.
 */
export function detectarConflito(novo: Slot, existentes: Slot[]): Slot | null {
  for (const atual of existentes) {
    if (atual.cancelado) continue
    // `novo.id &&` importa: sem ele, um agendamento novo (sem id) casaria com
    // qualquer existente que também não tenha id, e a agenda inteira sumiria
    // da checagem.
    if (novo.id && atual.id === novo.id) continue

    const colide = novo.inicio < atual.fim && atual.inicio < novo.fim
    if (colide) return atual
  }
  return null
}
