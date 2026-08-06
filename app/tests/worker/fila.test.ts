import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TAMANHO_DO_LOTE,
  criarFilaSupabase,
  montarJob,
  type LinhaDaFila,
  type TemplateDeMensagem,
} from '../../worker/fila'

/**
 * O que importa aqui é a RESERVA. A garantia de que a paciente não recebe a
 * mesma mensagem duas vezes durante um deploy não está numa convenção da
 * aplicação: está no `update ... where status = 'pendente'`, que o Postgres
 * serializa linha a linha. Estes testes travam esse formato — se alguém trocar
 * a reserva por um `select` puro em nome da simplicidade, eles quebram.
 *
 * O cliente do Supabase é falsificado por um construtor de consulta mínimo, que
 * registra o que foi pedido e devolve o que o teste mandar. É menos do que um
 * teste de integração prova, e de propósito: `tests/db/` cobre o banco de
 * verdade; aqui cobre-se a forma da consulta e a montagem da mensagem, que são
 * o que dá para errar sem que o banco reclame.
 */

type Chamada = {
  tabela: string
  operacao: 'select' | 'update'
  valores?: Record<string, unknown>
  filtros: Array<{ tipo: string; coluna: string; valor: unknown }>
  limite?: number
}

type Resposta = { data?: unknown; error?: unknown; count?: number }

function fakeSupabase(responder: (chamada: Chamada, indice: number) => Resposta) {
  const chamadas: Chamada[] = []

  const cliente = {
    from(tabela: string) {
      const chamada: Chamada = { tabela, operacao: 'select', filtros: [] }
      const indice = chamadas.push(chamada) - 1

      const construtor = {
        select: () => construtor,
        update(valores: Record<string, unknown>) {
          chamada.operacao = 'update'
          chamada.valores = valores
          return construtor
        },
        eq(coluna: string, valor: unknown) {
          chamada.filtros.push({ tipo: 'eq', coluna, valor })
          return construtor
        },
        in(coluna: string, valor: unknown) {
          chamada.filtros.push({ tipo: 'in', coluna, valor })
          return construtor
        },
        lte(coluna: string, valor: unknown) {
          chamada.filtros.push({ tipo: 'lte', coluna, valor })
          return construtor
        },
        order: () => construtor,
        limit(n: number) {
          chamada.limite = n
          return construtor
        },
        then(aceitar: (r: Resposta) => unknown, recusar?: (e: unknown) => unknown) {
          const r = responder(chamada, indice)
          return Promise.resolve({ data: null, error: null, ...r }).then(aceitar, recusar)
        },
      }
      return construtor
    },
  }

  return { cliente: cliente as unknown as SupabaseClient, chamadas }
}

const templates: TemplateDeMensagem[] = [
  {
    kind: 'confirmacao',
    channel: 'whatsapp',
    assunto: null,
    corpo: 'Olá, {{nome}}! Sua consulta é {{data}} às {{hora}} ({{procedimento}}).',
  },
  {
    kind: 'confirmacao',
    channel: 'email',
    assunto: 'Consulta em {{data}}',
    corpo: 'Olá, {{nome}}!',
  },
  {
    kind: 'retorno',
    channel: 'whatsapp',
    assunto: null,
    corpo: 'Oi, {{nome}}! Seu retorno de {{procedimento}} vence em {{data_retorno}}.',
  },
]

const paciente = {
  nome_completo: 'Maria Aparecida Souza',
  como_prefere_ser_chamado: null,
  telefone: '+5511987654321',
  email: 'maria@exemplo.com',
}

const linhaDeConsulta: LinhaDaFila = {
  id: 'j1',
  kind: 'confirmacao',
  channel: 'whatsapp',
  tentativas: 0,
  patients: paciente,
  // 14:00 em São Paulo, 21/08/2026.
  appointments: { inicio: '2026-08-21T17:00:00Z', procedures: { nome: 'Botox' } },
  attendance_records: null,
}

