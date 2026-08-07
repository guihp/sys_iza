// @vitest-environment node
/**
 * O carregamento da página de marketing: os três desfechos, e nenhum deles é
 * uma tela quebrada.
 *
 *   1. **desligada** — sem `META_ADS_TOKEN`, que é o estado da clínica hoje. A
 *      rota existe, não chama a Meta e não registra erro nenhum;
 *   2. **ligada e a Meta falhou** — a tabela aparece com o lado do BANCO
 *      preenchido e um aviso no lugar do gasto. Quantas pacientes o anúncio
 *      trouxe é dado nosso e continua válido;
 *   3. **ligada e ok** — as duas metades cruzadas por `ad_id`.
 *
 * O quarto caso, mais silencioso, também está aqui: o banco sem a tabela
 * `lead_attribution` (migration não aplicada — quem escreve o código não aplica
 * migration neste projeto) não pode derrubar a página.
 */
import { describe, expect, it, vi } from 'vitest'
import { carregarMarketing } from '@/app/(app)/marketing/dados'
import { ErroDeEnvio } from '@/integrations/envio'
import type { MarketingApiClient } from '@/integrations/meta/marketing-api'

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

const PERIODO = { desde: '2026-07-08', ate: '2026-08-06' }

type Resposta = { data: unknown; error: { message: string } | null }

/**
 * Supabase fingido: cada tabela devolve uma resposta pronta, e o construtor
 * aceita a cadeia de chamadas que `lib/marketing.ts` usa.
 */
function criarSupabase(respostas: Record<string, Resposta>) {
  const tabelasTocadas: string[] = []

  const from = (tabela: string) => {
    tabelasTocadas.push(tabela)
    const resposta = respostas[tabela] ?? { data: [], error: null }
    const alvo = {
      select: () => alvo,
      not: () => alvo,
      in: () => alvo,
      limit: () => alvo,
      then: (resolver: (valor: Resposta) => unknown) => Promise.resolve(resposta).then(resolver),
    }
    return alvo
  }

  return {
    supabase: { from } as never,
    tabelasTocadas,
  }
}

function criarCliente(parcial: Partial<MarketingApiClient> = {}): MarketingApiClient {
  return {
    insightsPorAnuncio: async () => [],
    estadoDoDataset: async () => null,
    ...parcial,
  }
}

const INSIGHT = {
  adId: 'A1',
  adNome: 'Botox — vídeo 15s',
  campanhaId: 'c1',
  campanhaNome: 'Izadora - Whatsapp - Leads',
  gastoCentavos: 17_996,
  impressoes: 12_345,
  cliques: 402,
  conversas: 24,
}

// ---------------------------------------------------------------------------
// 1. Desligada
// ---------------------------------------------------------------------------

