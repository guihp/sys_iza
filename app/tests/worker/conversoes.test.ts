// @vitest-environment node
/**
 * Despacho da fila de conversões, e o contrato do payload congelado.
 *
 * Quatro coisas só este despacho pode garantir, e nenhuma delas dá para
 * verificar em produção — não há dataset nem token, e não vai haver antes de a
 * Dra. criar os dois:
 *
 *   1. com o envio DESLIGADO o worker não toca no banco. É o estado de hoje, e o
 *      sistema precisa rodar assim indefinidamente, sem log de pânico a cada
 *      ciclo;
 *   2. o que é transitório volta para a fila e o que é permanente para de ser
 *      tentado — a mesma decisão da fila de lembretes, tomada pelo mesmo
 *      `ErroDeEnvio.permanente`;
 *   3. evento fora da janela de sete dias da Meta é abandonado com a mensagem
 *      certa, em vez de ficar na frente de uma fila ordenada por `ocorrido_em`
 *      escondendo os eventos novos atrás dele;
 *   4. o payload que volta do banco passa por um schema que ESTRIPA o que não
 *      reconhece — é a restrição legal do plano virada tipo.
 */
import { describe, expect, it, vi } from 'vitest'
import { ErroDeEnvio } from '@/integrations/envio'
import { montarEventoDaCapi, type EventoDeConversao } from '@/integrations/meta/capi'
import { congelarConversao, lerConversaoCongelada } from '@/integrations/meta/payload'
import type { ConversaoPlanejada } from '@/domain/marketing/plan-conversions'
import {
  MAX_TENTATIVAS,
  despacharConversoes,
  eventoVencido,
  type ConversaoPendente,
  type DepsDeConversoes,
} from '../../worker/despacho-conversoes'
import { montarConversao } from '../../worker/fila-conversoes'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

/** 14:00 em São Paulo. A janela de silêncio não existe nesta fila. */
const agora = new Date('2026-08-20T17:00:00Z')

const eventoBase: EventoDeConversao = {
  evento: 'Schedule',
  eventId: 'a'.repeat(64),
  ocorridoEm: new Date('2026-08-20T16:00:00Z'),
  ctwaClid: 'clid-1',
  telefoneHash: 'b'.repeat(64),
  valor: null,
  moeda: null,
}

const jobBase: ConversaoPendente = { id: 'c1', tentativas: 0, evento: eventoBase }

function montarDeps(overrides: Partial<DepsDeConversoes> = {}): DepsDeConversoes & {
  reservarPendentes: ReturnType<typeof vi.fn>
  marcarEnviado: ReturnType<typeof vi.fn>
  marcarFalha: ReturnType<typeof vi.fn>
  meta: { enviarConversao: ReturnType<typeof vi.fn> } | null
} {
  return {
    reservarPendentes: vi.fn().mockResolvedValue([jobBase]),
    marcarEnviado: vi.fn().mockResolvedValue(undefined),
    marcarFalha: vi.fn().mockResolvedValue(undefined),
    meta: { enviarConversao: vi.fn().mockResolvedValue({ eventosRecebidos: 1 }) },
    ...overrides,
  } as never
}

// ---------------------------------------------------------------------------
// Desligado
// ---------------------------------------------------------------------------

describe('despacharConversoes — envio desligado', () => {
  it('não consulta a fila quando não há cliente da Meta', async () => {
    // Sem isso seriam 288 idas ao banco por dia para uma tabela que nunca vai ser
    // despachada — e a primeira delas a falhar viraria log de erro sobre um
    // recurso que a clínica não ligou.
    const deps = montarDeps({ meta: null })
    const resumo = await despacharConversoes(deps, agora)

    expect(deps.reservarPendentes).not.toHaveBeenCalled()
    expect(deps.marcarFalha).not.toHaveBeenCalled()
    expect(resumo).toEqual({ enviados: 0, falhas: 0, desistidos: 0 })
  })
})

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

