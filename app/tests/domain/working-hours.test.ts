import { describe, expect, it } from 'vitest'
import { instanteDaClinica } from '@/lib/datetime'
import {
  HORARIO_PADRAO,
  clinicaAbreEm,
  dentroDoHorarioDeAtendimento,
  faixasDoDia,
  minutosDeHHMM,
  validarHorarioDeAtendimento,
  type HorarioDeAtendimento,
} from '@/domain/scheduling/working-hours'

/** Consulta no relógio da clínica: data, hora de início e duração em minutos. */
const consulta = (dataISO: string, hhmm: string, duracao: number) => {
  const inicio = instanteDaClinica(dataISO, minutosDeHHMM(hhmm))
  return { inicio, fim: new Date(inicio.getTime() + duracao * 60_000) }
}

// 2026-08-10 é segunda; 15 é sábado; 16 é domingo.
const SEGUNDA = '2026-08-10'
const SABADO = '2026-08-15'
const DOMINGO = '2026-08-16'

describe('minutosDeHHMM', () => {
  it('converte hora de parede em minutos do dia', () => {
    expect(minutosDeHHMM('00:00')).toBe(0)
    expect(minutosDeHHMM('08:30')).toBe(510)
    expect(minutosDeHHMM('20:00')).toBe(1200)
  })
})

describe('faixasDoDia', () => {
  it('devolve as faixas do dia da semana daquela data', () => {
    expect(faixasDoDia(SEGUNDA)).toEqual(HORARIO_PADRAO[1])
    expect(faixasDoDia(SABADO)).toEqual(HORARIO_PADRAO[6])
  })

  it('devolve lista vazia no dia fechado', () => {
    expect(faixasDoDia(DOMINGO)).toEqual([])
  })
})

describe('clinicaAbreEm', () => {
  it('abre de segunda a sábado e fecha no domingo', () => {
    expect(clinicaAbreEm(SEGUNDA)).toBe(true)
    expect(clinicaAbreEm(SABADO)).toBe(true)
    expect(clinicaAbreEm(DOMINGO)).toBe(false)
  })
})

describe('dentroDoHorarioDeAtendimento', () => {
  it('aceita consulta no meio do expediente', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '14:00', 60))).toBe(true)
  })

  it('aceita consulta que começa exatamente na abertura', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '08:00', 60))).toBe(true)
  })

  it('aceita consulta que termina exatamente no fechamento', () => {
    // Faixa semiaberta [abre, fecha]: terminar às 20:00 em ponto é o expediente
    // cumprido, não uma hora extra.
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '19:00', 60))).toBe(true)
  })

  it('recusa consulta que começa antes da abertura', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '07:30', 60))).toBe(false)
  })

  it('recusa consulta que passa um minuto do fechamento', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '19:00', 61))).toBe(false)
  })

  it('recusa consulta em dia fechado', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(DOMINGO, '14:00', 60))).toBe(false)
  })

  it('respeita o expediente mais curto do sábado', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(SABADO, '11:00', 60))).toBe(true)
    // Sábado fecha às 13:00: começar 12:30 com uma hora de procedimento estoura.
    expect(dentroDoHorarioDeAtendimento(consulta(SABADO, '12:30', 60))).toBe(false)
  })

  it('recusa consulta que atravessa a meia-noite', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '23:30', 60))).toBe(false)
  })

  it('recusa consulta de duração zero ou negativa', () => {
    const inicio = instanteDaClinica(SEGUNDA, minutosDeHHMM('14:00'))
    expect(dentroDoHorarioDeAtendimento({ inicio, fim: inicio })).toBe(false)
    expect(
      dentroDoHorarioDeAtendimento({ inicio, fim: new Date(inicio.getTime() - 60_000) }),
    ).toBe(false)
  })

  it('julga pelo relógio de São Paulo, não pelo UTC', () => {
    // 2026-08-10T11:00:00Z é 08:00 em São Paulo: dentro do expediente. Quem
    // olhar a hora UTC (11:00) também diria que sim, e por acaso acertaria.
    // Já 2026-08-10T22:30:00Z é 19:30 local — dentro —, mas 22:30 em UTC seria
    // recusado. É este caso que separa as duas leituras.
    const inicio = new Date('2026-08-10T22:30:00Z')
    expect(
      dentroDoHorarioDeAtendimento({ inicio, fim: new Date(inicio.getTime() + 30 * 60_000) }),
    ).toBe(true)
  })

  it('acompanha o horário de verão histórico', () => {
    // 2018-11-05 é segunda, já em horário de verão (-02). 09:00 no relógio da
    // clínica é 11:00Z. Uma conta com -03 fixo leria isso como 08:00 e também
    // aprovaria; por isso o caso decisivo é o da borda logo abaixo.
    expect(dentroDoHorarioDeAtendimento(consulta('2018-11-05', '09:00', 60))).toBe(true)
    // 07:30 local em horário de verão é 09:30Z. Com -03 fixo, 09:30Z viraria
    // 06:30 — ainda recusado — mas 20:30 local (22:30Z) viraria 19:30 e passaria.
    expect(dentroDoHorarioDeAtendimento(consulta('2018-11-05', '20:30', 30))).toBe(false)
    expect(dentroDoHorarioDeAtendimento(consulta('2018-11-05', '07:30', 30))).toBe(false)
  })
})

