// @vitest-environment node
/**
 * O cruzamento gasto × desfecho, e as divisões por zero que ele carrega.
 *
 * Este arquivo existe por causa de uma decisão do dono que atravessa o projeto:
 * **o banco está vazio e vai continuar vazio.** Toda razão desta tela tem
 * denominador que pode ser zero — CAC com zero paciente, ROI com zero gasto,
 * taxa de agendamento com zero lead — e nenhuma delas pode chegar à tela como
 * `NaN` ou `Infinity`.
 *
 * O outro fio é a contagem acumulada do funil: `patients.stage` guarda onde a
 * paciente está AGORA, e não por onde passou. Contar só o estágio corrente diria
 * que ninguém agendou num anúncio que fechou três pacientes.
 */
import { describe, expect, it } from 'vitest'
import {
  agruparDesfechos,
  cruzar,
  dividir,
  janelaDoPeriodo,
  periodoDaUrl,
  PERIODO_PADRAO,
  totalizar,
  type AtribuicaoDoBanco,
  type DesfechoDoAnuncio,
} from '@/app/(app)/marketing/cruzamento'
import {
  formatarInteiro,
  formatarMoeda,
  formatarMoedaRedonda,
  formatarOrigem,
  formatarRoi,
  formatarTaxa,
  TRACINHO,
} from '@/app/(app)/marketing/formatacao'
import type { InsightDoAnuncio } from '@/integrations/meta/marketing-api'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

function insight(parcial: Partial<InsightDoAnuncio> & { adId: string }): InsightDoAnuncio {
  return {
    adNome: `Anúncio ${parcial.adId}`,
    campanhaId: null,
    campanhaNome: null,
    gastoCentavos: 0,
    impressoes: 0,
    cliques: 0,
    conversas: 0,
    ...parcial,
  }
}

function atribuicao(parcial: Partial<AtribuicaoDoBanco> & { adId: string }): AtribuicaoDoBanco {
  return { adTitle: null, sourceApp: null, patientId: null, stage: null, ...parcial }
}

function desfecho(parcial: Partial<DesfechoDoAnuncio> & { adId: string }): DesfechoDoAnuncio {
  return {
    adTitle: null,
    sourceApp: null,
    leads: 0,
    agendaram: 0,
    compareceram: 0,
    pacientes: 0,
    receitaCentavos: 0,
    ...parcial,
  }
}

// ---------------------------------------------------------------------------
// A contagem acumulada do funil
// ---------------------------------------------------------------------------

