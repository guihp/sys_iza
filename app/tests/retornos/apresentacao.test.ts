import { describe, expect, it } from 'vitest'
import {
  descreverCiclo,
  filtrarFila,
  filtroDaUrl,
  linkWhatsApp,
  textoDoRetorno,
  tratamentoParaMensagem,
} from '@/app/(app)/retornos/apresentacao'
import type { LinhaDaFila } from '@/app/(app)/retornos/fila'

function linha(parcial: Partial<LinhaDaFila> & Pick<LinhaDaFila, 'status'>): LinhaDaFila {
  return {
    atendimentoId: 'at-1',
    pacienteId: 'p1',
    paciente: 'Ana Souza',
    apelido: null,
    telefone: '+5511982779034',
    procedimento: 'Toxina botulínica',
    intervaloRetornoDias: 120,
    realizadoEm: '2026-04-05T13:00:00.000Z',
    vencimento: '2026-08-01',
    diasRestantes: -4,
    ...parcial,
  }
}

describe('descreverCiclo', () => {
  it('fala em dias abaixo de 60', () => {
    expect(descreverCiclo(1)).toBe('ciclo de 1 dia')
    expect(descreverCiclo(45)).toBe('ciclo de 45 dias')
    expect(descreverCiclo(59)).toBe('ciclo de 59 dias')
  })

  it('arredonda em meses a partir de 60 dias', () => {
    expect(descreverCiclo(60)).toBe('ciclo de 2 meses')
    expect(descreverCiclo(120)).toBe('ciclo de 4 meses')
    expect(descreverCiclo(150)).toBe('ciclo de 5 meses')
    expect(descreverCiclo(30)).toBe('ciclo de 30 dias')
  })

  it('sem intervalo no catálogo não inventa ciclo', () => {
    expect(descreverCiclo(null)).toBeNull()
    expect(descreverCiclo(0)).toBeNull()
  })
})

describe('textoDoRetorno', () => {
  it('vencido usa "em atraso", não "vencido há"', () => {
    expect(textoDoRetorno(-58)).toBe('58 dias em atraso')
    expect(textoDoRetorno(-1)).toBe('1 dia em atraso')
  })

  it('a vencer e hoje', () => {
    expect(textoDoRetorno(12)).toBe('vence em 12 dias')
    expect(textoDoRetorno(1)).toBe('vence em 1 dia')
    expect(textoDoRetorno(0)).toBe('vence hoje')
  })
})

describe('filtroDaUrl', () => {
  it('aceita os três valores do mockup', () => {
    expect(filtroDaUrl('vencidos')).toBe('vencidos')
    expect(filtroDaUrl('a_vencer')).toBe('a_vencer')
    expect(filtroDaUrl('todos')).toBe('todos')
  })

  it('valor inválido ou ausente vira todos', () => {
    expect(filtroDaUrl(undefined)).toBe('todos')
    expect(filtroDaUrl('xyz')).toBe('todos')
    expect(filtroDaUrl(['vencidos', 'todos'])).toBe('vencidos')
  })
})

describe('filtrarFila', () => {
  const fila = [
    linha({ status: 'vencido', atendimentoId: 'a', pacienteId: 'p1' }),
    linha({ status: 'vencendo', atendimentoId: 'b', pacienteId: 'p2', diasRestantes: 5 }),
  ]

  it('separa vencidos, a vencer e todos', () => {
    expect(filtrarFila(fila, 'vencidos')).toHaveLength(1)
    expect(filtrarFila(fila, 'a_vencer')).toHaveLength(1)
    expect(filtrarFila(fila, 'todos')).toHaveLength(2)
  })
})

describe('linkWhatsApp', () => {
  it('tira o + do E.164 e pré-preenche o texto', () => {
    expect(linkWhatsApp('+5511982779034', 'Oi, Ana!')).toBe(
      'https://wa.me/5511982779034?text=Oi%2C%20Ana!',
    )
  })

  it('sem texto devolve só o número', () => {
    expect(linkWhatsApp('+5511982779034', '')).toBe('https://wa.me/5511982779034')
  })
})

describe('tratamentoParaMensagem', () => {
  it('prefere o apelido e cai no primeiro nome', () => {
    expect(tratamentoParaMensagem('Ana Souza', 'Aninha')).toBe('Aninha')
    expect(tratamentoParaMensagem('Ana Souza', null)).toBe('Ana')
    expect(tratamentoParaMensagem('Ana Souza', '  ')).toBe('Ana')
  })
})
