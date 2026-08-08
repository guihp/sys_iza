import { describe, expect, it } from 'vitest'
import { instanteDaClinica } from '@/lib/datetime'
import {
  ALTURA_HORA_PX,
  FAIXAS,
  PASSO_MINUTOS,
  PRIMEIRA_HORA,
  ULTIMA_HORA,
  diasDaSemana,
  estiloDoBlocoNaGrade,
  inicioDaSemana,
  posicionarNaGrade,
  rotuloDoPeriodo,
} from '@/app/(app)/agenda/grade'

describe('inicioDaSemana', () => {
  it('devolve a própria data quando ela já é segunda', () => {
    expect(inicioDaSemana('2026-08-10')).toBe('2026-08-10')
  })

  it('recua até a segunda no meio da semana', () => {
    expect(inicioDaSemana('2026-08-13')).toBe('2026-08-10') // quinta
    expect(inicioDaSemana('2026-08-15')).toBe('2026-08-10') // sábado
  })

  it('trata domingo como fim da semana, não como começo', () => {
    // Domingo é o dia 7 da grade da clínica. Um cálculo ingênuo com getDay()
    // jogaria o domingo para a semana seguinte e a agenda pularia um dia.
    expect(inicioDaSemana('2026-08-16')).toBe('2026-08-10')
  })

  it('atravessa virada de mês e de ano', () => {
    expect(inicioDaSemana('2026-09-01')).toBe('2026-08-31') // terça
    expect(inicioDaSemana('2027-01-01')).toBe('2026-12-28') // sexta
  })
})

describe('diasDaSemana', () => {
  it('devolve segunda a domingo', () => {
    expect(diasDaSemana('2026-08-10')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ])
  })
})

describe('FAIXAS', () => {
  it('cobre o expediente em blocos de meia hora', () => {
    expect(PASSO_MINUTOS).toBe(30)
    expect(FAIXAS[0]).toBe(PRIMEIRA_HORA * 60)
    expect(FAIXAS.at(-1)).toBe(ULTIMA_HORA * 60 - PASSO_MINUTOS)
    expect(FAIXAS).toHaveLength(((ULTIMA_HORA - PRIMEIRA_HORA) * 60) / PASSO_MINUTOS)
  })
})

describe('posicionarNaGrade', () => {
  const DIA = '2026-08-10'
  const consulta = (hhmm: string, duracao: number) => {
    const [hora, minuto] = hhmm.split(':').map(Number)
    const inicio = instanteDaClinica(DIA, hora * 60 + minuto)
    return { inicio, fim: new Date(inicio.getTime() + duracao * 60_000) }
  }

  it('posiciona uma consulta de uma hora no meio da tarde', () => {
    // 14:00 é a 13ª faixa a partir das 08:00 (índice 12) e ocupa duas.
    expect(posicionarNaGrade(consulta('14:00', 60), DIA)).toEqual({
      linhaInicial: 12,
      linhas: 2,
      transbordou: false,
    })
  })

  it('posiciona a primeira faixa do dia', () => {
    expect(posicionarNaGrade(consulta('08:00', 30), DIA)).toEqual({
      linhaInicial: 0,
      linhas: 1,
      transbordou: false,
    })
  })

  it('arredonda para cima a duração que não fecha meia hora', () => {
    // 45 minutos ocupam visualmente duas faixas — o bloco não pode terminar no
    // meio de uma linha da grade.
    expect(posicionarNaGrade(consulta('08:00', 45), DIA)).toMatchObject({
      linhaInicial: 0,
      linhas: 2,
    })
  })

  it('encaixa começo fora do passo de meia hora na faixa que o contém', () => {
    expect(posicionarNaGrade(consulta('14:10', 30), DIA)).toMatchObject({ linhaInicial: 12 })
  })

  it('devolve null para consulta inteiramente antes da grade', () => {
    expect(posicionarNaGrade(consulta('06:00', 60), DIA)).toBeNull()
  })

  it('devolve null para consulta inteiramente depois da grade', () => {
    expect(posicionarNaGrade(consulta('20:00', 60), DIA)).toBeNull()
  })

  it('devolve null para consulta de outro dia', () => {
    // Mesma hora, dia seguinte: não pode aparecer na coluna de segunda.
    expect(posicionarNaGrade(consulta('14:00', 60), '2026-08-11')).toBeNull()
  })

  it('corta e sinaliza a consulta que passa do fim da grade', () => {
    const posicao = posicionarNaGrade(consulta('19:30', 60), DIA)
    expect(posicao).toEqual({ linhaInicial: 23, linhas: 1, transbordou: true })
  })

  it('corta e sinaliza a consulta que começa antes da grade', () => {
    const posicao = posicionarNaGrade(consulta('07:30', 60), DIA)
    expect(posicao).toEqual({ linhaInicial: 0, linhas: 1, transbordou: true })
  })

  it('usa o dia da clínica, não o dia UTC', () => {
    // 19:30 de segunda em São Paulo é 22:30Z da mesma segunda; nada de especial.
    // Já uma consulta às 22:00Z de segunda é 19:00 local de segunda — quem
    // usasse getUTCDate() acertaria aqui. O caso que separa: 2026-08-11T02:00Z
    // é 23:00 de SEGUNDA no relógio da clínica, e portanto fora da grade da
    // segunda por horário, não por dia.
    const inicio = new Date('2026-08-11T02:00:00Z')
    const fora = { inicio, fim: new Date(inicio.getTime() + 30 * 60_000) }
    expect(posicionarNaGrade(fora, '2026-08-10')).toBeNull()
    expect(posicionarNaGrade(fora, '2026-08-11')).toBeNull()
  })
})

describe('estiloDoBlocoNaGrade', () => {
  const DIA = '2026-08-10'
  const consulta = (hhmm: string, duracao: number) => {
    const [hora, minuto] = hhmm.split(':').map(Number)
    const inicio = instanteDaClinica(DIA, hora * 60 + minuto)
    return { inicio, fim: new Date(inicio.getTime() + duracao * 60_000) }
  }

  it('coloca 14:00 (6h após 08:00) a 6 × 88px do topo', () => {
    expect(estiloDoBlocoNaGrade(consulta('14:00', 60), DIA)).toEqual({
      topPx: 6 * ALTURA_HORA_PX,
      heightPx: ALTURA_HORA_PX - 6,
      transbordou: false,
    })
  })

  it('respeita o mínimo de 56px do mockup em consultas curtas', () => {
    expect(estiloDoBlocoNaGrade(consulta('09:00', 30), DIA)?.heightPx).toBe(56)
  })

  it('devolve null fora do dia', () => {
    expect(estiloDoBlocoNaGrade(consulta('14:00', 60), '2026-08-11')).toBeNull()
  })
})

describe('rotuloDoPeriodo', () => {
  it('resume a semana em uma linha', () => {
    expect(rotuloDoPeriodo('2026-08-10')).toBe('10 de agosto a 16 de agosto de 2026')
  })

  it('mostra os dois anos quando a semana vira o ano', () => {
    expect(rotuloDoPeriodo('2026-12-28')).toBe('28 de dezembro de 2026 a 3 de janeiro de 2027')
  })
})
