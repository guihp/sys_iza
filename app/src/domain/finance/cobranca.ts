/**
 * Composição e parcelas de uma cobrança ligada ao atendimento.
 *
 * Puro: sem I/O. Regra: entrada + próxima + parcelado = total clínico
 * + juros da maquininha quando repassados ao cliente (±1 centavo).
 */

export type FormaEntrada = 'pix' | 'dinheiro' | 'debito' | 'credito' | 'outro'

/** Como o restante após a entrada será pago (PIX à vista / cartão na maquininha). */
export type FormaRestante = 'pix' | 'cartao'

export type StatusCobranca = 'em_aberto' | 'parcial' | 'quitado'

export type StatusParcela = 'pendente' | 'pago' | 'atrasado'

export type ComposicaoCobranca = {
  valor_total_centavos: number
  valor_entrada_centavos: number
  valor_proxima_consulta_centavos: number
  valor_parcelado_centavos: number
  juros_maquininha_centavos: number
  juros_repassados_ao_cliente: boolean
  /** Obrigatório ≥ 1 quando `valor_parcelado_centavos > 0`. */
  parcelas_qtd?: number
}

export type ResultadoValidacao =
  | { ok: true }
  | {
      ok: false
      /** Soma entrada + próxima + parcelado fora do alvo (±1). */
      codigo: 'composicao'
      soma: number
      alvo: number
    }
  | { ok: false; codigo: 'regra'; erro: string }

export type ParcelaGerada = {
  numero: number
  valor_centavos: number
  vencimento: string
}

/**
 * Mensagem amigável (pt-BR) a partir do resultado de `validarComposicao`.
 * `formatarCentavos` deve devolver algo como `R$ 6.800,00` — nunca centavos crus.
 */
export function mensagemErroCobranca(
  resultado: Exclude<ResultadoValidacao, { ok: true }>,
  formatarCentavos: (centavos: number) => string,
): string {
  if (resultado.codigo === 'composicao') {
    return (
      `A soma (entrada + próxima + parcelado) está em ${formatarCentavos(resultado.soma)}, ` +
      `mas o total é ${formatarCentavos(resultado.alvo)}. Ajuste os valores.`
    )
  }
  return resultado.erro
}

/** Total que a paciente deve cobrir no recebimento (clínico + juros repassados). */
export function alvoRecebimentoCentavos(c: ComposicaoCobranca): number {
  const total = inteiroNaoNegativo(c.valor_total_centavos)
  const juros = inteiroNaoNegativo(c.juros_maquininha_centavos)
  return total + (c.juros_repassados_ao_cliente ? juros : 0)
}

/**
 * Valor residual da próxima consulta: o que falta após entrada e parcelado.
 * `max(0, alvoRecebimento − entrada − parcelado)`.
 */
export function proximaConsultaCentavos(
  c: Pick<
    ComposicaoCobranca,
    | 'valor_total_centavos'
    | 'valor_entrada_centavos'
    | 'valor_parcelado_centavos'
    | 'juros_maquininha_centavos'
    | 'juros_repassados_ao_cliente'
  >,
): number {
  const alvo = alvoRecebimentoCentavos({
    valor_total_centavos: c.valor_total_centavos,
    valor_entrada_centavos: 0,
    valor_proxima_consulta_centavos: 0,
    valor_parcelado_centavos: 0,
    juros_maquininha_centavos: c.juros_maquininha_centavos,
    juros_repassados_ao_cliente: c.juros_repassados_ao_cliente,
  })
  return Math.max(
    0,
    alvo -
      inteiroNaoNegativo(c.valor_entrada_centavos) -
      inteiroNaoNegativo(c.valor_parcelado_centavos),
  )
}

/**
 * Redistribui o residual após a entrada entre próxima consulta e parcelado
 * conforme a forma do restante.
 *
 * - `pix` / `null`: parcelado = 0, próxima = residual (entrada + PIX restante).
 * - `cartao`: parcelado = residual − próxima reservada (próxima default 0).
 */
export function composicaoPorFormaRestante(args: {
  forma_restante: FormaRestante | null | undefined
  valor_total_centavos: number
  valor_entrada_centavos: number
  juros_maquininha_centavos?: number
  juros_repassados_ao_cliente?: boolean
  /** Só em cartão: valor já reservado para próxima (default 0). */
  valor_proxima_consulta_centavos?: number
}): {
  valor_proxima_consulta_centavos: number
  valor_parcelado_centavos: number
} {
  const residual = proximaConsultaCentavos({
    valor_total_centavos: args.valor_total_centavos,
    valor_entrada_centavos: args.valor_entrada_centavos,
    valor_parcelado_centavos: 0,
    juros_maquininha_centavos: args.juros_maquininha_centavos ?? 0,
    juros_repassados_ao_cliente: args.juros_repassados_ao_cliente ?? false,
  })

  if (args.forma_restante === 'cartao') {
    const proxima = Math.min(
      residual,
      inteiroNaoNegativo(args.valor_proxima_consulta_centavos ?? 0),
    )
    return {
      valor_proxima_consulta_centavos: proxima,
      valor_parcelado_centavos: residual - proxima,
    }
  }

  return {
    valor_proxima_consulta_centavos: residual,
    valor_parcelado_centavos: 0,
  }
}

/**
 * Valida composição do recebimento e regras de parcelas.
 * Tolerância de ±1 centavo na soma entrada + próxima + parcelado vs alvo.
 */
