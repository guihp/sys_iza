/**
 * Formatação do payload de push de agendamento — puro, sem rede.
 *
 * O envio (web-push) mora em `enviar.ts`. Este módulo existe para o texto da
 * notificação ser testável sem mock de HTTP.
 */

import { dataDaClinica, formatarDataExtensa, horaDaClinica } from '@/lib/datetime'

export type DadosDoAgendamentoParaPush = {
  nomePaciente: string
  nomeProcedimento: string
  inicio: Date
}

export type PayloadDePushDeAgendamento = {
  titulo: string
  corpo: string
  url: string
}

/**
 * Monta título/corpo/URL da notificação "novo agendamento".
 *
 * Data e hora no relógio da clínica — o device da secretária pode estar em
 * outro fuso e a frase precisa bater com a grade da agenda.
 */
export function formatarPayloadDeAgendamento(
  dados: DadosDoAgendamentoParaPush,
): PayloadDePushDeAgendamento {
  const dataISO = dataDaClinica(dados.inicio)
  const data = formatarDataExtensa(dataISO)
  const hora = horaDaClinica(dados.inicio)
  const paciente = dados.nomePaciente.trim() || 'Paciente'
  const procedimento = dados.nomeProcedimento.trim() || 'procedimento'

  return {
    titulo: 'Novo agendamento',
    corpo: `${paciente} · ${data} às ${hora} · ${procedimento}`,
    url: '/agenda',
  }
}
