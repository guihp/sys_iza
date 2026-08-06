import { describe, expect, it } from 'vitest'
import { renderizarTemplate, variaveisDoTemplate } from '@/domain/reminders/template'

describe('renderizarTemplate', () => {
  it('substitui variáveis pelo valor', () => {
    const texto = renderizarTemplate('Olá {{nome}}, sua consulta é {{data}} às {{hora}}.', {
      nome: 'Maria',
      data: '20/08',
      hora: '14:00',
    })
    expect(texto).toBe('Olá Maria, sua consulta é 20/08 às 14:00.')
  })

  it('substitui a mesma variável em todas as ocorrências', () => {
    expect(renderizarTemplate('{{nome}} e {{nome}}', { nome: 'Ana' })).toBe('Ana e Ana')
  })

  it('deixa em branco a variável não fornecida em vez de imprimir a chave', () => {
    expect(renderizarTemplate('Olá {{nome}}{{sobrenome}}!', { nome: 'Ana' })).toBe('Olá Ana!')
  })

  it('tolera espaços dentro das chaves', () => {
    expect(renderizarTemplate('Olá {{ nome }}', { nome: 'Ana' })).toBe('Olá Ana')
  })

  it('não mexe em texto sem variável nenhuma', () => {
    expect(renderizarTemplate('Bom dia!', { nome: 'Ana' })).toBe('Bom dia!')
  })

  it('não reinterpreta o valor substituído como template', () => {
    // Valor vindo do cadastro não pode virar chave: senão um paciente chamado
    // "{{telefone}}" leria o telefone de outra variável na própria mensagem.
    expect(renderizarTemplate('Olá {{nome}}', { nome: '{{hora}}', hora: '14:00' })).toBe(
      'Olá {{hora}}',
    )
  })

  it('preserva cifrões e barras invertidas do valor', () => {
    // `$&` e `$1` têm significado especial em String.replace com string de
    // substituição; a implementação usa função justamente para evitar isso.
    expect(renderizarTemplate('Valor: {{v}}', { v: 'R$ 1.000 (50% $& $1)' })).toBe(
      'Valor: R$ 1.000 (50% $& $1)',
    )
  })

  it('ignora chave com hífen ou espaço no meio, que não é variável', () => {
    expect(renderizarTemplate('{{ nome completo }}', { nome: 'Ana' })).toBe('{{ nome completo }}')
  })
})

describe('variaveisDoTemplate', () => {
  it('lista as variáveis usadas, sem repetir', () => {
    expect(variaveisDoTemplate('{{nome}}, {{data}} e {{ nome }}')).toEqual(['nome', 'data'])
  })

  it('devolve lista vazia para texto sem variável', () => {
    expect(variaveisDoTemplate('Bom dia!')).toEqual([])
  })
})
