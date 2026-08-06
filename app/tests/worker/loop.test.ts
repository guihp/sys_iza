import { describe, expect, it, vi } from 'vitest'
import { criarLoop, instalarEncerramento, type Relogio } from '../../worker/loop'

/**
 * O loop é o que sobrevive: a exceção num job, o banco fora do ar por meia hora,
 * o deploy que chega no meio de um envio. Estes testes cobrem as três coisas que
 * mantêm o worker de pé — não reentrar, não morrer, e não ser interrompido no
 * meio de uma mensagem.
 *
 * O relógio é injetado em vez de usar `vi.useFakeTimers()` porque o que interessa
 * verificar é *quando* o loop pediu o próximo ciclo, e um relógio manual deixa
 * isso explícito no teste em vez de escondido num `advanceTimersByTime`.
 */

function relogioManual() {
  let pendente: { acao: () => void; ms: number } | null = null

  const relogio: Relogio = {
    agendar(acao, ms) {
      pendente = { acao, ms }
      return pendente
    },
    cancelar() {
      pendente = null
    },
  }

  return {
    relogio,
    agendado: () => pendente,
    disparar() {
      const p = pendente
      pendente = null
      p?.acao()
    },
  }
}

/** Promessa que o teste resolve quando quiser. */
function promessaControlada<T = void>() {
  let resolver!: (valor: T) => void
  let recusar!: (causa: unknown) => void
  const promessa = new Promise<T>((aceitar, negar) => {
    resolver = aceitar
    recusar = negar
  })
  return { promessa, resolver, recusar }
}

/** Deixa a fila de microtarefas escoar. */
const escoar = () => new Promise<void>((r) => setTimeout(r, 0))

describe('criarLoop', () => {
  it('roda o primeiro ciclo imediatamente e agenda o seguinte pelo intervalo', async () => {
    const { relogio, agendado } = relogioManual()
    const ciclo = vi.fn().mockResolvedValue(undefined)

    const loop = criarLoop({ intervaloMs: 300_000, ciclo, relogio })
    loop.iniciar()
    await escoar()

    expect(ciclo).toHaveBeenCalledOnce()
    expect(agendado()?.ms).toBe(300_000)
  })

  it('conta o intervalo a partir do FIM do ciclo, nunca sobrepondo dois', async () => {
    // `setInterval` dispararia de novo com o ciclo anterior ainda no ar, e dois
    // ciclos simultâneos na mesma instância reproduziriam, dentro do processo, a
    // corrida que a reserva no banco existe para evitar.
    const { relogio, agendado, disparar } = relogioManual()
    const primeiro = promessaControlada()
    const ciclo = vi
      .fn()
      .mockReturnValueOnce(primeiro.promessa)
      .mockResolvedValue(undefined)

    const loop = criarLoop({ intervaloMs: 300_000, ciclo, relogio })
    loop.iniciar()
    await escoar()

    // Ciclo pendurado: nada foi agendado ainda.
    expect(agendado()).toBeNull()
    expect(loop.emAndamento()).toBe(true)

    primeiro.resolver()
    await escoar()

    expect(agendado()?.ms).toBe(300_000)
    disparar()
    await escoar()
    expect(ciclo).toHaveBeenCalledTimes(2)
  })

  it('exceção no ciclo é registrada e o loop continua rodando', async () => {
    const { relogio, agendado, disparar } = relogioManual()
    const aoFalhar = vi.fn()
    const ciclo = vi
      .fn()
      .mockRejectedValueOnce(new Error('banco fora do ar'))
      .mockResolvedValue(undefined)

    const loop = criarLoop({ intervaloMs: 300_000, ciclo, relogio, aoFalhar })
    loop.iniciar()
    await escoar()

    expect(aoFalhar).toHaveBeenCalledWith(expect.objectContaining({ message: 'banco fora do ar' }))
    expect(agendado()).not.toBeNull()

    disparar()
    await escoar()
    expect(ciclo).toHaveBeenCalledTimes(2)
  })

  it('exceção síncrona do ciclo também não derruba o loop', async () => {
    const { relogio, agendado } = relogioManual()
    const aoFalhar = vi.fn()
    const ciclo = vi.fn(() => {
      throw new Error('estourou antes do await')
    })

    const loop = criarLoop({ intervaloMs: 300_000, ciclo, relogio, aoFalhar })
    loop.iniciar()
    await escoar()

    expect(aoFalhar).toHaveBeenCalledOnce()
    expect(agendado()).not.toBeNull()
  })

  it('iniciar duas vezes não duplica o loop', async () => {
    const { relogio } = relogioManual()
    const ciclo = vi.fn().mockResolvedValue(undefined)

    const loop = criarLoop({ intervaloMs: 300_000, ciclo, relogio })
    loop.iniciar()
    loop.iniciar()
    await escoar()

    expect(ciclo).toHaveBeenCalledOnce()
  })
})

