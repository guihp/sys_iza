/**
 * O cruzamento: gasto da Meta × desfecho clínico daqui, por `ad_id`.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * É o que **nenhum painel da Meta consegue mostrar**. Ela sabe quanto custou a
 * conversa; só este banco sabe quem virou paciente. A junção acontece por
 * `ad_id`: a Marketing API devolve o gasto com essa chave, e
 * `lead_attribution.ad_id` guarda a mesma chave do lado de cá, gravada pelo n8n
 * a partir de `externalAdReply.sourceId`.
 *
 * Módulo puro: sem Supabase, sem React, sem rede. Recebe as duas listas já
 * lidas e devolve a tabela pronta — é o que permite testar CAC e ROI sem banco
 * e sem credencial, que é exatamente o estado do projeto hoje.
 *
 * ---------------------------------------------------------------------------
 * DIVISÃO POR ZERO: a regra do arquivo inteiro
 * ---------------------------------------------------------------------------
 * O banco está vazio e vai continuar vazio. Toda razão daqui tem denominador que
 * PODE ser zero, e nenhuma delas pode chegar à tela como `NaN` ou `Infinity`:
 *
 *   - CAC = gasto ÷ pacientes. Zero paciente é o estado normal — gastou e
 *     ninguém converteu ainda. `Infinity` seria o valor "matematicamente certo"
 *     e a leitura errada: não é que cada paciente custou infinito, é que **não
 *     dá para dizer** com zero paciente;
 *   - ROI = receita ÷ gasto. Gasto zero acontece em anúncio pausado que ainda
 *     traz lead orgânico pelo link antigo. Mesma coisa: indefinido, não infinito;
 *   - taxa lead → agendado. Zero lead, zero denominador.
 *
 * A resposta é UMA: `dividir()` devolve `null` quando o denominador é zero, e
 * `null` vira `—` na tela. Não há um segundo caminho, e é por isso que não há um
 * segundo jeito de errar.
 */

import { deslocarData } from '@/lib/datetime'
import type { InsightDoAnuncio } from '@/integrations/meta/marketing-api'
import type { PatientStage } from '@/app/(app)/crm/estagios'

// ---------------------------------------------------------------------------
// A escada do funil, para contar desfecho
// ---------------------------------------------------------------------------

/**
 * Posição de cada estágio na escada.
 *
 * O ponto sutil: `patients.stage` guarda onde a paciente está AGORA, não por
 * onde ela passou. Não há histórico de estágio no banco. Então "quantas
 * agendaram" não é "quantas estão em `agendado`" — quem agendou e compareceu já
 * saiu daquela coluna, e contar só o estágio corrente diria que ninguém agendou
 * num anúncio que fechou três pacientes.
 *
 * A leitura correta é **acumulada**: quem está em `compareceu` necessariamente
 * agendou. Por isso a contagem é por "chegou pelo menos até aqui", e é o que
 * `POSICAO_NO_FUNIL` mede.
 *
 * Dois valores merecem justificativa:
 *
 *   - `retorno` vale o MESMO que `paciente` (5), e não 6. Retorno é a paciente
 *     que já é paciente voltando — retenção, não uma sexta etapa de aquisição.
 *     Mesma decisão que `plan-conversions.ts` tomou ao não gerar evento para
 *     `retorno`, e pelo mesmo motivo: contá-la à parte inflaria o anúncio;
 *   - `descartado` vale 0, abaixo de `lead`. Ela CONTINUA contando como lead
 *     (o anúncio trouxe a pessoa, e o dinheiro foi gasto de qualquer jeito) —
 *     ver `agruparDesfechos`, onde `leads` é a contagem de linhas e não depende
 *     desta tabela. O que o 0 garante é que ela não conte como agendamento.
 */
export const POSICAO_NO_FUNIL: Record<PatientStage, number> = {
  descartado: 0,
  lead: 1,
  contato: 2,
  agendado: 3,
  compareceu: 4,
  paciente: 5,
  retorno: 5,
}

const POSICAO_AGENDADO = POSICAO_NO_FUNIL.agendado
const POSICAO_COMPARECEU = POSICAO_NO_FUNIL.compareceu
const POSICAO_PACIENTE = POSICAO_NO_FUNIL.paciente