describe('validarHorarioDeAtendimento', () => {
  it('aprova sem motivo quando está tudo certo', () => {
    expect(validarHorarioDeAtendimento(consulta(SEGUNDA, '14:00', 60))).toEqual({ ok: true })
  })

  it('explica em português que o dia é fechado', () => {
    const resultado = validarHorarioDeAtendimento(consulta(DOMINGO, '14:00', 60))
    expect(resultado.ok).toBe(false)
    expect(resultado.ok === false && resultado.motivo).toMatch(/não atende/i)
    expect(resultado.ok === false && resultado.motivo).toMatch(/domingo/i)
  })

  it('explica em português qual é o expediente do dia', () => {
    const resultado = validarHorarioDeAtendimento(consulta(SABADO, '12:30', 60))
    expect(resultado.ok).toBe(false)
    // A mensagem precisa dizer o horário do sábado, e não o de segunda.
    expect(resultado.ok === false && resultado.motivo).toContain('08:00')
    expect(resultado.ok === false && resultado.motivo).toContain('13:00')
  })

  it('explica que a consulta não pode virar o dia', () => {
    const resultado = validarHorarioDeAtendimento(consulta(SEGUNDA, '23:30', 60))
    expect(resultado.ok).toBe(false)
    expect(resultado.ok === false && resultado.motivo).toMatch(/mesmo dia/i)
  })
})

describe('horário de atendimento personalizado', () => {
  // Expediente com intervalo de almoço, para provar que a regra não assume uma
  // faixa contínua por dia.
  const comAlmoco: HorarioDeAtendimento = [
    [],
    [
      { de: '09:00', ate: '12:00' },
      { de: '14:00', ate: '18:00' },
    ],
    [],
    [],
    [],
    [],
    [],
  ]

  it('aceita consulta dentro de qualquer uma das faixas', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '10:00', 60), comAlmoco)).toBe(true)
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '15:00', 60), comAlmoco)).toBe(true)
  })

  it('recusa consulta dentro do intervalo de almoço', () => {
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '12:30', 60), comAlmoco)).toBe(false)
  })

  it('recusa consulta que começa antes do almoço e termina depois', () => {
    // Cabe entre a abertura e o fechamento, mas não cabe em faixa nenhuma —
    // atravessar o intervalo é o caso que uma checagem de "min/max do dia"
    // deixaria passar.
    expect(dentroDoHorarioDeAtendimento(consulta(SEGUNDA, '11:30', 180), comAlmoco)).toBe(false)
  })

  it('lista as duas faixas na mensagem de erro', () => {
    const resultado = validarHorarioDeAtendimento(consulta(SEGUNDA, '12:30', 60), comAlmoco)
    expect(resultado.ok === false && resultado.motivo).toContain('09:00 às 12:00')
    expect(resultado.ok === false && resultado.motivo).toContain('14:00 às 18:00')
  })
})
