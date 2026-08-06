/**
 * O laço do worker e o encerramento limpo.
 *
 * Separado de `worker/index.ts` para poder ser testado: o que este arquivo
 * garante — não sobrepor ciclos, não morrer por exceção, não ser cortado no meio
 * de um envio — só apareceria em produção se estivesse misturado com a fiação do
 * Supabase e dos provedores.
 *
 * Nada aqui conhece lembrete. O ciclo é uma função assíncrona qualquer.
 */

/** Relógio injetável. Em produção é `setTimeout`; no teste, um manual. */
export type Relogio = {
  agendar(acao: () => void, ms: number): unknown
  cancelar(marcador: unknown): void
}

export const relogioDoSistema: Relogio = {
  agendar: (acao, ms) => setTimeout(acao, ms),
  cancelar: (marcador) => clearTimeout(marcador as ReturnType<typeof setTimeout>),
}

export type OpcoesDoLoop = {
  intervaloMs: number
  ciclo: () => Promise<void> | void
  relogio?: Relogio
  /** Chamado quando o ciclo lança. O loop segue de pé. */
  aoFalhar?: (causa: unknown) => void
}

export type Loop = {
  iniciar(): void
  /** Pede parada e resolve quando o ciclo em andamento terminar. */
  encerrar(): Promise<void>
  emAndamento(): boolean
}

/**
 * Cria o laço.
 *
 * O próximo ciclo é agendado com `setTimeout` **depois** que o anterior termina,
 * e não com `setInterval`. A diferença importa: `setInterval` dispara pelo
 * relógio, sem olhar se o ciclo anterior acabou, e uma fila grande ou um
 * provedor lento fariam dois ciclos correrem juntos dentro do mesmo processo —
 * reproduzindo internamente a corrida que a reserva no banco existe para
 * eliminar. Com o encadeamento, existe no máximo um ciclo por vez, sempre.
 *
 * O período passa a ser "intervalo entre o fim de um e o começo do outro", que é
 * o que se quer de um worker de fila: se um ciclo levar dois minutos, o próximo
 * sai cinco minutos depois dele, não três.
 */
export function criarLoop(opcoes: OpcoesDoLoop): Loop {
  const relogio = opcoes.relogio ?? relogioDoSistema
  const aoFalhar = opcoes.aoFalhar ?? (() => {})

  let iniciado = false
  let parando = false
  let marcador: unknown = null
  let cicloAtual: Promise<void> | null = null

  async function rodar(): Promise<void> {
    marcador = null
    if (parando) return

    // O `try` embrulha a CHAMADA e não só o `await`: um ciclo que lance
    // sincronamente, antes do primeiro `await`, escaparia de um `try` posto só
    // em volta da espera e mataria o processo com uma rejeição não tratada.
    cicloAtual = (async () => {
      try {
        await opcoes.ciclo()
      } catch (causa) {
        aoFalhar(causa)
      }
    })()

    await cicloAtual
    cicloAtual = null

    // Reavaliado depois do ciclo: o SIGTERM pode ter chegado enquanto ele rodava,
    // e agendar aqui deixaria um timer vivo segurando o processo de pé.
    if (!parando) marcador = relogio.agendar(() => void rodar(), opcoes.intervaloMs)
  }

  return {
    iniciar() {
      if (iniciado) return
      iniciado = true
      void rodar()
    },

    async encerrar() {
      parando = true
      if (marcador !== null) {
        relogio.cancelar(marcador)
        marcador = null
      }
      // O ciclo em andamento é aguardado, nunca interrompido. Cortá-lo no meio
      // deixaria um job reservado com a mensagem já entregue e sem ninguém para
      // gravar o `provider_message_id` — o estado que exige gente para desfazer.
      if (cicloAtual) await cicloAtual
    },

    emAndamento: () => cicloAtual !== null,
  }
}

/** O mínimo de `process` que o encerramento usa. Injetável para teste. */
export type ProcessoDoWorker = {
  on(evento: string, ouvinte: () => void): unknown
  exit(codigo?: number): unknown
}

export type OpcoesDeEncerramento = {
  processo?: ProcessoDoWorker
  /** Quanto esperar o ciclo em andamento antes de sair à força. */
  limiteMs?: number
  atraso?: (ms: number) => Promise<void>
  registrar?: (mensagem: string) => void
}

/**
 * Tempo que o encerramento espera pelo ciclo em curso.
 *
 * Vinte segundos, abaixo dos trinta que orquestradores de container costumam dar
 * entre `SIGTERM` e `SIGKILL`. A margem é o ponto: sair por conta própria é
 * melhor que ser morto, porque o `SIGKILL` chega no meio de um envio e deixa o
 * job preso em `enviando`. Vinte segundos também cobrem com folga o pior caso
 * real — um envio esperando o timeout de 15s de `TIMEOUT_PADRAO_MS`.
 */
export const LIMITE_DE_ENCERRAMENTO_MS = 20_000

/**
 * Liga SIGTERM e SIGINT ao encerramento do loop.
 *
 * SIGTERM é o deploy do Coolify; SIGINT é o Ctrl+C de quem está rodando o worker
 * na mão. Os dois têm o mesmo tratamento — não há motivo para o Ctrl+C cortar um
 * envio pela metade.
 *
 * O segundo sinal força a saída. É a válvula para quando algo travou de verdade
 * e a pessoa no terminal quer o processo morto agora, sem esperar o limite.
 */
export function instalarEncerramento(loop: Loop, opcoes: OpcoesDeEncerramento = {}): void {
  const processo = opcoes.processo ?? (process as unknown as ProcessoDoWorker)
  const limiteMs = opcoes.limiteMs ?? LIMITE_DE_ENCERRAMENTO_MS
  const atraso = opcoes.atraso ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const registrar = opcoes.registrar ?? ((m: string) => console.log(m))

  let pedido = false

  for (const sinal of ['SIGTERM', 'SIGINT']) {
    processo.on(sinal, () => {
      if (pedido) {
        registrar(`[lembretes] ${sinal} de novo — saindo à força`)
        processo.exit(1)
        return
      }
      pedido = true
      registrar(`[lembretes] ${sinal} recebido, terminando o ciclo em andamento`)

      void (async () => {
        // Corrida entre "o ciclo terminou" e "o tempo acabou". Quem chegar
        // primeiro decide o código de saída, e o 1 do estouro é informação real
        // para quem for ler o log: alguma coisa ficou pendurada.
        const saiuLimpo = await Promise.race([
          loop.encerrar().then(() => true),
          atraso(limiteMs).then(() => false),
        ])

        if (saiuLimpo) {
          registrar('[lembretes] worker encerrado')
          processo.exit(0)
        } else {
          registrar(`[lembretes] ciclo não terminou em ${limiteMs} ms — saindo assim mesmo`)
          processo.exit(1)
        }
      })()
    })
  }
}