// ---------------------------------------------------------------------------
// Entrada vinda do banco
// ---------------------------------------------------------------------------

/**
 * Uma linha de `lead_attribution` com o estágio da paciente vinculada.
 *
 * O que NÃO está aqui é tão importante quanto o que está: **não há nome de
 * paciente, telefone nem procedimento.** Esta tela cruza anúncio com desfecho, e
 * agregado basta — nome e procedimento juntos numa tabela de marketing seriam
 * dado de saúde identificável numa tela cujo propósito é outro. O tipo não os
 * carrega, então nenhuma edição futura pode "só acrescentar uma coluninha".
 */
export type AtribuicaoDoBanco = {
  adId: string
  /** `lead_attribution.ad_title` — o título do criativo, não da paciente. */
  adTitle: string | null
  /** `instagram` | `facebook`, quando o webhook trouxe. */
  sourceApp: string | null
  /** Nulo enquanto a pessoa não virou cadastro. Conta como lead mesmo assim. */
  patientId: string | null
  /** `patients.stage`. Nulo quando ainda não há cadastro. */
  stage: PatientStage | null
}

/** O desfecho clínico de um anúncio, somado. */
export type DesfechoDoAnuncio = {
  adId: string
  adTitle: string | null
  sourceApp: string | null
  /** Toda pessoa que chegou por este anúncio, virando cadastro ou não. */
  leads: number
  agendaram: number
  compareceram: number
  pacientes: number
  /** Soma do preço de catálogo dos atendimentos das pacientes deste anúncio. */
  receitaCentavos: number
}

/**
 * Agrupa as atribuições por anúncio e soma a receita.
 *
 * `receitaPorPaciente` chega pronto porque ler prontuário é I/O, e I/O não entra
 * em módulo puro. A receita é o preço de CATÁLOGO do procedimento realizado
 * (`procedures.preco_centavos`), somado por paciente — ver `lib/marketing.ts`.
 *
 * Uma paciente com duas atribuições (o próprio número e o do marido, caso que a
 * migration 0010 prevê) teria a receita contada duas vezes. Por isso o
 * `patient_id` só é creditado UMA vez por anúncio: `jaContados`.
 */
export function agruparDesfechos(
  atribuicoes: readonly AtribuicaoDoBanco[],
  receitaPorPaciente: ReadonlyMap<string, number>,
): DesfechoDoAnuncio[] {
  const porAnuncio = new Map<string, DesfechoDoAnuncio>()
  const jaContados = new Map<string, Set<string>>()

  for (const atribuicao of atribuicoes) {
    const adId = atribuicao.adId.trim()
    if (!adId) continue

    let linha = porAnuncio.get(adId)
    if (!linha) {
      linha = {
        adId,
        adTitle: atribuicao.adTitle,
        sourceApp: atribuicao.sourceApp,
        leads: 0,
        agendaram: 0,
        compareceram: 0,
        pacientes: 0,
        receitaCentavos: 0,
      }
      porAnuncio.set(adId, linha)
      jaContados.set(adId, new Set())
    }

    // O título fica do primeiro que tiver um: o webhook nem sempre traz, e uma
    // linha sem título não pode apagar o rótulo que outra já deu ao anúncio.
    linha.adTitle ??= atribuicao.adTitle
    linha.sourceApp ??= atribuicao.sourceApp

    linha.leads += 1

    const posicao = atribuicao.stage ? POSICAO_NO_FUNIL[atribuicao.stage] : 0
    if (posicao >= POSICAO_AGENDADO) linha.agendaram += 1
    if (posicao >= POSICAO_COMPARECEU) linha.compareceram += 1
    if (posicao >= POSICAO_PACIENTE) linha.pacientes += 1

    const contados = jaContados.get(adId)!
    if (atribuicao.patientId && !contados.has(atribuicao.patientId)) {
      contados.add(atribuicao.patientId)
      linha.receitaCentavos += receitaPorPaciente.get(atribuicao.patientId) ?? 0
    }
  }

  return [...porAnuncio.values()]
}

