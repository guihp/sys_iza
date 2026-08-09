import { describe, expect, it } from 'vitest'
import {
  alvoRecebimentoCentavos,
  composicaoPorFormaRestante,
  gerarParcelas,
  mensagemErroCobranca,
  proximaConsultaCentavos,
  statusCobranca,
  statusParcela,
  validarComposicao,
  type ComposicaoCobranca,
} from '@/domain/finance/cobranca'

function base(parcial: Partial<ComposicaoCobranca> = {}): ComposicaoCobranca {
  return {
    valor_total_centavos: 10000,
    valor_entrada_centavos: 10000,
    valor_proxima_consulta_centavos: 0,
    valor_parcelado_centavos: 0,
    juros_maquininha_centavos: 0,
    juros_repassados_ao_cliente: false,
    ...parcial,
  }
}

describe('alvoRecebimentoCentavos + validarComposicao', () => {
  it('aceita composição que fecha o total', () => {
    expect(validarComposicao(base())).toEqual({ ok: true })
    expect(
      validarComposicao(
        base({
          valor_entrada_centavos: 3000,
          valor_proxima_consulta_centavos: 2000,
          valor_parcelado_centavos: 5000,
          parcelas_qtd: 2,
        }),
      ),
    ).toEqual({ ok: true })
  })

  it('soma juros ao alvo quando repassados', () => {
    const c = base({
      valor_total_centavos: 10000,
      juros_maquininha_centavos: 300,
      juros_repassados_ao_cliente: true,
      valor_entrada_centavos: 10300,
    })
    expect(alvoRecebimentoCentavos(c)).toBe(10300)
    expect(validarComposicao(c)).toEqual({ ok: true })
  })

  it('não soma juros quando não repassados', () => {
    const c = base({
      juros_maquininha_centavos: 300,
      juros_repassados_ao_cliente: false,
      valor_entrada_centavos: 10000,
    })
    expect(alvoRecebimentoCentavos(c)).toBe(10000)
    expect(validarComposicao(c)).toEqual({ ok: true })
  })

  it('tolera ±1 centavo e rejeita desvio maior com soma/alvo', () => {
    expect(
      validarComposicao(
        base({
          valor_entrada_centavos: 10001,
        }),
      ),
    ).toEqual({ ok: true })

    const ruim = validarComposicao(
      base({
        valor_entrada_centavos: 5000,
        valor_parcelado_centavos: 0,
      }),
    )
    expect(ruim).toEqual({
      ok: false,
      codigo: 'composicao',
      soma: 5000,
      alvo: 10000,
    })
  })

  it('exige parcelas_qtd quando há valor parcelado', () => {
    const semQtd = validarComposicao(
      base({
        valor_entrada_centavos: 0,
        valor_parcelado_centavos: 10000,
      }),
    )
    expect(semQtd.ok).toBe(false)
    if (!semQtd.ok) expect(semQtd.codigo).toBe('regra')

    expect(
      validarComposicao(
        base({
          valor_entrada_centavos: 0,
          valor_parcelado_centavos: 10000,
          parcelas_qtd: 3,
        }),
      ),
    ).toEqual({ ok: true })
  })

  it('rejeita valores negativos ou não-inteiros', () => {
    expect(validarComposicao(base({ valor_entrada_centavos: -1 })).ok).toBe(false)
    expect(validarComposicao(base({ valor_total_centavos: 10.5 })).ok).toBe(false)
  })
})

