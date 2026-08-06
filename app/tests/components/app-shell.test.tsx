import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell, itensDeNavegacao } from '@/components/app-shell'
import type { Sessao } from '@/auth/session'

const dra: Sessao = { userId: 'u1', nome: 'Izadora', role: 'dra' }
const secretaria: Sessao = { userId: 'u2', nome: 'Ana', role: 'secretaria' }

describe('itensDeNavegacao', () => {
  it('dá à dra o menu inteiro, incluindo configurações', () => {
    const rotulos = itensDeNavegacao('dra').map((item) => item.rotulo)
    expect(rotulos).toEqual([
      'Funil',
      'Agenda',
      'Retornos',
      'Procedimentos',
      'Mensagens',
      'Google Agenda',
    ])
  })

  it('esconde da secretária o que ela não pode acessar', () => {
    const rotulos = itensDeNavegacao('secretaria').map((item) => item.rotulo)
    expect(rotulos).toEqual(['Funil', 'Agenda', 'Retornos'])
    expect(rotulos).not.toContain('Procedimentos')
    expect(rotulos).not.toContain('Mensagens')
    expect(rotulos).not.toContain('Google Agenda')
  })
})

describe('AppShell', () => {
  it('renderiza o conteúdo e identifica a dra', () => {
    render(
      <AppShell sessao={dra}>
        <p>conteúdo</p>
      </AppShell>,
    )
    expect(screen.getByText('conteúdo')).toBeDefined()
    expect(screen.getByText(/Izadora · Doutora/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Procedimentos' })).toBeDefined()
  })

  it('não mostra à secretária os links de configuração', () => {
    render(
      <AppShell sessao={secretaria}>
        <p>conteúdo</p>
      </AppShell>,
    )
    expect(screen.getByText(/Ana · Secretaria/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Agenda' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Procedimentos' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Mensagens' })).toBeNull()
  })
})