// ---------------------------------------------------------------------------
// A razão: a única forma de dividir neste arquivo
// ---------------------------------------------------------------------------

/**
 * Divisão que não produz `NaN` nem `Infinity`.
 *
 * `null` significa "não dá para dizer", e é diferente de zero. Zero paciente não
 * torna o CAC infinito: torna o CAC desconhecido. A tela escreve `—`.
 *
 * Numerador não finito também devolve `null` — um `NaN` entrando por um campo
 * que a Meta mandou torto não pode sair daqui como número.
 */
export function dividir(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador)) return null
  if (denominador === 0) return null
  return numerador / denominador
}

// ---------------------------------------------------------------------------
// A linha da tabela
// ---------------------------------------------------------------------------

export type LinhaDeMarketing = {
  adId: string
  /** Nome do anúncio na Meta; cai no título do criativo, e depois no id. */
  anuncio: string
  campanha: string | null
  sourceApp: string | null

  /** Da Marketing API. Zerados quando o anúncio só existe do lado de cá. */
  gastoCentavos: number
  impressoes: number
  cliques: number
  conversas: number
  /** Gasto ÷ conversas. `null` sem conversa. */
  custoPorConversaCentavos: number | null

  /** Do nosso banco. Zerados quando o anúncio só existe do lado da Meta. */
  leads: number
  agendaram: number
  compareceram: number
  pacientes: number
  receitaCentavos: number

  /** Agendaram ÷ leads, de 0 a 1. `null` sem lead. */
  taxaLeadAgendado: number | null
  /** **CAC real**: gasto ÷ pacientes. `null` sem paciente. */
  cacCentavos: number | null
  /** **ROI**: receita ÷ gasto. `null` sem gasto. */
  roi: number | null
}

const SEM_DESFECHO = {
  adTitle: null,
  sourceApp: null,
  leads: 0,
  agendaram: 0,
  compareceram: 0,
  pacientes: 0,
  receitaCentavos: 0,
} as const

/**
 * Junta os dois lados por `ad_id`, e é uma junção EXTERNA dos dois lados.
 *
 * Nenhum dos lados manda no conjunto de linhas, e as duas exclusões são
 * informação de verdade:
 *
 *   - anúncio na Meta sem lead aqui = dinheiro gasto que não virou conversa
 *     atribuída. É o caso da campanha de tráfego para o Instagram, que não deixa
 *     `ctwa_clid` — ela aparece com desfecho zerado, e isso é o esperado;
 *   - lead aqui sem anúncio na Meta = clique antigo, fora do período consultado,
 *     ou anúncio de outra conta. Sumir com ele esconderia paciente conquistada.
 *
 * Ordenado por gasto e, no empate, por pacientes: a primeira pergunta da tela é
 * "onde o dinheiro está indo".
 */
export function cruzar(
  insights: readonly InsightDoAnuncio[],
  desfechos: readonly DesfechoDoAnuncio[],
): LinhaDeMarketing[] {
  const porAdId = new Map<string, DesfechoDoAnuncio>()
  for (const desfecho of desfechos) porAdId.set(desfecho.adId, desfecho)

  const linhas: LinhaDeMarketing[] = []
  const vistos = new Set<string>()

  for (const insight of insights) {
    vistos.add(insight.adId)
    linhas.push(
      montarLinha(insight, porAdId.get(insight.adId) ?? { adId: insight.adId, ...SEM_DESFECHO }),
    )
  }

  for (const desfecho of desfechos) {
    if (vistos.has(desfecho.adId)) continue
    linhas.push(montarLinha(null, desfecho))
  }

  return linhas.sort(
    (a, b) => b.gastoCentavos - a.gastoCentavos || b.pacientes - a.pacientes || b.leads - a.leads,
  )
}

