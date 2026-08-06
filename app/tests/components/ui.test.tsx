import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Avatar,
  CabecalhoDePagina,
  EstadoVazio,
  Kpi,
  Pilula,
  PilulaLink,
  RotuloMiudo,
  Tabela,
  TabelaCabecalho,
  TabelaCelula,
  TabelaColuna,
  TabelaCorpo,
  TabelaLinha,
  classesDePilula,
  iniciaisDoNome,
  juntar,
} from '@/components/ui'

describe('iniciaisDoNome', () => {
  it('usa a primeira letra do primeiro e do último nome', () => {
    expect(iniciaisDoNome('Izadora Barros')).toBe('IB')
    expect(iniciaisDoNome('Ana Clara Souza')).toBe('AS')
  })

  it('ignora as preposições do meio', () => {
    expect(iniciaisDoNome('Maria da Silva')).toBe('MS')
    expect(iniciaisDoNome('João de Souza e Lima')).toBe('JL')
  })

  it('não zera quando o nome é só preposição e sobrenome', () => {
    expect(iniciaisDoNome('de Souza')).toBe('SO')
  })

  it('dobra a letra do nome único', () => {
    expect(iniciaisDoNome('Izadora')).toBe('IZ')
  })

  it('aguenta espaço sobrando de colagem', () => {
    expect(iniciaisDoNome('   Ana   Lima  ')).toBe('AL')
  })

  it('devolve travessão em vez de avatar em branco', () => {
    expect(iniciaisDoNome('')).toBe('—')
    expect(iniciaisDoNome('   ')).toBe('—')
  })
})

describe('juntar', () => {
  it('descarta o que não é classe', () => {
    expect(juntar('a', false, null, undefined, '', 'b')).toBe('a b')
  })
})

describe('Pilula', () => {
  it('nasce como botão que não envia formulário', () => {
    render(<Pilula>Agendar</Pilula>)
    expect(screen.getByRole('button', { name: 'Agendar' }).getAttribute('type')).toBe('button')
  })

  it('aceita virar submit quando o formulário pede', () => {
    render(<Pilula type="submit">Cadastrar</Pilula>)
    expect(screen.getByRole('button', { name: 'Cadastrar' }).getAttribute('type')).toBe('submit')
  })

  it('tem as três variantes, todas em pílula', () => {
    for (const variante of ['solida', 'contorno', 'suave'] as const) {
      expect(classesDePilula(variante)).toContain('rounded-full')
    }
    expect(classesDePilula('solida')).toContain('bg-solido')
    expect(classesDePilula('contorno')).toContain('border-linha')
    expect(classesDePilula('suave')).toContain('bg-superficie-2')
  })

  it('a versão de link continua sendo link de verdade', () => {
    render(<PilulaLink href="/agenda">Agendar</PilulaLink>)
    expect(screen.getByRole('link', { name: 'Agendar' }).getAttribute('href')).toBe('/agenda')
  })
})

describe('Avatar', () => {
  it('não é anunciado, porque o nome está sempre ao lado', () => {
    const { container } = render(<Avatar nome="Izadora Barros" />)
    const avatar = container.firstElementChild
    expect(avatar?.getAttribute('aria-hidden')).toBe('true')
    expect(avatar?.textContent).toBe('IB')
  })
})

describe('Kpi', () => {
  it('mostra rótulo, número e sublegenda', () => {
    render(<Kpi rotulo="Leads ativos" valor={0} sublegenda="+0 esta semana" />)
    expect(screen.getByText('Leads ativos')).toBeDefined()
    expect(screen.getByText('0')).toBeDefined()
    expect(screen.getByText('+0 esta semana')).toBeDefined()
  })

  it('aceita travessão no lugar do número quando não há o que medir', () => {
    render(<Kpi rotulo="Conversão" valor="—" />)
    expect(screen.getByText('—')).toBeDefined()
  })
})

describe('RotuloMiudo', () => {
  it('tem dois tons: apoio e seção', () => {
    const { container } = render(
      <>
        <RotuloMiudo>Gestão</RotuloMiudo>
        <RotuloMiudo tom="acento">Pipeline clínico</RotuloMiudo>
      </>,
    )
    const [apoio, secao] = Array.from(container.querySelectorAll('span'))
    expect(apoio.className).toContain('text-texto-suave')
    expect(secao.className).toContain('text-acento')
    expect(apoio.className).toContain('uppercase')
  })
})

describe('EstadoVazio', () => {
  it('explica o vazio e oferece a saída', () => {
    render(
      <EstadoVazio
        mensagem="Nenhuma paciente neste estágio."
        explicacao="A coluna enche conforme os leads chegam."
        acao={<Pilula variante="solida">Novo lead</Pilula>}
      />,
    )
    expect(screen.getByText('Nenhuma paciente neste estágio.')).toBeDefined()
    expect(screen.getByText('A coluna enche conforme os leads chegam.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Novo lead' })).toBeDefined()
  })
})

describe('Tabela', () => {
  it('monta uma tabela acessível, com cabeçalho de coluna', () => {
    render(
      <Tabela>
        <TabelaCabecalho>
          <TabelaLinha>
            <TabelaColuna>Paciente</TabelaColuna>
          </TabelaLinha>
        </TabelaCabecalho>
        <TabelaCorpo>
          <TabelaLinha>
            <TabelaCelula>Ana Lima</TabelaCelula>
          </TabelaLinha>
        </TabelaCorpo>
      </Tabela>,
    )
    expect(screen.getByRole('table')).toBeDefined()
    expect(screen.getByRole('columnheader', { name: 'Paciente' })).toBeDefined()
    expect(screen.getByRole('cell', { name: 'Ana Lima' })).toBeDefined()
  })

  it('apaga a borda só da última linha do corpo, nunca a do cabeçalho', () => {
    const { container } = render(
      <Tabela>
        <TabelaCabecalho>
          <TabelaLinha>
            <TabelaColuna>Paciente</TabelaColuna>
          </TabelaLinha>
        </TabelaCabecalho>
        <TabelaCorpo>
          <TabelaLinha>
            <TabelaCelula>Ana</TabelaCelula>
          </TabelaLinha>
        </TabelaCorpo>
      </Tabela>,
    )
    expect(container.querySelector('thead')?.className).toContain('[&>tr]:border-b')
    expect(container.querySelector('thead')?.className).not.toContain('last-child')
    expect(container.querySelector('tbody')?.className).toContain('[&>tr:last-child]:border-b-0')
  })
})

describe('CabecalhoDePagina', () => {
  it('põe o título como h1 e os KPIs ao lado', () => {
    render(
      <CabecalhoDePagina
        secao="Pipeline clínico"
        titulo="Funil de pacientes"
        descricao="Arraste o cartão para mudar o estágio."
        kpis={<Kpi rotulo="Leads ativos" valor={0} />}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Funil de pacientes' })).toBeDefined()
    expect(screen.getByText('Pipeline clínico')).toBeDefined()
    expect(screen.getByText('Leads ativos')).toBeDefined()
  })
})
