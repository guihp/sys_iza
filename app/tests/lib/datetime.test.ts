import { describe, expect, it } from 'vitest'
import {
  FUSO_CLINICA,
  dataDaClinica,
  deslocarData,
  diaDaSemanaDaData,
  formatarDataExtensa,
  horaDaClinica,
  instanteDaClinica,
  minutosDoDiaNaClinica,
  offsetDaClinicaEmMinutos,
  paredeDaClinica,
} from '@/lib/datetime'

describe('FUSO_CLINICA', () => {
  it('é America/Sao_Paulo', () => {
    // Nenhuma regra de negócio pode depender do fuso do servidor: o container
    // roda em UTC e a clínica atende em Brasília.
    expect(FUSO_CLINICA).toBe('America/Sao_Paulo')
  })
})

describe('paredeDaClinica', () => {
  it('converte um instante UTC para o relógio de parede da clínica', () => {
    const parede = paredeDaClinica(new Date('2026-08-10T14:00:00Z'))
    expect(parede).toMatchObject({ ano: 2026, mes: 8, dia: 10, hora: 11, minuto: 0 })
  })

  it('devolve o dia da semana com domingo em zero', () => {
    // 2026-08-10 é uma segunda-feira.
    expect(paredeDaClinica(new Date('2026-08-10T14:00:00Z')).diaDaSemana).toBe(1)
    // 2026-08-09, domingo.
    expect(paredeDaClinica(new Date('2026-08-09T14:00:00Z')).diaDaSemana).toBe(0)
  })

  it('recua o dia quando o instante UTC já virou mas a clínica não', () => {
    // 02:00Z de terça ainda é 23:00 de segunda em São Paulo. Uma implementação
    // que use o dia UTC coloca essa consulta na coluna errada da agenda.
    const parede = paredeDaClinica(new Date('2026-08-11T02:00:00Z'))
    expect(parede).toMatchObject({ ano: 2026, mes: 8, dia: 10, hora: 23, diaDaSemana: 1 })
  })
})

describe('offsetDaClinicaEmMinutos', () => {
  it('é -180 no inverno', () => {
    expect(offsetDaClinicaEmMinutos(new Date('2026-08-10T14:00:00Z'))).toBe(-180)
  })

  it('é -180 também em janeiro — o Brasil não tem mais horário de verão', () => {
    // Desde 2019 não há DST no Brasil. O teste existe para flagrar o dia em que
    // isso mudar por decreto: a suíte quebra e a regra é revisada de propósito.
    expect(offsetDaClinicaEmMinutos(new Date('2026-01-15T14:00:00Z'))).toBe(-180)
  })

  it('é -120 dentro do horário de verão histórico', () => {
    // 2018-11-04, madrugada: o relógio pulou de 00:00 para 01:00 e o offset
    // virou -02. Se o cálculo fosse um "-3 fixo" na mão, este caso mentiria.
    expect(offsetDaClinicaEmMinutos(new Date('2018-11-04T05:00:00Z'))).toBe(-120)
    // Poucas horas antes da virada ainda é -03.
    expect(offsetDaClinicaEmMinutos(new Date('2018-11-03T15:00:00Z'))).toBe(-180)
  })

  it('volta a -180 quando o horário de verão termina', () => {
    // 2019-02-17 é o último domingo do horário de verão brasileiro.
    expect(offsetDaClinicaEmMinutos(new Date('2019-02-16T15:00:00Z'))).toBe(-120)
    expect(offsetDaClinicaEmMinutos(new Date('2019-02-17T15:00:00Z'))).toBe(-180)
  })
})

describe('dataDaClinica e horaDaClinica', () => {
  it('formata a data no calendário da clínica', () => {
    expect(dataDaClinica(new Date('2026-08-10T14:00:00Z'))).toBe('2026-08-10')
    expect(dataDaClinica(new Date('2026-08-11T02:00:00Z'))).toBe('2026-08-10')
  })

  it('formata a hora com dois dígitos', () => {
    expect(horaDaClinica(new Date('2026-08-10T12:05:00Z'))).toBe('09:05')
    expect(horaDaClinica(new Date('2026-08-10T14:00:00Z'))).toBe('11:00')
  })
})

