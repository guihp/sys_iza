import { describe, expect, it } from 'vitest'
import {
  CONTADORES_ZERADOS,
  formatarContador,
  itemAtivo,
  itensDeNavegacao,
  papelPorExtenso,
  type ContadoresDaCasca,
  type ItemDeNavegacao,
} from '@/components/navegacao'

const cheios: ContadoresDaCasca = {
  funil: 12,
  agendaHoje: 3,
  retornosVencidos: 4,
  mensagensAtivas: 7,
}

/**
 * Buscados por `href`, e não por posição: o menu ganha item com o tempo — a
 * Marketing entrou depois de Retornos — e um índice fixo faria estes testes
 * apontarem para outro item sem nem falhar.
 */
function item(href: string): ItemDeNavegacao {
  const encontrado = itensDeNavegacao('dra').find((candidato) => candidato.href === href)
  if (!encontrado) throw new Error(`item ${href} não está no menu da dra`)
  return encontrado
}

const funil = item('/crm')
const agenda = item('/agenda')
const google = item('/configuracoes/google')

describe('formatarContador', () => {
  it('devolve o número para o item que conta alguma coisa', () => {
    expect(formatarContador(funil, cheios)).toBe('12')
  })

  it('rotula o da agenda com "hoje", porque o número responde outra pergunta', () => {
    expect(formatarContador(agenda, cheios)).toBe('3 hoje')
  })

  it('omite o zero — banco vazio não pode encher a lateral de zeros', () => {
    expect(formatarContador(funil, CONTADORES_ZERADOS)).toBeNull()
    expect(formatarContador(agenda, CONTADORES_ZERADOS)).toBeNull()
  })

  it('não inventa contador para item que não tem', () => {
    expect(formatarContador(google, cheios)).toBeNull()
    // Marketing também não conta nada: o número que importaria ali é o gasto, e
    // gasto não cabe no formato de contagem do menu.
    expect(formatarContador(item('/marketing'), cheios)).toBeNull()
  })

  it('trata número inválido como ausência, em vez de escrever NaN na tela', () => {
    const quebrado = { ...cheios, funil: Number.NaN }
    expect(formatarContador(funil, quebrado)).toBeNull()
  })
})

describe('itemAtivo', () => {
  const procedimentos: ItemDeNavegacao = {
    href: '/configuracoes/procedimentos',
    rotulo: 'Procedimentos',
  }

  it('acende no caminho exato', () => {
    expect(itemAtivo(funil, '/crm')).toBe(true)
  })

  it('acende numa subrota', () => {
    expect(itemAtivo(procedimentos, '/configuracoes/procedimentos/abc')).toBe(true)
  })

  it('não acende por prefixo de texto solto', () => {
    expect(itemAtivo(funil, '/crmx')).toBe(false)
  })

  it('não acende sem caminho — fora do router não há item aceso', () => {
    expect(itemAtivo(funil, null)).toBe(false)
  })
})

describe('papelPorExtenso', () => {
  it('traduz os dois papéis, com acento', () => {
    expect(papelPorExtenso('dra')).toBe('Doutora')
    expect(papelPorExtenso('secretaria')).toBe('Secretária')
  })
})
