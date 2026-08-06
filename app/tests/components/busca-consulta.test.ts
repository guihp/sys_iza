import { describe, expect, it } from 'vitest'
import {
  interpretarBusca,
  mesclarPacientes,
  TETO_POR_GRUPO,
  type PacienteEncontrado,
} from '@/components/busca/consulta'

describe('interpretarBusca', () => {
  it('não busca com termo curto demais', () => {
    expect(interpretarBusca('')).toBeNull()
    expect(interpretarBusca('   ')).toBeNull()
    expect(interpretarBusca('a')).toBeNull()
  })

  it('monta o padrão de nome com o termo aparado', () => {
    const alvo = interpretarBusca('  Maria  ')
    expect(alvo?.termo).toBe('Maria')
    expect(alvo?.padraoNome).toBe('%Maria%')
  })

  it('escapa os curingas do like', () => {
    // Sem escapar, "%" digitado sozinho traria o cadastro inteiro.
    expect(interpretarBusca('100%')?.padraoNome).toBe('%100\\%%')
    expect(interpretarBusca('a_b')?.padraoNome).toBe('%a\\_b%')
    expect(interpretarBusca('a\\b')?.padraoNome).toBe('%a\\\\b%')
  })

  it('acha o telefone gravado em E.164 a partir do que a secretária digita', () => {
    // O cadastro guarda "+5511987654321"; o papel na mesa diz "(11) 98765-4321".
    expect(interpretarBusca('(11) 98765-4321')?.padraoTelefone).toBe('%5511987654321%')
    expect(interpretarBusca('11987654321')?.padraoTelefone).toBe('%5511987654321%')
    expect(interpretarBusca('+55 11 98765-4321')?.padraoTelefone).toBe('%5511987654321%')
  })

  it('aceita pedaço de número, porque quem liga lembra do final', () => {
    expect(interpretarBusca('98765')?.padraoTelefone).toBe('%98765%')
  })

  it('não trata texto como telefone quando quase não há dígitos', () => {
    expect(interpretarBusca('Maria')?.padraoTelefone).toBeNull()
    expect(interpretarBusca('a1')?.padraoTelefone).toBeNull()
  })
})

function paciente(id: string, nome: string): PacienteEncontrado {
  return { id, nome, telefone: null }
}

describe('mesclarPacientes', () => {
  it('junta os dois lados preservando a ordem de quem casou por nome', () => {
    const juntos = mesclarPacientes(
      [paciente('1', 'Ana'), paciente('2', 'Bia')],
      [paciente('3', 'Célia')],
    )
    expect(juntos.map((p) => p.id)).toEqual(['1', '2', '3'])
  })

  it('não repete quem casou por nome e por telefone ao mesmo tempo', () => {
    const juntos = mesclarPacientes([paciente('1', 'Ana')], [paciente('1', 'Ana')])
    expect(juntos).toHaveLength(1)
  })

  it('corta no teto do grupo', () => {
    const muitos = Array.from({ length: 20 }, (_, i) => paciente(String(i), `Paciente ${i}`))
    expect(mesclarPacientes(muitos)).toHaveLength(TETO_POR_GRUPO)
  })

  it('devolve lista vazia com banco vazio', () => {
    expect(mesclarPacientes([], [])).toEqual([])
  })
})