describe('minutosDoDiaNaClinica', () => {
  it('conta os minutos desde a meia-noite local', () => {
    expect(minutosDoDiaNaClinica(new Date('2026-08-10T11:00:00Z'))).toBe(8 * 60)
    expect(minutosDoDiaNaClinica(new Date('2026-08-10T14:30:00Z'))).toBe(11 * 60 + 30)
  })

  it('não usa a hora UTC', () => {
    // 03:00Z é meia-noite em São Paulo — zero, não 180.
    expect(minutosDoDiaNaClinica(new Date('2026-08-10T03:00:00Z'))).toBe(0)
  })
})

describe('instanteDaClinica', () => {
  it('transforma data e hora locais em instante UTC', () => {
    expect(instanteDaClinica('2026-08-10', 14 * 60).toISOString()).toBe('2026-08-10T17:00:00.000Z')
    expect(instanteDaClinica('2026-08-10', 8 * 60 + 30).toISOString()).toBe(
      '2026-08-10T11:30:00.000Z',
    )
  })

  it('usa o offset vigente naquela data, não o de hoje', () => {
    // 2018-11-05 estava em horário de verão (-02): 09:00 local é 11:00Z, e não
    // 12:00Z como seria com o -03 de hoje.
    expect(instanteDaClinica('2018-11-05', 9 * 60).toISOString()).toBe('2018-11-05T11:00:00.000Z')
    // Uma semana antes, ainda em -03.
    expect(instanteDaClinica('2018-10-29', 9 * 60).toISOString()).toBe('2018-10-29T12:00:00.000Z')
  })

  it('fecha o ciclo de ida e volta em datas de verão e de inverno', () => {
    for (const data of ['2026-01-15', '2026-08-10', '2018-11-05', '2019-02-20']) {
      for (const minutos of [0, 8 * 60, 12 * 60 + 45, 19 * 60 + 30, 23 * 60 + 59]) {
        const instante = instanteDaClinica(data, minutos)
        expect(dataDaClinica(instante), `${data} ${minutos}`).toBe(data)
        expect(minutosDoDiaNaClinica(instante), `${data} ${minutos}`).toBe(minutos)
      }
    }
  })

  it('não estoura em horário local que nunca existiu', () => {
    // 2018-11-04: o relógio pulou de 00:00 direto para 01:00, então 00:30 não
    // aconteceu. O resultado precisa ser determinístico e ser um instante real —
    // o que ele não pode é ser NaN nem lançar exceção no meio de um agendamento.
    const instante = instanteDaClinica('2018-11-04', 30)
    expect(Number.isNaN(instante.getTime())).toBe(false)
    expect(instanteDaClinica('2018-11-04', 30).toISOString()).toBe(instante.toISOString())
  })
})

describe('deslocarData', () => {
  it('anda dias no calendário', () => {
    expect(deslocarData('2026-08-10', 1)).toBe('2026-08-11')
    expect(deslocarData('2026-08-10', -3)).toBe('2026-08-07')
    expect(deslocarData('2026-08-10', 7)).toBe('2026-08-17')
  })

  it('atravessa virada de mês e de ano', () => {
    expect(deslocarData('2026-08-31', 1)).toBe('2026-09-01')
    expect(deslocarData('2026-12-31', 1)).toBe('2027-01-01')
    expect(deslocarData('2026-03-01', -1)).toBe('2026-02-28')
    expect(deslocarData('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('não desloca nada com zero', () => {
    expect(deslocarData('2026-08-10', 0)).toBe('2026-08-10')
  })
})

describe('diaDaSemanaDaData', () => {
  it('lê o dia da semana de uma data ISO', () => {
    expect(diaDaSemanaDaData('2026-08-10')).toBe(1) // segunda
    expect(diaDaSemanaDaData('2026-08-15')).toBe(6) // sábado
    expect(diaDaSemanaDaData('2026-08-16')).toBe(0) // domingo
  })
})

describe('formatarDataExtensa', () => {
  it('escreve a data em português', () => {
    expect(formatarDataExtensa('2026-08-10')).toBe('10 de agosto')
  })
})
