/**
 * Ponte entre o funil e a fila de conversões da Meta.
 *
 * Mesma divisão de `lib/lembretes.ts`: o I/O que `src/domain/marketing/` não pode
 * ter mora aqui — ler o consentimento e a atribuição da paciente, gravar
 * `meta_conversion_jobs` — enquanto a regra de QUAIS eventos existem continua
 * inteira em `plan-conversions.ts`, testada sem banco.
 *
 * Módulo comum às três Server Actions que movem o funil (`moverEstagio`,
 * `agendarConsulta`, `registrarAtendimento`) e, por isso, deliberadamente fora de
 * um arquivo `'use server'`: aquela diretiva só deixa exportar função async, e
 * transformar este helper em endpoint público deixaria qualquer POST enfileirar
 * evento em nome de uma paciente.
 *
 * ---------------------------------------------------------------------------
 * O contrato: NADA AQUI LANÇA
 * ---------------------------------------------------------------------------
 * Mesmo princípio de `lib/google-agenda.ts`, e pelo mesmo motivo, que aqui pesa
 * ainda mais: estas funções são chamadas DEPOIS de a operação clínica já estar
 * gravada. Uma exceção escapando daqui subiria pela Server Action e a secretária
 * veria "não foi possível agendar" para uma consulta que ESTÁ na agenda — ela
 * remarcaria por cima, e a clínica pararia por causa de um canal de marketing.
 *
 * Por isso o corpo inteiro vive dentro de um `try`, inclusive a leitura do
 * ambiente (`serverEnv()` lança quando ele está incompleto) e a criação do
 * cliente admin. O retorno é valor, nunca exceção.
 *
 * ---------------------------------------------------------------------------
 * Os três silêncios que NÃO são erro
 * ---------------------------------------------------------------------------
 *   - sem `META_DATASET_ID` + `META_CAPI_TOKEN`: a integração está desligada, que
 *     é o estado da clínica hoje. Sai calado, sem log a cada cartão arrastado;
 *   - sem `consentimento_lgpd_em` ou sem `ctwa_clid`: as duas travas da LGPD, e
 *     quem as aplica é o domínio — daqui elas chegam como lista vazia;
 *   - retrocesso no funil ou estágio sem evento: também lista vazia.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ehEstagio } from '@/app/(app)/crm/estagios'
import {
  planejarConversoes,
  type ConversaoPlanejada,
  type EstagioFunil,
} from '@/domain/marketing/plan-conversions'
import { configuracaoDaMeta, type ConfigMeta } from '@/integrations/meta/capi'
import { congelarConversao } from '@/integrations/meta/payload'
import { serverEnv } from '@/lib/env'
import { normalizarTelefone } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase/admin'
import type { createServerClient } from '@/lib/supabase/server'

type Cliente = Awaited<ReturnType<typeof createServerClient>>

// ---------------------------------------------------------------------------
// O vínculo telefone → paciente
// ---------------------------------------------------------------------------

export type ResultadoDoVinculo =
  | { ok: true; vinculadas: number }
  | { ok: false; erro: string }

/**
 * Quantos dígitos finais bastam para achar a linha.
 *
 * A busca no banco é por SUFIXO, não por igualdade, porque os dois lados podem
 * estar escritos diferente: `patients.telefone` sai de `normalizarTelefone`, e
 * `lead_attribution.telefone` é escrito pelo n8n a partir do `remoteJid` da
 * Evolution. O check do banco garante a FORMA (`+` e dígitos), não a mesma
 * normalização — um `+551187654321` sem o nono dígito passa nos dois checks e
 * nunca casaria num `=`.
 *
 * Oito é o número do assinante brasileiro sem o nono dígito e sem DDD: é a parte
 * que nenhuma das variações mexe. O que sobra de candidato é desempatado em
 * memória, comparando `normalizarTelefone` dos DOIS lados — que é a única
 * comparação de telefone confiável neste projeto.
 */
const DIGITOS_DE_BUSCA = 8

/**
 * Liga as linhas de `lead_attribution` daquele telefone a uma paciente.
 *
 * Existe porque a tabela é alimentada pelo n8n, cuja chave é o TELEFONE, e o
 * `patient_id` nasce nulo. Resolver esse vínculo é trabalho do app, e os dois
 * sentidos acontecem de verdade:
 *
 *   - a mensagem chega ANTES do cadastro (o caso comum: lead do anúncio manda
 *     WhatsApp, a secretária cadastra depois) — resolvido no `criarLead`;
 *   - a paciente é cadastrada À MÃO ANTES de mandar mensagem (ela liga, é
 *     cadastrada, e só então clica no anúncio) — resolvido preguiçosamente, toda
 *     vez que o funil dela anda.
 *
 * Roda com o client `service_role`: a migration 0010 não escreveu policy de
 * UPDATE em `lead_attribution` de propósito — o vínculo é dedução do sistema a
 * partir do telefone, não campo que alguém edita na tela.
 *
 * Nunca lança. Nunca sobrescreve um vínculo existente (`.is('patient_id', null)`):
 * uma linha já ligada descreve um fato resolvido, e o telefone poderia ter sido
 * reaproveitado por outra pessoa.
 *
 * @param admin Client `service_role` já pronto. Omitir cria pelo ambiente —
 * que é o caminho de produção; `null` desliga o vínculo, usado no teste.
 */