export function validarComposicao(c: ComposicaoCobranca): ResultadoValidacao {
  const campos: Array<[string, number]> = [
    ['total', c.valor_total_centavos],
    ['entrada', c.valor_entrada_centavos],
    ['próxima consulta', c.valor_proxima_consulta_centavos],
    ['parcelado', c.valor_parcelado_centavos],
    ['juros da maquininha', c.juros_maquininha_centavos],
  ]
  for (const [nome, valor] of campos) {
    if (!Number.isFinite(valor) || !Number.isInteger(valor) || valor < 0) {
      return {
        ok: false,
        codigo: 'regra',
        erro: `O valor de ${nome} precisa ser um número inteiro em centavos, sem negativo.`,
      }
    }
  }

  const soma =
    c.valor_entrada_centavos +
    c.valor_proxima_consulta_centavos +
    c.valor_parcelado_centavos
  const alvo = alvoRecebimentoCentavos(c)
  if (Math.abs(soma - alvo) > 1) {
    return { ok: false, codigo: 'composicao', soma, alvo }
  }

  if (c.valor_parcelado_centavos > 0) {
    const qtd = c.parcelas_qtd
    if (qtd == null || !Number.isInteger(qtd) || qtd < 1) {
      return {
        ok: false,
        codigo: 'regra',
        erro: 'Informe o número de parcelas (pelo menos 1) quando houver valor parcelado.',
      }
    }
    if (qtd > 4) {
      return {
        ok: false,
        codigo: 'regra',
        erro: 'No cartão o máximo é 4 parcelas (taxas da maquininha).',
      }
    }
    // Cada parcela precisa de ≥ 1 centavo (constraint do banco).
    if (c.valor_parcelado_centavos < qtd) {
      return {
        ok: false,
        codigo: 'regra',
        erro: 'O valor parcelado é baixo demais para essa quantidade de parcelas.',
      }
    }
  }

  return { ok: true }
}

/**
 * Gera N parcelas iguais; o resto dos centavos fica na última.
 * `primeiroVencimento` em `YYYY-MM-DD`; demais vencimentos +1 mês cada.
 */
export function gerarParcelas(
  valorParceladoCentavos: number,
  parcelasQtd: number,
  primeiroVencimento: string,
): ParcelaGerada[] {
  if (
    !Number.isInteger(valorParceladoCentavos) ||
    valorParceladoCentavos <= 0 ||
    !Number.isInteger(parcelasQtd) ||
    parcelasQtd < 1 ||
    valorParceladoCentavos < parcelasQtd
  ) {
    return []
  }
  if (!parseIsoDate(primeiroVencimento)) return []

  const base = Math.floor(valorParceladoCentavos / parcelasQtd)
  const resto = valorParceladoCentavos - base * parcelasQtd
  const out: ParcelaGerada[] = []
  for (let i = 0; i < parcelasQtd; i++) {
    const valor = i === parcelasQtd - 1 ? base + resto : base
    out.push({
      numero: i + 1,
      valor_centavos: valor,
      vencimento: adicionarMeses(primeiroVencimento, i),
    })
  }
  return out
}

/**
 * Status da cobrança a partir da entrada (já recebida no registro),
 * valor em aberto na próxima consulta e estado das parcelas.
 *
 * - `quitado`: próxima = 0 e todas as parcelas pagas (ou sem parcelas)
 * - `parcial`: houve entrada > 0 ou alguma parcela paga, ainda há saldo
 * - `em_aberto`: nada recebido ainda
 */
export function statusCobranca(args: {
  valor_entrada_centavos: number
  valor_proxima_consulta_centavos: number
  parcelas: ReadonlyArray<{ status: StatusParcela }>
}): StatusCobranca {
  const entrada = inteiroNaoNegativo(args.valor_entrada_centavos)
  const proxima = inteiroNaoNegativo(args.valor_proxima_consulta_centavos)
  const parcelas = args.parcelas
  const todasPagas = parcelas.length === 0 || parcelas.every((p) => p.status === 'pago')
  const algumaPaga = parcelas.some((p) => p.status === 'pago')

  if (proxima === 0 && todasPagas) return 'quitado'
  if (entrada > 0 || algumaPaga) return 'parcial'
  return 'em_aberto'
}

/** Status de uma parcela em função de pagamento e vencimento (dia da clínica). */
export function statusParcela(args: {
  vencimento: string
  pago_em: string | null | undefined
  hoje: string
}): StatusParcela {
  if (args.pago_em) return 'pago'
  if (!parseIsoDate(args.vencimento) || !parseIsoDate(args.hoje)) return 'pendente'
  if (args.hoje > args.vencimento) return 'atrasado'
  return 'pendente'
}

function inteiroNaoNegativo(valor: number): number {
  if (!Number.isFinite(valor) || !Number.isInteger(valor) || valor < 0) return 0
  return valor
}

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  const data = new Date(Date.UTC(y, m - 1, d))
  if (
    data.getUTCFullYear() !== y ||
    data.getUTCMonth() !== m - 1 ||
    data.getUTCDate() !== d
  ) {
    return null
  }
  return { y, m, d }
}

/** Soma meses preservando o dia quando possível; senão usa o último dia do mês. */
function adicionarMeses(iso: string, meses: number): string {
  const parsed = parseIsoDate(iso)
  if (!parsed) return iso
  const alvoMes = parsed.m - 1 + meses
  const y = parsed.y + Math.floor(alvoMes / 12)
  const m = ((alvoMes % 12) + 12) % 12
  const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const d = Math.min(parsed.d, ultimoDia)
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