describe('despacharConversoes — envio', () => {
  it('envia o evento e marca como enviado', async () => {
    const deps = montarDeps()
    const resumo = await despacharConversoes(deps, agora)

    expect(deps.meta!.enviarConversao).toHaveBeenCalledWith(eventoBase)
    expect(deps.marcarEnviado).toHaveBeenCalledWith('c1')
    expect(deps.marcarFalha).not.toHaveBeenCalled()
    expect(resumo).toEqual({ enviados: 1, falhas: 0, desistidos: 0 })
  })

  it('fila vazia não faz nada', async () => {
    const deps = montarDeps({ reservarPendentes: vi.fn().mockResolvedValue([]) })
    expect(await despacharConversoes(deps, agora)).toEqual({
      enviados: 0,
      falhas: 0,
      desistidos: 0,
    })
  })

  it('um job podre não leva o lote junto', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([
          { ...jobBase, id: 'c1', evento: null },
          { ...jobBase, id: 'c2' },
          { ...jobBase, id: 'c3' },
        ]),
    })
    const resumo = await despacharConversoes(deps, agora)

    expect(resumo).toEqual({ enviados: 2, falhas: 1, desistidos: 1 })
    expect(deps.marcarEnviado).toHaveBeenCalledWith('c2')
    expect(deps.marcarEnviado).toHaveBeenCalledWith('c3')
  })
})

// ---------------------------------------------------------------------------
// Retentativa
// ---------------------------------------------------------------------------