describe('agruparDesfechos', () => {
  it('conta acumulado: quem compareceu também agendou', () => {
    // O erro que este teste trava: contar `agendaram` como "está em agendado"
    // zeraria a coluna justamente no anúncio que deu certo, porque quem foi
    // adiante já saiu daquele estágio.
    const desfechos = agruparDesfechos(
      [
        atribuicao({ adId: 'A', patientId: 'p1', stage: 'lead' }),
        atribuicao({ adId: 'A', patientId: 'p2', stage: 'agendado' }),
        atribuicao({ adId: 'A', patientId: 'p3', stage: 'compareceu' }),
        atribuicao({ adId: 'A', patientId: 'p4', stage: 'paciente' }),
      ],
      new Map(),
    )

    expect(desfechos[0]).toMatchObject({
      leads: 4,
      agendaram: 3,
      compareceram: 2,
      pacientes: 1,
    })
  })

  it('conta `retorno` como paciente, e não como uma sexta etapa', () => {
    // Retorno é retenção, não aquisição. Contá-la à parte inflaria o anúncio,
    // que já foi creditado quando a pessoa virou paciente.
    const [linha] = agruparDesfechos(
      [atribuicao({ adId: 'A', patientId: 'p1', stage: 'retorno' })],
      new Map(),
    )
    expect(linha.pacientes).toBe(1)
    expect(linha.agendaram).toBe(1)
  })

  it('quem foi descartada continua contando como lead, mas não como agendamento', () => {
    // O dinheiro do anúncio foi gasto de qualquer jeito: esconder o lead
    // descartado faria a taxa de agendamento parecer melhor do que é.
    const [linha] = agruparDesfechos(
      [atribuicao({ adId: 'A', patientId: 'p1', stage: 'descartado' })],
      new Map(),
    )
    expect(linha.leads).toBe(1)
    expect(linha.agendaram).toBe(0)
    expect(linha.pacientes).toBe(0)
  })

  it('conta como lead quem ainda não virou cadastro', () => {
    // A mensagem chega antes de a paciente existir no sistema: é o caso normal.
    const [linha] = agruparDesfechos([atribuicao({ adId: 'A' })], new Map())
    expect(linha.leads).toBe(1)
    expect(linha.pacientes).toBe(0)
  })

  it('soma a receita uma vez por paciente, mesmo com duas atribuições', () => {
    // A migration 0010 prevê o caso: a pessoa fala do próprio número e do
    // número do marido, e vira duas linhas apontando para o mesmo cadastro.
    // Somar duas vezes dobraria a receita atribuída e o ROI junto.
    const [linha] = agruparDesfechos(
      [
        atribuicao({ adId: 'A', patientId: 'p1', stage: 'paciente' }),
        atribuicao({ adId: 'A', patientId: 'p1', stage: 'paciente' }),
      ],
      new Map([['p1', 184_700]]),
    )
    expect(linha.receitaCentavos).toBe(184_700)
    expect(linha.leads).toBe(2)
  })

  it('separa por anúncio e guarda o título do primeiro que tiver um', () => {
    const desfechos = agruparDesfechos(
      [
        atribuicao({ adId: 'A', adTitle: null }),
        atribuicao({ adId: 'A', adTitle: 'Botox 15s', sourceApp: 'instagram' }),
        atribuicao({ adId: 'B', adTitle: 'Preenchimento' }),
      ],
      new Map(),
    )

    expect(desfechos).toHaveLength(2)
    expect(desfechos[0]).toMatchObject({ adId: 'A', adTitle: 'Botox 15s', sourceApp: 'instagram' })
  })

  it('banco vazio devolve lista vazia — o estado de hoje', () => {
    expect(agruparDesfechos([], new Map())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// A divisão por zero, que é o risco desta tela
// ---------------------------------------------------------------------------

describe('dividir', () => {
  it('devolve null com denominador zero, e não Infinity', () => {
    expect(dividir(17996, 0)).toBeNull()
  })

  it('devolve zero quando o numerador é zero e o denominador não', () => {
    // Zero e "não dá para dizer" são coisas diferentes, e a tela distingue.
    expect(dividir(0, 3)).toBe(0)
  })

  it('não deixa NaN passar por dentro', () => {
    expect(dividir(Number.NaN, 3)).toBeNull()
    expect(dividir(3, Number.NaN)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CAC e ROI
// ---------------------------------------------------------------------------

describe('cruzar', () => {
  it('calcula CAC e ROI quando há gasto e paciente', () => {
    const [linha] = cruzar(
      [insight({ adId: 'A', gastoCentavos: 17_996, conversas: 24 })],
      [desfecho({ adId: 'A', leads: 24, agendaram: 6, pacientes: 2, receitaCentavos: 40_000 })],
    )

    // CAC real: R$ 179,96 ÷ 2 pacientes = R$ 89,98.
    expect(linha.cacCentavos).toBe(8_998)
    // ROI: R$ 400,00 ÷ R$ 179,96 = 2,22…
    expect(linha.roi).toBeCloseTo(2.2227, 3)
    expect(linha.custoPorConversaCentavos).toBe(750)
    expect(linha.taxaLeadAgendado).toBeCloseTo(0.25, 5)
  })

  it('CAC é null com zero paciente — gastou e ninguém converteu ainda', () => {
    // `Infinity` seria o valor matematicamente certo e a leitura errada: não é
    // que a paciente custou infinito, é que não houve paciente para dividir.
    const [linha] = cruzar([insight({ adId: 'A', gastoCentavos: 17_996 })], [])
    expect(linha.cacCentavos).toBeNull()
    expect(Number.isNaN(linha.cacCentavos as unknown as number)).toBe(false)
  })

  it('ROI é null com zero gasto — anúncio pausado que ainda traz lead', () => {
    const [linha] = cruzar([], [desfecho({ adId: 'A', leads: 1, receitaCentavos: 40_000 })])
    expect(linha.roi).toBeNull()
    expect(linha.gastoCentavos).toBe(0)
  })

  it('taxa lead → agendado é null sem lead', () => {
    const [linha] = cruzar([insight({ adId: 'A', gastoCentavos: 500 })], [])
    expect(linha.taxaLeadAgendado).toBeNull()
  })

  it('custo por conversa é null sem conversa', () => {
    const [linha] = cruzar([insight({ adId: 'A', gastoCentavos: 8_147, conversas: 0 })], [])
    expect(linha.custoPorConversaCentavos).toBeNull()
  })

  it('banco vazio e conta zerada não produzem NaN em campo nenhum', () => {
    const [linha] = cruzar([insight({ adId: 'A' })], [desfecho({ adId: 'A' })])
    for (const [chave, valor] of Object.entries(linha)) {
      if (typeof valor === 'number') {
        expect(Number.isNaN(valor), `${chave} virou NaN`).toBe(false)
        expect(Number.isFinite(valor), `${chave} virou Infinity`).toBe(true)
      }
    }
  })

  it('mostra o anúncio que gastou e não trouxe ninguém', () => {
    // É o caso da campanha de tráfego para o Instagram: visita de perfil não
    // deixa `ctwa_clid`, então ela aparece com desfecho zerado. Isso é esperado,
    // não é bug — e some da tela seria esconder gasto.
    const [linha] = cruzar([insight({ adId: 'A', gastoCentavos: 8_147, cliques: 402 })], [])
    expect(linha).toMatchObject({ leads: 0, pacientes: 0, receitaCentavos: 0, cliques: 402 })
  })

  it('mostra o lead cujo anúncio não veio da Meta no período', () => {
    // Clique antigo, fora da janela consultada. Sumir com ele esconderia
    // paciente conquistada.
    const [linha] = cruzar([], [desfecho({ adId: 'B', adTitle: 'Botox', leads: 3, pacientes: 1 })])
    expect(linha.adId).toBe('B')
    expect(linha.anuncio).toBe('Botox')
    expect(linha.gastoCentavos).toBe(0)
  })

  it('ordena por gasto, e o desempate é por paciente', () => {
    const linhas = cruzar(
      [
        insight({ adId: 'A', gastoCentavos: 100 }),
        insight({ adId: 'B', gastoCentavos: 900 }),
        insight({ adId: 'C', gastoCentavos: 900 }),
      ],
      [desfecho({ adId: 'C', leads: 1, pacientes: 1 })],
    )
    expect(linhas.map((linha) => linha.adId)).toEqual(['C', 'B', 'A'])
  })

  it('sem nada dos dois lados devolve tabela vazia', () => {
    expect(cruzar([], [])).toEqual([])
  })
})

describe('totalizar', () => {
  it('calcula CAC e ROI do total a partir das somas, não como média de razões', () => {
    // Média de razões é a armadilha clássica: um anúncio de R$ 5 que trouxe uma
    // paciente puxaria a média com o mesmo peso de outro de R$ 500 que trouxe
    // dez. O total é gasto total ÷ pacientes totais.
    const linhas = cruzar(
      [
        insight({ adId: 'A', gastoCentavos: 500 }),
        insight({ adId: 'B', gastoCentavos: 50_000 }),
      ],
      [
        desfecho({ adId: 'A', leads: 1, pacientes: 1, receitaCentavos: 10_000 }),
        desfecho({ adId: 'B', leads: 30, pacientes: 10, receitaCentavos: 100_000 }),
      ],
    )

    const totais = totalizar(linhas)
    expect(totais.gastoCentavos).toBe(50_500)
    expect(totais.pacientes).toBe(11)
    // 50500 ÷ 11 = 4590,9… → 4591 centavos. Não é a média de 500 e 5000.
    expect(totais.cacCentavos).toBe(4_591)
    expect(totais.roi).toBeCloseTo(110_000 / 50_500, 5)
  })

  it('tabela vazia devolve zeros e travessões, nunca NaN', () => {
    const totais = totalizar([])
    expect(totais.gastoCentavos).toBe(0)
    expect(totais.pacientes).toBe(0)
    expect(totais.cacCentavos).toBeNull()
    expect(totais.roi).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

describe('periodoDaUrl', () => {
  it('aceita as janelas oferecidas', () => {
    expect(periodoDaUrl('7')).toBe(7)
    expect(periodoDaUrl('90')).toBe(90)
  })

  it('cai no padrão para lixo, ausência ou valor não oferecido', () => {
    expect(periodoDaUrl(undefined)).toBe(PERIODO_PADRAO)
    expect(periodoDaUrl('sei lá')).toBe(PERIODO_PADRAO)
    expect(periodoDaUrl('365')).toBe(PERIODO_PADRAO)
  })
})

describe('janelaDoPeriodo', () => {
  it('inclui hoje na contagem', () => {
    // "Últimos 7 dias" é hoje e os seis anteriores. Sem o `-1` a tela mostraria
    // um dia a mais de gasto do que o rótulo promete.
    expect(janelaDoPeriodo('2026-08-06', 7)).toEqual({ desde: '2026-07-31', ate: '2026-08-06' })
  })

  it('atravessa a virada do mês', () => {
    expect(janelaDoPeriodo('2026-08-06', 30)).toEqual({ desde: '2026-07-08', ate: '2026-08-06' })
  })
})

// ---------------------------------------------------------------------------
// Formatação: `0` ou `—`, nunca `NaN`
// ---------------------------------------------------------------------------

describe('formatação', () => {
  it('escreve travessão para o que não dá para dizer', () => {
    expect(formatarMoeda(null)).toBe(TRACINHO)
    expect(formatarMoedaRedonda(null)).toBe(TRACINHO)
    expect(formatarRoi(null)).toBe(TRACINHO)
    expect(formatarTaxa(null)).toBe(TRACINHO)
  })

  it('escreve zero para o que é zero de verdade', () => {
    // Anúncio pausado gastou R$ 0 — é fato, não ausência.
    expect(formatarMoeda(0)).toBe('R$ 0,00')
    expect(formatarInteiro(0)).toBe('0')
    expect(formatarTaxa(0)).toBe('0%')
  })

  it('nunca escreve NaN, nem quando um número torto chega até aqui', () => {
    expect(formatarMoeda(Number.NaN)).toBe(TRACINHO)
    expect(formatarRoi(Number.POSITIVE_INFINITY)).toBe(TRACINHO)
    expect(formatarTaxa(Number.NaN)).toBe(TRACINHO)
    expect(formatarInteiro(Number.NaN)).toBe('0')
  })

  it('usa espaço comum depois do R$, e não o não separável do Intl', () => {
    // `Intl.NumberFormat('pt-BR')` usa U+00A0, e duas strings que parecem
    // iguais falham na comparação. A troca acontece uma vez, na formatação.
    expect(formatarMoeda(17_996)).toBe('R$ 179,96')
    expect(formatarMoeda(17_996)).not.toContain('\u00A0')
    expect(formatarMoedaRedonda(17_996)).toBe('R$ 180')
  })

  it('escreve ROI como múltiplo, com vírgula decimal', () => {
    expect(formatarRoi(2.2227)).toBe('2,2×')
  })

  it('traduz a origem do anúncio, e omite o que não conhece', () => {
    expect(formatarOrigem('instagram')).toBe('Instagram')
    expect(formatarOrigem('facebook')).toBe('Facebook')
    expect(formatarOrigem(null)).toBeNull()
  })
})