describe('encerramento', () => {
  it('espera o ciclo em andamento terminar antes de resolver', async () => {
    // O deploy do Coolify manda SIGTERM no meio de um envio. Sair na hora
    // deixaria o job reservado sem ninguém para gravar o resultado.
    const { relogio } = relogioManual()
    const emVoo = promessaControlada()
    const loop = criarLoop({
      intervaloMs: 300_000,
      ciclo: () => emVoo.promessa,
      relogio,
    })

    loop.iniciar()
    await escoar()

    let terminou = false
    const encerramento = loop.encerrar().then(() => {
      terminou = true
    })

    await escoar()
    expect(terminou).toBe(false)

    emVoo.resolver()
    await encerramento
    expect(terminou).toBe(true)
  })

  it('não inicia um novo ciclo depois do pedido de encerramento', async () => {
    const { relogio, agendado } = relogioManual()
    const emVoo = promessaControlada()
    const ciclo = vi.fn().mockReturnValueOnce(emVoo.promessa).mockResolvedValue(undefined)

    const loop = criarLoop({ intervaloMs: 300_000, ciclo, relogio })
    loop.iniciar()
    await escoar()

    const encerramento = loop.encerrar()
    emVoo.resolver()
    await encerramento

    expect(ciclo).toHaveBeenCalledOnce()
    expect(agendado()).toBeNull()
  })

  it('cancela o próximo ciclo já agendado quando está ocioso', async () => {
    const { relogio, agendado } = relogioManual()
    const loop = criarLoop({
      intervaloMs: 300_000,
      ciclo: vi.fn().mockResolvedValue(undefined),
      relogio,
    })

    loop.iniciar()
    await escoar()
    expect(agendado()).not.toBeNull()

    await loop.encerrar()
    expect(agendado()).toBeNull()
  })

  it('encerrar duas vezes é inofensivo', async () => {
    const { relogio } = relogioManual()
    const loop = criarLoop({
      intervaloMs: 300_000,
      ciclo: vi.fn().mockResolvedValue(undefined),
      relogio,
    })
    loop.iniciar()
    await escoar()

    await loop.encerrar()
    await expect(loop.encerrar()).resolves.toBeUndefined()
  })

  it('ciclo que falha durante o encerramento não impede a saída', async () => {
    const { relogio } = relogioManual()
    const emVoo = promessaControlada()
    const aoFalhar = vi.fn()
    const loop = criarLoop({
      intervaloMs: 300_000,
      ciclo: () => emVoo.promessa,
      relogio,
      aoFalhar,
    })
    loop.iniciar()
    await escoar()

    const encerramento = loop.encerrar()
    emVoo.recusar(new Error('morreu no meio'))

    await expect(encerramento).resolves.toBeUndefined()
    expect(aoFalhar).toHaveBeenCalledOnce()
  })
})

/** Processo falso: registra os ouvintes e captura o código de saída. */
function processoFalso() {
  const ouvintes = new Map<string, () => void>()
  const saidas: number[] = []
  return {
    processo: {
      on(evento: string, ouvinte: () => void) {
        ouvintes.set(evento, ouvinte)
      },
      exit(codigo = 0) {
        saidas.push(codigo)
      },
    },
    sinalizar: (evento: string) => ouvintes.get(evento)?.(),
    eventos: () => [...ouvintes.keys()],
    saidas,
  }
}

describe('instalarEncerramento', () => {
  it('escuta SIGTERM e SIGINT', () => {
    const { processo, eventos } = processoFalso()
    instalarEncerramento(criarLoopFalso(), { processo, limiteMs: 1000, atraso: () => never() })
    expect(eventos()).toEqual(['SIGTERM', 'SIGINT'])
  })

  it('SIGTERM encerra o loop e sai com 0', async () => {
    const { processo, sinalizar, saidas } = processoFalso()
    const loop = criarLoopFalso()

    instalarEncerramento(loop, { processo, limiteMs: 1000, atraso: () => never() })
    sinalizar('SIGTERM')
    await escoar()

    expect(loop.encerrar).toHaveBeenCalledOnce()
    expect(saidas).toEqual([0])
  })

  it('SIGINT tem o mesmo efeito — Ctrl+C no terminal não corta um envio', async () => {
    const { processo, sinalizar, saidas } = processoFalso()
    const loop = criarLoopFalso()

    instalarEncerramento(loop, { processo, limiteMs: 1000, atraso: () => never() })
    sinalizar('SIGINT')
    await escoar()

    expect(saidas).toEqual([0])
  })

  it('o segundo sinal força a saída sem esperar o ciclo', async () => {
    const { processo, sinalizar, saidas } = processoFalso()
    const loop = criarLoopFalso(never())

    instalarEncerramento(loop, { processo, limiteMs: 1000, atraso: () => never() })
    sinalizar('SIGTERM')
    await escoar()
    expect(saidas).toEqual([])

    sinalizar('SIGTERM')
    expect(saidas).toEqual([1])
  })

  it('sai mesmo se o ciclo travar além do limite — o orquestrador não pode esperar para sempre', async () => {
    // Sem isto, um `fetch` pendurado no provedor faria o Coolify escalar para
    // SIGKILL, que é justamente o caso que deixa job preso em `enviando`.
    const { processo, sinalizar, saidas } = processoFalso()
    const limite = promessaControlada()
    const loop = criarLoopFalso(never())

    instalarEncerramento(loop, { processo, limiteMs: 20_000, atraso: () => limite.promessa })
    sinalizar('SIGTERM')
    await escoar()
    expect(saidas).toEqual([])

    limite.resolver()
    await escoar()
    expect(saidas).toEqual([1])
  })
})

function criarLoopFalso(espera: Promise<void> = Promise.resolve()) {
  return {
    iniciar: vi.fn(),
    encerrar: vi.fn().mockReturnValue(espera),
    emAndamento: vi.fn().mockReturnValue(false),
  }
}

/** Promessa que nunca resolve — o ciclo que ficou pendurado no provedor. */
function never(): Promise<void> {
  return new Promise<void>(() => {})
}