describe('despacharConversoes — retentativa', () => {
  it('devolve à fila o que é transitório', async () => {
    const deps = montarDeps({
      meta: {
        enviarConversao: vi.fn().mockRejectedValue(new ErroDeEnvio('502', 'indisponivel')),
      },
    })
    const resumo = await despacharConversoes(deps, agora)

    expect(deps.marcarFalha).toHaveBeenCalledWith('c1', {
      erro: '502',
      definitiva: false,
      tentativas: 1,
    })
    expect(resumo).toEqual({ enviados: 0, falhas: 1, desistidos: 0 })
  })

  it('desiste na hora do que é permanente', async () => {
    const deps = montarDeps({
      meta: {
        enviarConversao: vi.fn().mockRejectedValue(new ErroDeEnvio('token morto', 'credencial')),
      },
    })
    const resumo = await despacharConversoes(deps, agora)

    expect(deps.marcarFalha).toHaveBeenCalledWith('c1', {
      erro: 'token morto',
      definitiva: true,
      tentativas: 1,
    })
    expect(resumo).toEqual({ enviados: 0, falhas: 1, desistidos: 1 })
  })

  it('desiste ao esgotar o teto de tentativas', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([{ ...jobBase, tentativas: MAX_TENTATIVAS - 1 }]),
      meta: { enviarConversao: vi.fn().mockRejectedValue(new ErroDeEnvio('502', 'indisponivel')) },
    })
    const resumo = await despacharConversoes(deps, agora)

    expect(deps.marcarFalha).toHaveBeenCalledWith('c1', {
      erro: expect.stringContaining(`Desistindo após ${MAX_TENTATIVAS} tentativas`),
      definitiva: true,
      tentativas: MAX_TENTATIVAS,
    })
    expect(resumo.desistidos).toBe(1)
  })

  it('erro que não é ErroDeEnvio conta como transitório', async () => {
    // Bug ou `fetch` que escapou da classificação. A escolha conservadora é
    // tentar de novo; `MAX_TENTATIVAS` limita o estrago.
    const deps = montarDeps({
      meta: { enviarConversao: vi.fn().mockRejectedValue(new TypeError('undefined is not a fn')) },
    })
    await despacharConversoes(deps, agora)

    expect(deps.marcarFalha).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ definitiva: false }),
    )
  })

  it('gravação de erro que falha não derruba o ciclo', async () => {
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const deps = montarDeps({
        reservarPendentes: vi
          .fn()
          .mockResolvedValue([{ ...jobBase, id: 'c1', evento: null }, { ...jobBase, id: 'c2' }]),
        marcarFalha: vi.fn().mockRejectedValue(new Error('banco fora do ar')),
      })
      const resumo = await despacharConversoes(deps, agora)

      expect(resumo).toEqual({ enviados: 1, falhas: 1, desistidos: 1 })
      expect(deps.marcarEnviado).toHaveBeenCalledWith('c2')
    } finally {
      erros.mockRestore()
    }
  })

  it('evento enviado cuja gravação falhou NÃO volta para a fila', async () => {
    // Único ponto em que "definitiva" não quer dizer que deu errado: o evento já
    // chegou na Meta. Devolvê-lo à fila contaria a conversão duas vezes no
    // Gerenciador, e o anúncio pareceria melhor do que é.
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const deps = montarDeps({
        marcarEnviado: vi.fn().mockRejectedValue(new Error('banco fora do ar')),
      })
      const resumo = await despacharConversoes(deps, agora)

      expect(deps.marcarFalha).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ definitiva: true, erro: expect.stringMatching(/NÃO reenviar/) }),
      )
      expect(resumo).toEqual({ enviados: 0, falhas: 1, desistidos: 1 })
    } finally {
      erros.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// A janela de sete dias
// ---------------------------------------------------------------------------

describe('eventoVencido', () => {
  it('evento de hoje está dentro da janela', () => {
    expect(eventoVencido(new Date('2026-08-20T16:00:00Z'), agora)).toBe(false)
  })

  it('evento de seis dias atrás ainda passa', () => {
    expect(eventoVencido(new Date('2026-08-14T17:00:00Z'), agora)).toBe(false)
  })

  it('evento de sete dias atrás já não passa', () => {
    // O corte é uma hora antes do limite da Meta: um job avaliado em cima da
    // hora esperaria a vez no lote e chegaria lá vencido, recusado com um erro
    // de payload que não explica nada a quem lê a coluna `erro`.
    expect(eventoVencido(new Date('2026-08-13T17:00:00Z'), agora)).toBe(true)
  })
})

describe('despacharConversoes — evento vencido', () => {
  it('abandona sem gastar requisição, nomeando a janela', async () => {
    const deps = montarDeps({
      reservarPendentes: vi.fn().mockResolvedValue([
        {
          ...jobBase,
          evento: { ...eventoBase, ocorridoEm: new Date('2026-08-01T17:00:00Z') },
        },
      ]),
    })
    const resumo = await despacharConversoes(deps, agora)

    expect(deps.meta!.enviarConversao).not.toHaveBeenCalled()
    expect(deps.marcarFalha).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ definitiva: true, erro: expect.stringMatching(/7 dias/) }),
    )
    expect(resumo).toEqual({ enviados: 0, falhas: 1, desistidos: 1 })
  })
})

// ---------------------------------------------------------------------------
// Payload congelado — o contorno da restrição legal
// ---------------------------------------------------------------------------

const planejada: ConversaoPlanejada = {
  patientId: '4d9b6f1e-0000-4000-8000-000000000001',
  evento: 'Purchase',
  chaveIdempotencia: '4d9b6f1e-0000-4000-8000-000000000001:Purchase',
  eventId: 'c'.repeat(64),
  ocorridoEm: new Date('2026-08-20T16:00:00Z'),
  valor: 1800,
  moeda: 'BRL',
  ctwaClid: 'clid-1',
  telefoneHash: 'd'.repeat(64),
}

