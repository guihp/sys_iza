import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell, itensDeNavegacao } from '@/components/app-shell'
import type { Sessao } from '@/auth/session'

const dra: Sessao = { userId: 'u1', nome: 'Izadora Barros', role: 'dra' }
const secretaria: Sessao = { userId: 'u2', nome: 'Ana Lima', role: 'secretaria' }

/** Dia fixo para a barra superior e o cartão de meta não dependerem do relógio. */
const HOJE = '2026-08-06'

describe('itensDeNavegacao', () => {
  it('dá à dra o menu inteiro, incluindo configurações', () => {
    const rotulos = itensDeNavegacao('dra').map((item) => item.rotulo)
    expect(rotulos).toEqual([
      'Funil',
      'Agenda',
      'Retornos',
      'Procedimentos',
      'Marca',
      'Mensagens',
      'Google Agenda',
    ])
  })

  it('esconde da secretária o que ela não pode acessar', () => {
    const rotulos = itensDeNavegacao('secretaria').map((item) => item.rotulo)
    expect(rotulos).toEqual(['Funil', 'Agenda', 'Retornos'])
    expect(rotulos).not.toContain('Procedimentos')
    expect(rotulos).not.toContain('Marca')
    expect(rotulos).not.toContain('Mensagens')
    expect(rotulos).not.toContain('Google Agenda')
  })
})

describe('AppShell', () => {
  it('renderiza o conteúdo e identifica a dra', () => {
    render(
      <AppShell sessao={dra} hojeISO={HOJE}>
        <p>conteúdo</p>
      </AppShell>,
    )
    expect(screen.getByText('conteúdo')).toBeDefined()
    expect(screen.getByText('Izadora Barros')).toBeDefined()
    expect(screen.getByText('Doutora')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Procedimentos' })).toBeDefined()
  })

  it('não mostra à secretária os links de configuração', () => {
    render(
      <AppShell sessao={secretaria} hojeISO={HOJE}>
        <p>conteúdo</p>
      </AppShell>,
    )
    expect(screen.getByText('Ana Lima')).toBeDefined()
    // Com acento: é o papel por extenso, em português, não o valor do enum.
    expect(screen.getByText('Secretária')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Agenda' })).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Procedimentos' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Mensagens' })).toBeNull()
  })

  it('omite os contadores quando o banco está vazio', () => {
    render(
      <AppShell sessao={dra} hojeISO={HOJE}>
        <p>conteúdo</p>
      </AppShell>,
    )
    // Sem prop de contadores = tudo zero, que é o estado real da clínica hoje.
    // Nenhum item pode carregar um "0" pendurado.
    expect(screen.getByRole('link', { name: 'Funil' }).textContent).toBe('Funil')
    expect(screen.getByRole('link', { name: 'Agenda' }).textContent).toBe('Agenda')
  })

  it('mostra os contadores que têm o que contar, e rotula o da agenda', () => {
    render(
      <AppShell
        sessao={dra}
        hojeISO={HOJE}
        contadores={{ funil: 12, agendaHoje: 3, retornosVencidos: 0, mensagensAtivas: 7 }}
      >
        <p>conteúdo</p>
      </AppShell>,
    )
    // O contador entra no nome acessível do link — "Agenda, 3 hoje" é
    // justamente o que quem usa leitor de tela precisa ouvir.
    expect(screen.getByRole('link', { name: 'Funil, 12' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Agenda, 3 hoje' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Mensagens, 7' })).toBeDefined()
    // Zero continua fora, mesmo com os vizinhos preenchidos.
    expect(screen.getByRole('link', { name: 'Retornos' }).textContent).toBe('Retornos')
  })

  it('desenha o cartão de meta zerado quando não houve atendimento no mês', () => {
    render(
      <AppShell sessao={dra} hojeISO={HOJE}>
        <p>conteúdo</p>
      </AppShell>,
    )
    expect(screen.getByText('R$ 0')).toBeDefined()
    // 6 de agosto: restam 26 dias contando hoje, num mês de 31.
    expect(screen.getByText('0% alcançado · 26 dias restantes')).toBeDefined()

    const barra = screen.getByRole('progressbar', { name: /meta do mês/i })
    expect(barra.getAttribute('aria-valuenow')).toBe('0')
  })

  it('preenche a barra da meta com o realizado do mês', () => {
    render(
      <AppShell sessao={dra} hojeISO={HOJE} realizadoDoMesCentavos={2_250_000}>
        <p>conteúdo</p>
      </AppShell>,
    )
    expect(screen.getByText('R$ 22.500')).toBeDefined()
    expect(screen.getByRole('progressbar', { name: /meta do mês/i }).getAttribute('aria-valuenow')).toBe(
      '50',
    )
  })

  it('põe na barra superior a busca, a data de hoje e o botão de novo lead', () => {
    render(
      <AppShell sessao={dra} hojeISO={HOJE}>
        <p>conteúdo</p>
      </AppShell>,
    )
    expect(screen.getByRole('searchbox', { name: /buscar paciente/i })).toBeDefined()
    expect(screen.getByText('Quinta, 6 de agosto')).toBeDefined()
    expect(screen.getByRole('button', { name: /novo lead/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /alternar tema/i })).toBeDefined()
  })
})