export async function vincularAtribuicaoAoPaciente(
  patientId: string,
  telefone: string | null,
  admin?: SupabaseClient | null,
): Promise<ResultadoDoVinculo> {
  try {
    // Sem telefone não há por onde casar: `lead_attribution.telefone` é a única
    // chave de junção entre as duas tabelas. Lead sem número existe e é normal.
    const e164 = telefone ? normalizarTelefone(telefone) : null
    if (!e164) return { ok: true, vinculadas: 0 }

    const cliente = admin === undefined ? createAdminClient() : admin
    if (!cliente) return { ok: true, vinculadas: 0 }

    const { data, error } = await cliente
      .from('lead_attribution')
      .select('id, telefone, patient_id')
      .like('telefone', `%${e164.slice(-DIGITOS_DE_BUSCA)}`)

    if (error) return avisar('não foi possível procurar a atribuição', error.message)

    const candidatas = (data ?? []) as { id: string; telefone: string; patient_id: string | null }[]
    const alvos = candidatas.filter(
      (linha) => linha.patient_id === null && normalizarTelefone(linha.telefone) === e164,
    )
    if (alvos.length === 0) return { ok: true, vinculadas: 0 }

    const { data: ligadas, error: erroAoLigar } = await cliente
      .from('lead_attribution')
      .update({ patient_id: patientId })
      .in(
        'id',
        alvos.map((linha) => linha.id),
      )
      // Fecha a corrida entre o filtro em memória e a escrita: outra requisição
      // pode ter ligado a mesma linha nesse meio-tempo, e o primeiro vínculo é
      // o que vale.
      .is('patient_id', null)
      .select('id')

    if (erroAoLigar) return avisar('não foi possível ligar a atribuição', erroAoLigar.message)

    return { ok: true, vinculadas: (ligadas ?? []).length }
  } catch (causa) {
    return avisar('falha ao vincular a atribuição', descrever(causa))
  }
}

// ---------------------------------------------------------------------------
// O enfileiramento
// ---------------------------------------------------------------------------

export type SituacaoDoEnfileiramento =
  /** Não há dataset nem token de CAPI configurados. Estado normal, não é falha. */
  | 'desligada'
  /** O domínio não devolveu evento: sem consentimento, sem clid, ou retrocesso. */
  | 'sem evento'
  | 'enfileirado'

export type ResultadoDoEnfileiramento =
  | { ok: true; situacao: SituacaoDoEnfileiramento; criados: number }
  | { ok: false; erro: string }

export type MovimentoDoFunil = {
  patientId: string
  /**
   * Onde a paciente estava. Lido do banco ANTES da mudança, nunca aceito do
   * cliente. `null` quando não deu para ler — o domínio trata como abaixo do
   * primeiro degrau e gera a escada inteira, o que é a degradação certa: a
   * `chave_idempotencia` transforma em no-op tudo que já saiu.
   */
  estagioAnterior: string | null
  estagioNovo: EstagioFunil
  /** Preço do que foi feito, em centavos. Só o `Purchase` usa. */
  valorCentavos?: number | null
  /** Instante do movimento. Injetável para o teste não depender do relógio. */
  ocorridoEm?: Date
}

export type OpcoesDoEnfileiramento = {
  /** Client `service_role` para o vínculo. `null` desliga; omitir usa o ambiente. */
  admin?: SupabaseClient | null
  /** Configuração da Meta. `null` força o modo desligado; omitir lê o ambiente. */
  config?: ConfigMeta | null
}

type CadastroDaPaciente = {
  telefone: string | null
  consentimento_lgpd_em: string | null
}

/**
 * Planeja e enfileira as conversões de um movimento do funil.
 *
 * Chamada DEPOIS de a mudança persistir, sempre. A ordem importa: se o evento
 * fosse enfileirado antes e a gravação falhasse, a Meta receberia uma conversão
 * que não aconteceu — e não existe desconversão do lado dela.
 */