function montarLinha(
  insight: InsightDoAnuncio | null,
  desfecho: DesfechoDoAnuncio,
): LinhaDeMarketing {
  const gastoCentavos = insight?.gastoCentavos ?? 0

  return {
    adId: desfecho.adId,
    // Ordem de preferência do rótulo: o nome do anúncio na Meta é o que a Dra.
    // procura no Gerenciador; o título do criativo é o que ela reconhece; o id
    // é o último recurso e nunca deixa a célula vazia.
    anuncio: insight?.adNome ?? desfecho.adTitle ?? `Anúncio ${desfecho.adId}`,
    campanha: insight?.campanhaNome ?? null,
    sourceApp: desfecho.sourceApp,

    gastoCentavos,
    impressoes: insight?.impressoes ?? 0,
    cliques: insight?.cliques ?? 0,
    conversas: insight?.conversas ?? 0,
    custoPorConversaCentavos: arredondarOuNulo(dividir(gastoCentavos, insight?.conversas ?? 0)),

    leads: desfecho.leads,
    agendaram: desfecho.agendaram,
    compareceram: desfecho.compareceram,
    pacientes: desfecho.pacientes,
    receitaCentavos: desfecho.receitaCentavos,

    taxaLeadAgendado: dividir(desfecho.agendaram, desfecho.leads),
    cacCentavos: arredondarOuNulo(dividir(gastoCentavos, desfecho.pacientes)),
    roi: dividir(desfecho.receitaCentavos, gastoCentavos),
  }
}

/** Centavos são inteiros. Meio centavo por linha vira erro visível no total. */
function arredondarOuNulo(valor: number | null): number | null {
  return valor === null ? null : Math.round(valor)
}

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

export type TotaisDeMarketing = {
  gastoCentavos: number
  conversas: number
  leads: number
  agendaram: number
  compareceram: number
  pacientes: number
  receitaCentavos: number
  /** CAC do conjunto: gasto total ÷ pacientes totais. `null` sem paciente. */
  cacCentavos: number | null
  /** ROI do conjunto: receita total ÷ gasto total. `null` sem gasto. */
  roi: number | null
}

/**
 * Soma as linhas.
 *
 * CAC e ROI do total são calculados a partir das SOMAS, e não como média dos
 * CACs de cada linha. Média de razões é a armadilha clássica deste tipo de
 * relatório: um anúncio de R$ 5 que trouxe uma paciente puxaria a média para
 * baixo com o mesmo peso de outro de R$ 500 que trouxe dez.
 */
export function totalizar(linhas: readonly LinhaDeMarketing[]): TotaisDeMarketing {
  const total = {
    gastoCentavos: 0,
    conversas: 0,
    leads: 0,
    agendaram: 0,
    compareceram: 0,
    pacientes: 0,
    receitaCentavos: 0,
  }

  for (const linha of linhas) {
    total.gastoCentavos += linha.gastoCentavos
    total.conversas += linha.conversas
    total.leads += linha.leads
    total.agendaram += linha.agendaram
    total.compareceram += linha.compareceram
    total.pacientes += linha.pacientes
    total.receitaCentavos += linha.receitaCentavos
  }

  return {
    ...total,
    cacCentavos: arredondarOuNulo(dividir(total.gastoCentavos, total.pacientes)),
    roi: dividir(total.receitaCentavos, total.gastoCentavos),
  }
}

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

/** Janelas oferecidas na tela. Números redondos, não configuráveis. */
export const PERIODOS_EM_DIAS = [7, 30, 90] as const

export type PeriodoEmDias = (typeof PERIODOS_EM_DIAS)[number]

export const PERIODO_PADRAO: PeriodoEmDias = 30

/** `?periodo=` da URL → uma das janelas. Lixo cai no padrão, sem erro. */
export function periodoDaUrl(bruto: string | string[] | undefined): PeriodoEmDias {
  const valor = Number(Array.isArray(bruto) ? bruto[0] : bruto)
  return (PERIODOS_EM_DIAS as readonly number[]).includes(valor)
    ? (valor as PeriodoEmDias)
    : PERIODO_PADRAO
}

/**
 * A janela de datas, em dia de calendário DA CLÍNICA.
 *
 * `dias - 1` porque a janela inclui hoje: "últimos 7 dias" é hoje e os seis
 * anteriores, não hoje e os sete anteriores. Sem isso todo período mostraria um
 * dia a mais de gasto do que o rótulo promete.
 */
export function janelaDoPeriodo(hojeISO: string, dias: PeriodoEmDias) {
  return { desde: deslocarData(hojeISO, -(dias - 1)), ate: hojeISO }
}
