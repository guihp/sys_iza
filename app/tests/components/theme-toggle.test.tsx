import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from '@/components/theme-toggle'
import { SCRIPT_TEMA_INICIAL } from '@/lib/tema'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-tema')
})

describe('ThemeToggle', () => {
  it('aplica o tema escuro no primeiro clique', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /tema/i }))
    expect(document.documentElement.dataset.tema).toBe('escuro')
  })

  it('volta ao claro no segundo clique e persiste a escolha', () => {
    render(<ThemeToggle />)
    const botao = screen.getByRole('button', { name: /tema/i })
    fireEvent.click(botao)
    fireEvent.click(botao)
    expect(document.documentElement.dataset.tema).toBe('claro')
    expect(localStorage.getItem('tema')).toBe('claro')
  })

  it('não força tema nenhum quando o usuário ainda não escolheu', () => {
    render(<ThemeToggle />)
    // Sem escolha salva, quem manda é o `prefers-color-scheme` do CSS —
    // marcar `data-tema` na montagem sequestraria a preferência do sistema.
    expect(document.documentElement.hasAttribute('data-tema')).toBe(false)
  })

  it('rotula o botão a partir do tema já aplicado na página', () => {
    document.documentElement.dataset.tema = 'escuro'
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /tema/i }).textContent).toBe('Claro')
  })

  it('rotula o botão a partir da escolha salva', () => {
    localStorage.setItem('tema', 'escuro')
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /tema/i }).textContent).toBe('Claro')
  })
})

describe('SCRIPT_TEMA_INICIAL', () => {
  const executar = () => new Function(SCRIPT_TEMA_INICIAL)()

  it('reaplica a escolha salva antes da hidratação', () => {
    localStorage.setItem('tema', 'escuro')
    executar()
    expect(document.documentElement.dataset.tema).toBe('escuro')
  })

  it('não marca nada quando não há escolha salva', () => {
    executar()
    expect(document.documentElement.hasAttribute('data-tema')).toBe(false)
  })

  it('ignora valor inválido no localStorage', () => {
    localStorage.setItem('tema', 'roxo')
    executar()
    expect(document.documentElement.hasAttribute('data-tema')).toBe(false)
  })
})