describe('mensagemErroCobranca', () => {
  it('formata composição em reais, sem centavos crus', () => {
    const formatar = (c: number) =>
      `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    expect(
      mensagemErroCobranca(
        { ok: false, codigo: 'composicao', soma: 80000, alvo: 680000 },
        formatar,
      ),
    ).toBe(
      'A soma (entrada + próxima + parcelado) está em R$ 800,00, mas o total é R$ 6.800,00. Ajuste os valores.',
    )
  })

  it('repassa mensagem de regra', () => {
    expect(
      mensagemErroCobranca(
        { ok: false, codigo: 'regra', erro: 'Informe o número de parcelas.' },
        () => '',
      ),
    ).toBe('Informe o número de parcelas.')
  })
})

describe('proximaConsultaCentavos', () => {
  it('preenche o restante: total − entrada − parcelado', () => {
    expect(
      proximaConsultaCentavos({
        valor_total_centavos: 10000,
        valor_entrada_centavos: 4000,
        valor_parcelado_centavos: 0,
        juros_maquininha_centavos: 0,
        juros_repassados_ao_cliente: false,
      }),
    ).toBe(6000)

    expect(
      proximaConsultaCentavos({
        valor_total_centavos: 10000,
        valor_entrada_centavos: 3000,
        valor_parcelado_centavos: 5000,
        juros_maquininha_centavos: 0,
        juros_repassados_ao_cliente: false,
      }),
    ).toBe(2000)
  })

  it('inclui juros no alvo quando repassados e nunca fica negativo', () => {
    expect(
      proximaConsultaCentavos({
        valor_total_centavos: 10000,
        valor_entrada_centavos: 5000,
        valor_parcelado_centavos: 0,
        juros_maquininha_centavos: 300,
        juros_repassados_ao_cliente: true,
      }),
    ).toBe(5300)

    expect(
      proximaConsultaCentavos({
        valor_total_centavos: 10000,
        valor_entrada_centavos: 8000,
        valor_parcelado_centavos: 5000,
        juros_maquininha_centavos: 0,
        juros_repassados_ao_cliente: false,
      }),
    ).toBe(0)
  })
})

describe('gerarParcelas', () => {
  it('divide igualmente e joga o resto na última', () => {
    const parcelas = gerarParcelas(10001, 3, '2026-09-01')
    expect(parcelas).toEqual([
      { numero: 1, valor_centavos: 3333, vencimento: '2026-09-01' },
      { numero: 2, valor_centavos: 3333, vencimento: '2026-10-01' },
      { numero: 3, valor_centavos: 3335, vencimento: '2026-11-01' },
    ])
    expect(parcelas.reduce((s, p) => s + p.valor_centavos, 0)).toBe(10001)
  })

  it('ajusta dia em meses curtos', () => {
    const parcelas = gerarParcelas(300, 2, '2026-01-31')
    expect(parcelas[0]!.vencimento).toBe('2026-01-31')
    expect(parcelas[1]!.vencimento).toBe('2026-02-28')
  })

  it('devolve vazio para entrada inválida', () => {
    expect(gerarParcelas(0, 2, '2026-09-01')).toEqual([])
    expect(gerarParcelas(100, 0, '2026-09-01')).toEqual([])
    expect(gerarParcelas(100, 2, '31/09/2026')).toEqual([])
    expect(gerarParcelas(2, 3, '2026-09-01')).toEqual([])
  })
})

describe('statusCobranca + statusParcela', () => {
  it('quitado quando só entrada (sem próxima nem parcelas)', () => {
    expect(
      statusCobranca({
        valor_entrada_centavos: 10000,
        valor_proxima_consulta_centavos: 0,
        parcelas: [],
      }),
    ).toBe('quitado')
  })

  it('parcial com entrada e saldo; em_aberto sem recebimento', () => {
    expect(
      statusCobranca({
        valor_entrada_centavos: 3000,
        valor_proxima_consulta_centavos: 0,
        parcelas: [{ status: 'pendente' }, { status: 'pendente' }],
      }),
    ).toBe('parcial')

    expect(
      statusCobranca({
        valor_entrada_centavos: 0,
        valor_proxima_consulta_centavos: 5000,
        parcelas: [],
      }),
    ).toBe('em_aberto')
  })

  it('quitado quando todas as parcelas pagas e próxima zerada', () => {
    expect(
      statusCobranca({
        valor_entrada_centavos: 1000,
        valor_proxima_consulta_centavos: 0,
        parcelas: [{ status: 'pago' }, { status: 'pago' }],
      }),
    ).toBe('quitado')
  })

  it('statusParcela por pago_em e vencimento', () => {
    expect(
      statusParcela({ vencimento: '2026-08-01', pago_em: '2026-07-30T12:00:00Z', hoje: '2026-08-09' }),
    ).toBe('pago')
    expect(
      statusParcela({ vencimento: '2026-08-01', pago_em: null, hoje: '2026-08-09' }),
    ).toBe('atrasado')
    expect(
      statusParcela({ vencimento: '2026-08-20', pago_em: null, hoje: '2026-08-09' }),
    ).toBe('pendente')
  })
})

describe('composicaoPorFormaRestante', () => {
  it('PIX / null: residual na próxima, parcelado zero', () => {
    expect(
      composicaoPorFormaRestante({
        forma_restante: 'pix',
        valor_total_centavos: 10000,
        valor_entrada_centavos: 3000,
      }),
    ).toEqual({
      valor_proxima_consulta_centavos: 7000,
      valor_parcelado_centavos: 0,
    })

    expect(
      composicaoPorFormaRestante({
        forma_restante: null,
        valor_total_centavos: 10000,
        valor_entrada_centavos: 10000,
      }),
    ).toEqual({
      valor_proxima_consulta_centavos: 0,
      valor_parcelado_centavos: 0,
    })
  })

  it('cartão: residual no parcelado (próxima 0 por padrão)', () => {
    expect(
      composicaoPorFormaRestante({
        forma_restante: 'cartao',
        valor_total_centavos: 10000,
        valor_entrada_centavos: 3000,
      }),
    ).toEqual({
      valor_proxima_consulta_centavos: 0,
      valor_parcelado_centavos: 7000,
    })
  })

  it('cartão respeita próxima reservada e juros repassados', () => {
    expect(
      composicaoPorFormaRestante({
        forma_restante: 'cartao',
        valor_total_centavos: 10000,
        valor_entrada_centavos: 2000,
        valor_proxima_consulta_centavos: 1000,
      }),
    ).toEqual({
      valor_proxima_consulta_centavos: 1000,
      valor_parcelado_centavos: 7000,
    })

    const comJuros = composicaoPorFormaRestante({
      forma_restante: 'cartao',
      valor_total_centavos: 10000,
      valor_entrada_centavos: 3000,
      juros_maquininha_centavos: 200,
      juros_repassados_ao_cliente: true,
    })
    expect(comJuros).toEqual({
      valor_proxima_consulta_centavos: 0,
      valor_parcelado_centavos: 7200,
    })
    expect(
      validarComposicao({
        valor_total_centavos: 10000,
        valor_entrada_centavos: 3000,
        valor_proxima_consulta_centavos: comJuros.valor_proxima_consulta_centavos,
        valor_parcelado_centavos: comJuros.valor_parcelado_centavos,
        juros_maquininha_centavos: 200,
        juros_repassados_ao_cliente: true,
        parcelas_qtd: 2,
      }),
    ).toEqual({ ok: true })
  })
})
