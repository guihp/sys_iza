import { describe, expect, it } from 'vitest'
import {
  JANELA_VENCENDO_DIAS,
  calcularRetorno,
  diasAteRetorno,
  statusRetorno,
} from '@/domain/returns/compute-return'

const realizadoEm = new Date('2026-08-05T12:00:00Z')

/** `2026-12-03` a partir de um instante, para ler a asserção sem ruído. */
function dia(instante: Date | null): string | null {
  return instante ? instante.toISOString().slice(0, 10) : null
}

describe('calcularRetorno — nível 1: padrão do catálogo', () => {
  it('usa o intervalo padrão do procedimento', () => {
    expect(dia(calcularRetorno({ realizadoEm, padraoDias: 120 }))).toBe('2026-12-03')
  })

  it('procedimento sem retorno padrão e sem ajuste não gera retorno', () => {
    expect(calcularRetorno({ realizadoEm, padraoDias: null })).toBeNull()
  })

  it('a conta é sobre a data do atendimento, não sobre hoje', () => {
    const antigo = new Date('2025-01-31T12:00:00Z')
    expect(dia(calcularRetorno({ realizadoEm: antigo, padraoDias: 30 }))).toBe('2025-03-02')
  })
})

describe('calcularRetorno — nível 2: ajuste no registro do atendimento', () => {
  it('2a: ajuste em dias vence o padrão', () => {
    expect(dia(calcularRetorno({ realizadoEm, padraoDias: 120, ajusteDias: 90 }))).toBe('2026-11-03')
  })

  it('2a: ajuste em dias funciona mesmo sem padrão no catálogo', () => {
    // O procedimento não gera retorno sozinho, mas a Dra. pediu um para esta
    // paciente. O nível 2 não depende do nível 1 existir.
    expect(dia(calcularRetorno({ realizadoEm, padraoDias: null, ajusteDias: 90 }))).toBe(
      '2026-11-03',
    )
  })

  it('2b: data explícita vence o ajuste em dias e o padrão', () => {
    const r = calcularRetorno({
      realizadoEm,
      padraoDias: 120,
      ajusteDias: 90,
      ajusteData: new Date('2027-01-15T12:00:00Z'),
    })
    expect(dia(r)).toBe('2027-01-15')
  })

  it('2b: data explícita vence sozinha, sem padrão nem ajuste em dias', () => {
    const r = calcularRetorno({
      realizadoEm,
      padraoDias: null,
      ajusteData: new Date('2027-01-15T12:00:00Z'),
    })
    expect(dia(r)).toBe('2027-01-15')
  })

  it('2b: data explícita no passado é respeitada — quem decide é a Dra.', () => {
    // Registro atrasado de um atendimento antigo. Cabe à fila de retornos
    // mostrar isso como vencido, não a este cálculo recusar a data.
    const r = calcularRetorno({
      realizadoEm,
      padraoDias: 120,
      ajusteData: new Date('2026-07-01T12:00:00Z'),
    })
    expect(dia(r)).toBe('2026-07-01')
  })
})

describe('calcularRetorno — nível 3: sem retorno', () => {
  it('vence inclusive a data explícita', () => {
    const r = calcularRetorno({
      realizadoEm,
      padraoDias: 120,
      ajusteData: new Date('2027-01-15T12:00:00Z'),
      semRetorno: true,
    })
    expect(r).toBeNull()
  })

  it('vence o ajuste em dias', () => {
    expect(calcularRetorno({ realizadoEm, padraoDias: 120, ajusteDias: 30, semRetorno: true }))
      .toBeNull()
  })

  it('vence o padrão do catálogo', () => {
    expect(calcularRetorno({ realizadoEm, padraoDias: 120, semRetorno: true })).toBeNull()
  })
})

describe('calcularRetorno — campo em branco não é ajuste', () => {
  // Distinção que decide o comportamento do formulário: apagar o campo devolve
  // a decisão ao nível de baixo, não zera o retorno.

  it('ajusteDias nulo cai para o padrão do catálogo', () => {
    expect(dia(calcularRetorno({ realizadoEm, padraoDias: 120, ajusteDias: null }))).toBe(
      '2026-12-03',
    )
  })

  it('ajusteDias indefinido cai para o padrão do catálogo', () => {
    expect(dia(calcularRetorno({ realizadoEm, padraoDias: 120, ajusteDias: undefined }))).toBe(
      '2026-12-03',
    )
  })

  it('ajusteData nula cai para o ajuste em dias', () => {
    const r = calcularRetorno({ realizadoEm, padraoDias: 120, ajusteDias: 90, ajusteData: null })
    expect(dia(r)).toBe('2026-11-03')
  })

  it('semRetorno falso não interfere em nada', () => {
    const r = calcularRetorno({ realizadoEm, padraoDias: 120, semRetorno: false })
    expect(dia(r)).toBe('2026-12-03')
  })
})

describe('diasAteRetorno', () => {
  const hoje = new Date('2026-08-05T12:00:00Z')

  it('conta os dias que faltam', () => {
    expect(diasAteRetorno(new Date('2026-08-15T12:00:00Z'), hoje)).toBe(10)
  })

  it('vencimento de hoje é zero', () => {
    expect(diasAteRetorno(hoje, hoje)).toBe(0)
  })

  it('vencimento passado é negativo', () => {
    expect(diasAteRetorno(new Date('2026-08-01T12:00:00Z'), hoje)).toBe(-4)
  })
})

describe('statusRetorno', () => {
  const hoje = new Date('2026-08-05T12:00:00Z')

  it('sem vencimento é sem_retorno', () => {
    expect(statusRetorno(null, hoje)).toBe('sem_retorno')
  })

  it('faltando 60 dias está em dia', () => {
    expect(statusRetorno(new Date('2026-10-04T12:00:00Z'), hoje)).toBe('em_dia')
  })

  it('faltando 30 dias já está vencendo', () => {
    expect(statusRetorno(new Date('2026-09-04T12:00:00Z'), hoje)).toBe('vencendo')
  })

  it('faltando 1 dia está vencendo', () => {
    expect(statusRetorno(new Date('2026-08-06T12:00:00Z'), hoje)).toBe('vencendo')
  })

  it('data passada está vencido', () => {
    expect(statusRetorno(new Date('2026-08-01T12:00:00Z'), hoje)).toBe('vencido')
  })

  it('vence hoje ainda é vencendo, não vencido', () => {
    // O dia do vencimento é o último dia em que dá para ligar sem pedir
    // desculpa. Tratá-lo como atraso encheria a fila de falso vermelho.
    expect(statusRetorno(hoje, hoje)).toBe('vencendo')
  })

  it('a janela de vencendo tem exatamente JANELA_VENCENDO_DIAS dias', () => {
    const DIA = 86_400_000
    const naBorda = new Date(hoje.getTime() + JANELA_VENCENDO_DIAS * DIA)
    const logoDepois = new Date(hoje.getTime() + (JANELA_VENCENDO_DIAS + 1) * DIA)
    expect(statusRetorno(naBorda, hoje)).toBe('vencendo')
    expect(statusRetorno(logoDepois, hoje)).toBe('em_dia')
  })
})