describe('congelarConversao', () => {
  it('congela o fato, não o formato de fio da Meta', () => {
    // Congelar o JSON da CAPI pronto faria os jobs já enfileirados saírem no
    // formato velho no dia em que a Meta mudar o contrato — e `montarEventoDaCapi`
    // deixaria de ser o único lugar que conhece o formato.
    expect(congelarConversao(planejada)).toEqual({
      evento: 'Purchase',
      eventId: 'c'.repeat(64),
      ocorridoEm: '2026-08-20T16:00:00.000Z',
      ctwaClid: 'clid-1',
      telefoneHash: 'd'.repeat(64),
      valor: 1800,
      moeda: 'BRL',
    })
  })

  it('não repete o uuid da paciente dentro do jsonb', () => {
    // Ele já é coluna própria da linha. Repetido no payload seria uma segunda
    // cópia de um identificador pessoal, num campo que a tela exibe inteiro.
    const congelado = JSON.stringify(congelarConversao(planejada))
    expect(congelado).not.toContain('4d9b6f1e')
  })
})

describe('lerConversaoCongelada', () => {
  it('ida e volta preserva o evento', () => {
    const lido = lerConversaoCongelada(congelarConversao(planejada))
    expect(lido).toEqual({
      evento: 'Purchase',
      eventId: 'c'.repeat(64),
      ocorridoEm: new Date('2026-08-20T16:00:00Z'),
      ctwaClid: 'clid-1',
      telefoneHash: 'd'.repeat(64),
      valor: 1800,
      moeda: 'BRL',
    })
  })

  it('RESTRIÇÃO LEGAL: estripa o que não reconhece', () => {
    // `payload` é jsonb e o banco aceita qualquer objeto. Uma Server Action
    // futura escrita com pressa pode achar conveniente gravar "o procedimento, só
    // para depurar". Ele não sai daqui, e por isso não chega ao adaptador.
    const contaminado = {
      ...congelarConversao(planejada),
      procedimento: 'Toxina botulínica',
      observacoes: 'paciente relatou dor',
      nomeCompleto: 'Maria Silva',
      telefoneE164: '+5511987654321',
    }

    const lido = lerConversaoCongelada(contaminado)!
    expect(JSON.stringify(lido)).not.toContain('Toxina')
    expect(JSON.stringify(lido)).not.toContain('Maria')
    expect(JSON.stringify(lido)).not.toContain('5511987654321')
    // E o que sobrou também não passa pela tradução para a Meta.
    expect(JSON.stringify(montarEventoDaCapi(lido))).not.toContain('Toxina')
  })

  it('devolve null em vez de lançar quando o payload é inválido', () => {
    // Uma linha ilegível não pode derrubar as outras dezenas do ciclo.
    expect(lerConversaoCongelada(null)).toBeNull()
    expect(lerConversaoCongelada({})).toBeNull()
    expect(lerConversaoCongelada('{"evento":"Schedule"}')).toBeNull()
    expect(
      lerConversaoCongelada({ ...congelarConversao(planejada), evento: 'AgendouNoKanban' }),
    ).toBeNull()
    expect(lerConversaoCongelada({ ...congelarConversao(planejada), ctwaClid: '' })).toBeNull()
  })

  it('recusa data inválida, que viraria event_time NaN', () => {
    expect(
      lerConversaoCongelada({ ...congelarConversao(planejada), ocorridoEm: 'ontem' }),
    ).toBeNull()
  })
})

describe('montarConversao', () => {
  it('traduz a linha do banco, com o payload já filtrado', () => {
    const job = montarConversao({
      id: 'c9',
      tentativas: 2,
      payload: { ...congelarConversao(planejada), procedimento: 'Toxina botulínica' },
    })

    expect(job.id).toBe('c9')
    expect(job.tentativas).toBe(2)
    expect(JSON.stringify(job.evento)).not.toContain('Toxina')
  })

  it('payload ilegível vira evento nulo, e o despacho decide o que fazer', () => {
    const job = montarConversao({ id: 'c9', tentativas: 0, payload: { lixo: true } })
    expect(job.evento).toBeNull()
  })
})