export async function enfileirarConversoes(
  supabase: Cliente,
  movimento: MovimentoDoFunil,
  opcoes: OpcoesDoEnfileiramento = {},
): Promise<ResultadoDoEnfileiramento> {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('telefone, consentimento_lgpd_em')
      .eq('id', movimento.patientId)
      .single()

    if (error || !data) {
      return avisar(`não foi possível ler a paciente ${movimento.patientId}`, error?.message)
    }
    const paciente = data as CadastroDaPaciente

    // O vínculo vem ANTES da checagem de credencial, e de propósito: ele não é
    // parte do envio, é o que faz a página /marketing conseguir cruzar gasto com
    // funil por `ad_id`. Enquanto o dataset não existir, o envio fica desligado —
    // mas a atribuição precisa continuar sendo resolvida, senão o histórico
    // chegaria vazio no dia em que a credencial aparecer.
    await vincularAtribuicaoAoPaciente(movimento.patientId, paciente.telefone, opcoes.admin)

    const config = opcoes.config === undefined ? configuracaoDaMeta(serverEnv()) : opcoes.config
    // Sem credencial não há erro nenhum a registrar: a clínica simplesmente não
    // ligou o canal. Sair calado aqui é o que permite o sistema rodar
    // indefinidamente sem dataset na Meta.
    if (!config) return { ok: true, situacao: 'desligada', criados: 0 }

    const conversoes = planejarConversoes({
      patientId: movimento.patientId,
      estagioAnterior: ehEstagio(movimento.estagioAnterior) ? movimento.estagioAnterior : null,
      estagioNovo: movimento.estagioNovo,
      consentimentoLgpdEm: paciente.consentimento_lgpd_em,
      ctwaClid: await lerCtwaClid(supabase, movimento.patientId),
      telefoneE164: paciente.telefone,
      valorCentavos: movimento.valorCentavos,
      ocorridoEm: movimento.ocorridoEm,
    })

    if (conversoes.length === 0) return { ok: true, situacao: 'sem evento', criados: 0 }

    // `return await`, e não `return`: sem o `await` a promessa sai do escopo do
    // `try` antes de rejeitar, o `catch` daqui nunca roda e a exceção sobe pela
    // Server Action — exatamente o que este módulo existe para impedir.
    return await gravar(supabase, conversoes)
  } catch (causa) {
    return avisar('falha ao enfileirar as conversões', descrever(causa))
  }
}

/**
 * A chave de atribuição da paciente, ou `null`.
 *
 * Lê pelo `patient_id` — o vínculo já foi resolvido logo acima. `primeiro
 * contato` ascendente porque **primeiro clique vence**: uma paciente pode ter
 * duas linhas (o número dela e o do marido), e o anúncio a ser creditado é o que
 * a trouxe primeiro, não o mais recente.
 *
 * Client da sessão, não o admin: a policy "equipe le atribuicao" da 0010 já dá
 * SELECT a quem está logado, e é a mesma leitura que a ficha da paciente faz.
 */
async function lerCtwaClid(supabase: Cliente, patientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('lead_attribution')
    .select('ctwa_clid')
    .eq('patient_id', patientId)
    .order('primeiro_contato_em', { ascending: true })
    .limit(1)

  if (error) return null
  const linhas = (data ?? []) as { ctwa_clid: string }[]
  return linhas[0]?.ctwa_clid ?? null
}

/**
 * Grava os jobs planejados.
 *
 * `ignoreDuplicates` traduz para `on conflict do nothing` sobre
 * `chave_idempotencia`: arrastar o cartão duas vezes, ou arrastar de volta e
 * para frente de novo, não vira dois eventos e não devolve erro. Quem garante é
 * o `unique` do banco, não uma checagem daqui — entre "ler se já existe" e
 * "gravar" cabe outra requisição.
 *
 * O `payload` passa por `congelarConversao`, que é o schema fechado onde a
 * garantia de vazamento vive: nada de prontuário atravessa, e não porque alguém
 * lembrou de não escrever.
 */
async function gravar(
  supabase: Cliente,
  conversoes: ConversaoPlanejada[],
): Promise<ResultadoDoEnfileiramento> {
  const { data, error } = await supabase
    .from('meta_conversion_jobs')
    .upsert(
      conversoes.map((conversao) => ({
        patient_id: conversao.patientId,
        evento: conversao.evento,
        chave_idempotencia: conversao.chaveIdempotencia,
        event_id: conversao.eventId,
        ocorrido_em: conversao.ocorridoEm.toISOString(),
        payload: congelarConversao(conversao),
      })),
      { onConflict: 'chave_idempotencia', ignoreDuplicates: true },
    )
    .select('id')

  if (error) return avisar('não foi possível enfileirar as conversões', error.message)
  return { ok: true, situacao: 'enfileirado', criados: (data ?? []).length }
}

// ---------------------------------------------------------------------------
// Andaimes
// ---------------------------------------------------------------------------

function descrever(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa)
}

/**
 * Registra e devolve a falha.
 *
 * `console.warn` e não `error`: nada aqui é urgente — o pior desfecho é um
 * evento de marketing que não sai, e a mensagem já vem sem o token de CAPI,
 * que este módulo nem chega a tocar.
 */
function avisar(contexto: string, detalhe?: string): { ok: false; erro: string } {
  const erro = detalhe ? `${contexto}: ${detalhe}` : contexto
  console.warn(`[conversoes] ${erro}`)
  return { ok: false, erro }
}
