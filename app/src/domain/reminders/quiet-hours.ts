/**
 * Janela de silêncio dos envios.
 *
 * Módulo puro: sem I/O, sem Supabase, sem React, sem Next. A única dependência
 * é `src/lib/datetime.ts`, que também é pura — e é de propósito que o fuso venha
 * de lá. O horário da janela é o relógio de parede da clínica, não o do
 * servidor (que roda em UTC) nem o do navegador de quem abriu a tela. Escrever
 * "menos três horas" na mão acertaria hoje e erraria no dia em que o horário de
 * verão voltar por decreto — e erraria calado, mandando mensagem às 22h para
 * paciente dormindo.
 *
 * Esta função NÃO é aplicada no planejamento (`plan-reminders.ts`), e sim no
 * despacho. O motivo: entre planejar e enviar passam horas ou meses, o worker
 * pode atrasar, e o que decide se é hora decente de tocar o celular de alguém é
 * o relógio do envio, não o do planejamento. Um job planejado para as 20:00 que
 * só sai às 21:30 por atraso do worker precisa ser barrado — e só o despacho
 * tem essa informação.
 */

import { dataDaClinica, deslocarData, instanteDaClinica, paredeDaClinica } from '@/lib/datetime'

/**
 * Primeira hora de silêncio, inclusive: 21:00 já não se manda mensagem.
 *
 * O paciente da clínica é atendido em horário comercial estendido e a mensagem
 * chega no WhatsApp pessoal dele. Vinte e uma horas é o limite em que uma
 * notificação ainda é lembrete e não incômodo.
 */
export const SILENCIO_INICIO = 21

/** Primeira hora liberada, exclusive do silêncio: 08:00 já pode. */
export const SILENCIO_FIM = 8

/**
 * Hora em que o que foi silenciado sai.
 *
 * Nove e não oito, embora às 08:00 já seja permitido: o reagendamento em massa
 * da madrugada inteira cairia todo no mesmo minuto de abertura da janela, e a
 * clínica prefere que a paciente encontre a mensagem já acordada e com o dia
 * começado. A diferença de uma hora não muda nada operacionalmente e evita a
 * rajada às 08:00 em ponto.
 */
export const HORA_DE_RETOMADA = 9

/** O instante cai no intervalo em que não se envia nada? */
export function dentroDaJanelaDeSilencio(momento: Date): boolean {
  const { hora } = paredeDaClinica(momento)
  return hora >= SILENCIO_INICIO || hora < SILENCIO_FIM
}

/**
 * Reagenda para as 09:00 locais quando o momento cai na janela de silêncio.
 * Fora dela, devolve o próprio instante, sem tocar em nada.
 *
 * A janela cruza a meia-noite, e é aí que mora a única sutileza: "o dia
 * seguinte" depende de que lado da virada o instante está.
 *
 *   - A partir das 21:00, o alvo é o dia **seguinte** de calendário. 22:00 de
 *     terça vira 09:00 de quarta.
 *   - Antes das 08:00, o alvo é o **mesmo** dia de calendário — a madrugada de
 *     quarta já é quarta. Somar mais um dia aqui atrasaria o lembrete em 24
 *     horas inteiras, que é exatamente o tipo de erro que faz a confirmação
 *     chegar depois da consulta.
 *
 * Sem regra de feriado nem de fim de semana, por decisão: a clínica quer que a
 * confirmação de segunda-feira saia no domingo de manhã, e um lembrete adiado
 * para "o próximo dia útil" chegaria tarde demais para servir de lembrete. Dia
 * seguinte é dia seguinte de calendário.
 *
 * Idempotente: aplicar sobre um resultado já reagendado devolve o mesmo
 * instante, porque 09:00 está fora da janela.
 */
export function aplicarJanelaDeSilencio(momento: Date): Date {
  if (!dentroDaJanelaDeSilencio(momento)) return momento

  const { hora } = paredeDaClinica(momento)
  const dia = dataDaClinica(momento)
  const diaDoEnvio = hora >= SILENCIO_INICIO ? deslocarData(dia, 1) : dia

  return instanteDaClinica(diaDoEnvio, HORA_DE_RETOMADA * 60)
}