describe('montarJob', () => {
  it('renderiza o template do par (kind, channel) com os dados da consulta', () => {
    const job = montarJob(linhaDeConsulta, templates)

    expect(job).toEqual({
      id: 'j1',
      kind: 'confirmacao',
      channel: 'whatsapp',
      telefone: '+5511987654321',
      email: 'maria@exemplo.com',
      assunto: null,
      corpo: 'Olá, Maria! Sua consulta é 21 de agosto às 14:00 (Botox).',
      tentativas: 0,
    })
  })

  it('usa o apelido do cadastro quando existe', () => {
    const job = montarJob(
      { ...linhaDeConsulta, patients: { ...paciente, como_prefere_ser_chamado: 'Cida' } },
      templates,
    )
    expect(job.corpo).toContain('Olá, Cida!')
  })

  it('cai para o primeiro nome quando não há apelido', () => {
    expect(montarJob(linhaDeConsulta, templates).corpo).toContain('Olá, Maria!')
  })

  it('renderiza o assunto do template de e-mail', () => {
    const job = montarJob({ ...linhaDeConsulta, channel: 'email' }, templates)
    expect(job.assunto).toBe('Consulta em 21 de agosto')
  })

  it('o lembrete de retorno usa a data com ano e o procedimento do atendimento', () => {
    const job = montarJob(
      {
        id: 'j9',
        kind: 'retorno',
        channel: 'whatsapp',
        tentativas: 0,
        patients: paciente,
        appointments: null,
        attendance_records: {
          retorno_vencimento: '2026-12-03',
          procedures: { nome: 'Preenchimento' },
        },
      },
      templates,
    )
    // Retorno cai meses à frente: sem o ano a Dra. fica adivinhando qual dezembro.
    expect(job.corpo).toBe(
      'Oi, Maria! Seu retorno de Preenchimento vence em 3 de dezembro de 2026.',
    )
  })

  it('template ausente ou desligado produz corpo vazio, que o despacho recusa', () => {
    const job = montarJob({ ...linhaDeConsulta, kind: 'avaliacao' }, templates)
    expect(job.corpo).toBe('')
  })

  it('aceita o vínculo embutido vindo como lista', () => {
    // O PostgREST devolve objeto para relação muitos-para-um, mas já devolveu
    // lista em versões anteriores. Aceitar as duas formas evita um worker que
    // para de achar o paciente depois de um upgrade do Supabase.
    const job = montarJob(
      {
        ...linhaDeConsulta,
        patients: [paciente],
        appointments: [{ inicio: '2026-08-21T17:00:00Z', procedures: [{ nome: 'Botox' }] }],
      },
      templates,
    )
    expect(job.corpo).toBe('Olá, Maria! Sua consulta é 21 de agosto às 14:00 (Botox).')
  })

  it('paciente sem vínculo não quebra a montagem — o despacho é quem falha o job', () => {
    const job = montarJob({ ...linhaDeConsulta, patients: null }, templates)
    expect(job.telefone).toBeNull()
    expect(job.email).toBeNull()
  })
})

const agora = new Date('2026-08-21T17:00:00Z')

describe('reservarPendentes', () => {
  it('só devolve os jobs que a reserva de fato ganhou', async () => {
    // Duas instâncias do worker no ar durante um deploy. Esta leu três
    // candidatos, mas a outra chegou antes em j2: o `update` condicional
    // devolve só j1 e j3, e é só isso que pode ser despachado.
    const { cliente, chamadas } = fakeSupabase((chamada) => {
      if (chamada.tabela === 'message_templates') return { data: templates }
      if (chamada.operacao === 'select') {
        return {
          data: [
            { ...linhaDeConsulta, id: 'j1' },
            { ...linhaDeConsulta, id: 'j2' },
            { ...linhaDeConsulta, id: 'j3' },
          ],
        }
      }
      return { data: [{ id: 'j1' }, { id: 'j3' }] }
    })

    const jobs = await criarFilaSupabase(cliente).reservarPendentes(agora)

    expect(jobs.map((j) => j.id)).toEqual(['j1', 'j3'])

    const reserva = chamadas.find((c) => c.operacao === 'update')!
    expect(reserva.valores).toEqual({ status: 'enviando' })
    // As duas metades da exclusão mútua: escolhe pelos ids lidos E exige que a
    // linha ainda esteja pendente. Sem o segundo filtro, as duas instâncias
    // reservariam as mesmas linhas.
    expect(reserva.filtros).toContainEqual({
      tipo: 'in',
      coluna: 'id',
      valor: ['j1', 'j2', 'j3'],
    })
    expect(reserva.filtros).toContainEqual({ tipo: 'eq', coluna: 'status', valor: 'pendente' })
  })

  it('a leitura de candidatos filtra por pendente, corta em agora e limita o lote', async () => {
    const { cliente, chamadas } = fakeSupabase((chamada) =>
      chamada.tabela === 'message_templates' ? { data: templates } : { data: [] },
    )

    await criarFilaSupabase(cliente).reservarPendentes(agora)

    const leitura = chamadas.find((c) => c.tabela === 'reminder_jobs')!
    expect(leitura.filtros).toContainEqual({ tipo: 'eq', coluna: 'status', valor: 'pendente' })
    expect(leitura.filtros).toContainEqual({
      tipo: 'lte',
      coluna: 'agendado_para',
      valor: agora.toISOString(),
    })
    expect(leitura.limite).toBe(TAMANHO_DO_LOTE)
  })

  it('fila vazia não tenta reservar nem ler templates', async () => {
    const { cliente, chamadas } = fakeSupabase(() => ({ data: [] }))

    expect(await criarFilaSupabase(cliente).reservarPendentes(agora)).toEqual([])
    expect(chamadas).toHaveLength(1)
  })

  it('reserva que não ganhou nada devolve lista vazia', async () => {
    const { cliente } = fakeSupabase((chamada) => {
      if (chamada.tabela === 'message_templates') return { data: templates }
      if (chamada.operacao === 'select') return { data: [linhaDeConsulta] }
      return { data: [] }
    })

    expect(await criarFilaSupabase(cliente).reservarPendentes(agora)).toEqual([])
  })

  it('erro do banco na leitura vira exceção — o ciclo inteiro é abortado', async () => {
    const { cliente } = fakeSupabase(() => ({ error: { message: 'conexão recusada' } }))

    await expect(criarFilaSupabase(cliente).reservarPendentes(agora)).rejects.toThrow(
      /conexão recusada/,
    )
  })

  it('erro do banco na reserva vira exceção antes de qualquer envio', async () => {
    const { cliente } = fakeSupabase((chamada) => {
      if (chamada.tabela === 'message_templates') return { data: templates }
      if (chamada.operacao === 'select') return { data: [linhaDeConsulta] }
      return { error: { message: 'deadlock detected' } }
    })

    await expect(criarFilaSupabase(cliente).reservarPendentes(agora)).rejects.toThrow(
      /deadlock/,
    )
  })
})