describe('desligada', () => {
  it('não chama a Meta nem o banco quando não há token', async () => {
    const { supabase, tabelasTocadas } = criarSupabase({})
    const insightsPorAnuncio = vi.fn()

    const estado = await carregarMarketing({
      supabase,
      periodo: PERIODO,
      cliente: null,
      datasetId: null,
    })

    expect(estado).toEqual({ ligada: false })
    // Sem credencial não há nada a consultar, e sair cedo é o que permite a
    // página existir indefinidamente sem token — igual ao Google Agenda.
    expect(insightsPorAnuncio).not.toHaveBeenCalled()
    expect(tabelasTocadas).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. Ligada, mas a Meta falhou
// ---------------------------------------------------------------------------

describe('a Meta falhou', () => {
  it('preserva o lado do banco e avisa, em vez de quebrar a página', async () => {
    const { supabase } = criarSupabase({
      lead_attribution: {
        data: [
          { ad_id: 'A1', ad_title: 'Botox', source_app: 'instagram', patient_id: 'p1', patients: { stage: 'paciente' } },
        ],
        error: null,
      },
      attendance_records: {
        data: [{ patient_id: 'p1', procedures: { preco_centavos: 184_700 } }],
        error: null,
      },
    })

    const estado = await carregarMarketing({
      supabase,
      periodo: PERIODO,
      cliente: criarCliente({
        insightsPorAnuncio: async () => {
          throw new ErroDeEnvio('Meta Marketing API respondeu 401', 'credencial')
        },
      }),
      datasetId: null,
    })

    expect(estado.ligada).toBe(true)
    if (!estado.ligada) return

    expect(estado.avisoDaApi).toContain('401')
    expect(estado.linhas).toHaveLength(1)
    // O desfecho clínico é dado nosso e continua correto sem a Meta.
    expect(estado.linhas[0]).toMatchObject({
      adId: 'A1',
      leads: 1,
      pacientes: 1,
      receitaCentavos: 184_700,
      gastoCentavos: 0,
    })
    // Sem gasto não há ROI a calcular. `null`, não `Infinity`.
    expect(estado.linhas[0].roi).toBeNull()
  })

  it('sobrevive ao banco sem a tabela de atribuição', async () => {
    const { supabase } = criarSupabase({
      lead_attribution: {
        data: null,
        error: { message: 'relation "public.lead_attribution" does not exist' },
      },
    })

    const estado = await carregarMarketing({
      supabase,
      periodo: PERIODO,
      cliente: criarCliente({ insightsPorAnuncio: async () => [INSIGHT] }),
      datasetId: null,
    })

    expect(estado.ligada).toBe(true)
    if (!estado.ligada) return

    expect(estado.avisoDoBanco).toContain('lead_attribution')
    // O gasto continua na tela: metade da informação é melhor que nenhuma.
    expect(estado.linhas[0]).toMatchObject({ adId: 'A1', gastoCentavos: 17_996, leads: 0 })
    expect(estado.totais.cacCentavos).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. Ligada e ok
// ---------------------------------------------------------------------------

describe('ligada', () => {
  it('cruza gasto e desfecho pelo ad_id e soma os totais', async () => {
    const { supabase } = criarSupabase({
      lead_attribution: {
        data: [
          { ad_id: 'A1', ad_title: 'Botox', source_app: 'instagram', patient_id: 'p1', patients: { stage: 'paciente' } },
          { ad_id: 'A1', ad_title: 'Botox', source_app: 'instagram', patient_id: 'p2', patients: { stage: 'agendado' } },
          { ad_id: 'A1', ad_title: 'Botox', source_app: 'instagram', patient_id: null, patients: null },
        ],
        error: null,
      },
      attendance_records: {
        data: [{ patient_id: 'p1', procedures: { preco_centavos: 184_700 } }],
        error: null,
      },
    })

    const estado = await carregarMarketing({
      supabase,
      periodo: PERIODO,
      cliente: criarCliente({ insightsPorAnuncio: async () => [INSIGHT] }),
      datasetId: null,
    })

    expect(estado.ligada).toBe(true)
    if (!estado.ligada) return

    const [linha] = estado.linhas
    expect(linha).toMatchObject({
      adId: 'A1',
      anuncio: 'Botox — vídeo 15s',
      campanha: 'Izadora - Whatsapp - Leads',
      sourceApp: 'instagram',
      gastoCentavos: 17_996,
      conversas: 24,
      leads: 3,
      agendaram: 2,
      pacientes: 1,
      receitaCentavos: 184_700,
    })
    // CAC real: R$ 179,96 para uma paciente.
    expect(linha.cacCentavos).toBe(17_996)
    expect(estado.totais.gastoCentavos).toBe(17_996)
    expect(estado.totais.pacientes).toBe(1)
  })

  it('banco vazio: tabela vazia, zeros e nenhum NaN', async () => {
    const { supabase } = criarSupabase({})

    const estado = await carregarMarketing({
      supabase,
      periodo: PERIODO,
      cliente: criarCliente(),
      datasetId: null,
    })

    expect(estado.ligada).toBe(true)
    if (!estado.ligada) return

    expect(estado.linhas).toEqual([])
    expect(estado.totais.gastoCentavos).toBe(0)
    expect(estado.totais.cacCentavos).toBeNull()
    expect(estado.totais.roi).toBeNull()
    expect(estado.avisoDaApi).toBeNull()
    expect(estado.avisoDoBanco).toBeNull()
  })

  it('não consulta o dataset quando não há dataset configurado', async () => {
    const { supabase } = criarSupabase({})
    const estadoDoDataset = vi.fn(async () => null)

    const estado = await carregarMarketing({
      supabase,
      periodo: PERIODO,
      cliente: criarCliente({ estadoDoDataset }),
      datasetId: null,
    })

    expect(estadoDoDataset).not.toHaveBeenCalled()
    expect(estado.ligada && estado.dataset).toBeNull()
  })

  it('mostra a saúde do dataset quando ela vem, e engole a falha quando não', async () => {
    const { supabase } = criarSupabase({})

    const comDataset = await carregarMarketing({
      supabase,
      periodo: PERIODO,
      cliente: criarCliente({
        estadoDoDataset: async () => ({
          qualidadeDaCorrespondencia: 7.4,
          ultimoEventoEm: new Date('2026-08-05T12:00:00.000Z'),
          volumePorEvento: [{ evento: 'Schedule', quantidade: 12 }],
        }),
      }),
      datasetId: '1234567890',
    })
    expect(comDataset.ligada && comDataset.dataset?.qualidadeDaCorrespondencia).toBe(7.4)

    const semDataset = await carregarMarketing({
      supabase,
      periodo: PERIODO,
      cliente: criarCliente({
        estadoDoDataset: async () => {
          throw new Error('nó inacessível')
        },
      }),
      datasetId: '1234567890',
    })
    // Bloco acessório: some calado em vez de virar erro de página.
    expect(semDataset.ligada && semDataset.dataset).toBeNull()
  })
})
