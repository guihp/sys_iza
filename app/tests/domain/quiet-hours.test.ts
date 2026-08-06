import { describe, expect, it } from 'vitest'
import {
  aplicarJanelaDeSilencio,
  dentroDaJanelaDeSilencio,
  HORA_DE_RETOMADA,
  SILENCIO_FIM,
  SILENCIO_INICIO,
} from '@/domain/reminders/quiet-hours'

/**
 * Todos os instantes abaixo são escritos em UTC e comentados com a hora
 * correspondente no relógio da clínica. É de propósito: o que a regra decide é
 * sobre o relógio de São Paulo, e escrever o UTC ao lado deixa visível quando
 * uma coisa e outra discordam — que é justamente o caso das viradas de dia.
 *
 * São Paulo está em UTC-3 desde 2019. Os testes de 2018 são sobre o horário de
 * verão, quando estava em UTC-2.
 */

describe('constantes da janela', () => {
  it('silencia das 21:00 às 08:00 e retoma às 09:00', () => {
    expect(SILENCIO_INICIO).toBe(21)
    expect(SILENCIO_FIM).toBe(8)
    expect(HORA_DE_RETOMADA).toBe(9)
  })
})

describe('dentroDaJanelaDeSilencio', () => {
  it('20:59 ainda é horário de falar', () => {
    expect(dentroDaJanelaDeSilencio(new Date('2026-08-05T23:59:00Z'))).toBe(false)
  })

  it('21:00 em ponto já é silêncio', () => {
    expect(dentroDaJanelaDeSilencio(new Date('2026-08-06T00:00:00Z'))).toBe(true)
  })

  it('07:59 ainda é silêncio', () => {
    expect(dentroDaJanelaDeSilencio(new Date('2026-08-06T10:59:00Z'))).toBe(true)
  })

  it('08:00 em ponto já está liberado', () => {
    expect(dentroDaJanelaDeSilencio(new Date('2026-08-06T11:00:00Z'))).toBe(false)
  })
})

describe('aplicarJanelaDeSilencio', () => {
  it('deixa passar 14h de São Paulo', () => {
    // 14:00 em SP.
    expect(aplicarJanelaDeSilencio(new Date('2026-08-05T17:00:00Z')).toISOString()).toBe(
      '2026-08-05T17:00:00.000Z',
    )
  })

  it('deixa passar 20:59, o último minuto antes do silêncio', () => {
    expect(aplicarJanelaDeSilencio(new Date('2026-08-05T23:59:00Z')).toISOString()).toBe(
      '2026-08-05T23:59:00.000Z',
    )
  })

  it('empurra 21:00 em ponto para as 09:00 do dia seguinte', () => {
    // 21:00 de 05/08 em SP → 09:00 de 06/08 em SP = 12:00 UTC.
    expect(aplicarJanelaDeSilencio(new Date('2026-08-06T00:00:00Z')).toISOString()).toBe(
      '2026-08-06T12:00:00.000Z',
    )
  })

  it('empurra 22h de São Paulo para as 09:00 do dia seguinte', () => {
    expect(aplicarJanelaDeSilencio(new Date('2026-08-06T01:00:00Z')).toISOString()).toBe(
      '2026-08-06T12:00:00.000Z',
    )
  })

  it('empurra a meia-noite para as 09:00 do MESMO dia de calendário', () => {
    // 00:00 de 06/08 em SP. A madrugada já é o dia seguinte: adiar mais um dia
    // atrasaria o lembrete em 24 horas.
    expect(aplicarJanelaDeSilencio(new Date('2026-08-06T03:00:00Z')).toISOString()).toBe(
      '2026-08-06T12:00:00.000Z',
    )
  })

  it('empurra 03h de São Paulo para as 09:00 do mesmo dia', () => {
    expect(aplicarJanelaDeSilencio(new Date('2026-08-06T06:00:00Z')).toISOString()).toBe(
      '2026-08-06T12:00:00.000Z',
    )
  })

  it('empurra 07:59, o último minuto de silêncio, para as 09:00 do mesmo dia', () => {
    expect(aplicarJanelaDeSilencio(new Date('2026-08-06T10:59:00Z')).toISOString()).toBe(
      '2026-08-06T12:00:00.000Z',
    )
  })

  it('08h de São Paulo já está liberado', () => {
    expect(aplicarJanelaDeSilencio(new Date('2026-08-06T11:00:00Z')).toISOString()).toBe(
      '2026-08-06T11:00:00.000Z',
    )
  })

  it('atravessa a virada de mês', () => {
    // 21:30 de 31/08 em SP → 09:00 de 01/09.
    expect(aplicarJanelaDeSilencio(new Date('2026-09-01T00:30:00Z')).toISOString()).toBe(
      '2026-09-01T12:00:00.000Z',
    )
  })

  it('atravessa a virada de ano', () => {
    // 22:00 de 31/12/2026 em SP → 09:00 de 01/01/2027.
    expect(aplicarJanelaDeSilencio(new Date('2027-01-01T01:00:00Z')).toISOString()).toBe(
      '2027-01-01T12:00:00.000Z',
    )
  })

  it('zera os segundos e milissegundos do reagendamento', () => {
    const reagendado = aplicarJanelaDeSilencio(new Date('2026-08-06T01:23:45.678Z'))
    expect(reagendado.toISOString()).toBe('2026-08-06T12:00:00.000Z')
  })

  it('é idempotente: aplicar de novo não move mais nada', () => {
    const uma = aplicarJanelaDeSilencio(new Date('2026-08-06T01:00:00Z'))
    expect(aplicarJanelaDeSilencio(uma).toISOString()).toBe(uma.toISOString())
  })

  it('não modifica a Date recebida', () => {
    const momento = new Date('2026-08-06T01:00:00Z')
    aplicarJanelaDeSilencio(momento)
    expect(momento.toISOString()).toBe('2026-08-06T01:00:00.000Z')
  })

  describe('sob horário de verão (UTC-2, como em fevereiro de 2018)', () => {
    it('silencia às 21:30 locais, que um "-03 fixo" leria como 20:30', () => {
      // 2018-02-10T23:30Z = 21:30 em SP sob horário de verão.
      expect(aplicarJanelaDeSilencio(new Date('2018-02-10T23:30:00Z')).toISOString()).toBe(
        '2018-02-11T11:00:00.000Z', // 09:00 de 11/02 em SP, UTC-2.
      )
    })

    it('deixa passar 20:30 locais, que um "-03 fixo" leria como 19:30', () => {
      expect(aplicarJanelaDeSilencio(new Date('2018-02-10T22:30:00Z')).toISOString()).toBe(
        '2018-02-10T22:30:00.000Z',
      )
    })

    it('retoma às 09:00 locais depois da madrugada', () => {
      // 2018-02-11T07:00Z = 05:00 em SP.
      expect(aplicarJanelaDeSilencio(new Date('2018-02-11T07:00:00Z')).toISOString()).toBe(
        '2018-02-11T11:00:00.000Z',
      )
    })
  })
})