describe('gravação do desfecho', () => {
  it('marcarEnviado carimba a hora e só age sobre a linha que este worker reservou', async () => {
    const { cliente, chamadas } = fakeSupabase(() => ({ data: null }))

    await criarFilaSupabase(cliente).marcarEnviado('j1', 'M1')

    const [gravacao] = chamadas
    expect(gravacao.valores).toMatchObject({
      status: 'enviado',
      provider_message_id: 'M1',
      erro: null,
    })
    expect(typeof gravacao.valores!.enviado_em).toBe('string')
    expect(gravacao.filtros).toContainEqual({ tipo: 'eq', coluna: 'id', valor: 'j1' })
    // A trava final: se outra instância tiver mexido na linha, este update não
    // encontra nada em vez de sobrescrever o estado dela.
    expect(gravacao.filtros).toContainEqual({ tipo: 'eq', coluna: 'status', valor: 'enviando' })
  })

  it('falha definitiva marca falhou e não volta para a fila', async () => {
    const { cliente, chamadas } = fakeSupabase(() => ({ data: null }))

    await criarFilaSupabase(cliente).marcarFalha('j1', {
      erro: 'número inválido',
      definitiva: true,
      proximaTentativa: null,
      tentativas: 1,
    })

    expect(chamadas[0].valores).toEqual({
      status: 'falhou',
      erro: 'número inválido',
      tentativas: 1,
    })
  })

  it('falha transitória devolve à fila com o horário do recuo', async () => {
    const { cliente, chamadas } = fakeSupabase(() => ({ data: null }))
    const proxima = new Date('2026-08-21T17:05:00Z')

    await criarFilaSupabase(cliente).marcarFalha('j1', {
      erro: '502',
      definitiva: false,
      proximaTentativa: proxima,
      tentativas: 1,
    })

    expect(chamadas[0].valores).toEqual({
      status: 'pendente',
      erro: '502',
      tentativas: 1,
      agendado_para: proxima.toISOString(),
    })
  })

  it('reagendar devolve à fila sem gastar tentativa', async () => {
    const { cliente, chamadas } = fakeSupabase(() => ({ data: null }))
    const novoMomento = new Date('2026-08-22T12:00:00Z')

    await criarFilaSupabase(cliente).reagendar('j1', novoMomento)

    expect(chamadas[0].valores).toEqual({
      status: 'pendente',
      agendado_para: novoMomento.toISOString(),
    })
    expect(chamadas[0].valores).not.toHaveProperty('tentativas')
  })

  it('erro do banco ao gravar vira exceção, para o despacho contabilizar a falha', async () => {
    const { cliente } = fakeSupabase(() => ({ error: { message: 'permission denied' } }))

    await expect(criarFilaSupabase(cliente).marcarEnviado('j1', 'M1')).rejects.toThrow(
      /permission denied/,
    )
  })
})

describe('contarReservasPresas', () => {
  it('conta o que ficou em enviando de um worker morto sem aviso', async () => {
    const { cliente, chamadas } = fakeSupabase(() => ({ count: 2 }))

    expect(await criarFilaSupabase(cliente).contarReservasPresas()).toBe(2)
    expect(chamadas[0].filtros).toContainEqual({
      tipo: 'eq',
      coluna: 'status',
      valor: 'enviando',
    })
  })

  it('erro na contagem não é motivo para o worker não subir', async () => {
    const { cliente } = fakeSupabase(() => ({ error: { message: 'timeout' } }))
    expect(await criarFilaSupabase(cliente).contarReservasPresas()).toBeNull()
  })
})
