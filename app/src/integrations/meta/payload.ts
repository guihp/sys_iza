/**
 * O que fica congelado em `meta_conversion_jobs.payload`, e como ele volta.
 *
 * ---------------------------------------------------------------------------
 * Por que congelar, e por que congelar ISTO
 * ---------------------------------------------------------------------------
 * A migration 0010 é explícita: o corpo do evento é congelado no instante em que
 * o funil anda, para que uma edição posterior não reescreva o passado — mudar o
 * preço do procedimento no catálogo em outubro não pode alterar o valor do
 * `Purchase` de agosto que está na fila.
 *
 * O que precisa ser congelado, então, é o FATO — valor, chave de atribuição,
 * hash do telefone —, não o formato de fio da Meta. Congelar o JSON da CAPI
 * pronto teria um efeito ruim e silencioso: no dia em que o formato mudar (e ele
 * muda), os jobs já enfileirados continuariam saindo no formato velho, e o único
 * lugar do projeto que conhece o contrato da Meta — `montarEventoDaCapi` —
 * deixaria de ser o único.
 *
 * ---------------------------------------------------------------------------
 * A garantia de vazamento vive aqui
 * ---------------------------------------------------------------------------
 * `payload` é uma coluna `jsonb`: o banco aceita qualquer objeto. Quem grava é
 * uma Server Action, e uma Server Action futura, escrita com pressa, pode achar
 * conveniente jogar ali "o procedimento, só para depurar".
 *
 * Por isso a leitura passa por um schema que ESTRIPA o que não reconhece, em vez
 * de apenas validar. Um `payload` com `{ procedimento: 'Toxina botulínica' }`
 * volta daqui sem esse campo, e nada além dos sete campos declarados chega ao
 * adaptador — que por sua vez não tem onde colocá-los. É a restrição legal do
 * plano transformada em tipo, e não em disciplina de quem edita.
 *
 * Módulo de servidor/worker: quem o importa fala com a fila.
 */

import { z } from 'zod'
import type { ConversaoPlanejada } from '@/domain/marketing/plan-conversions'
import type { EventoDeConversao } from './capi'

/**
 * Os cinco eventos do mapa do plano.
 *
 * Repetido aqui em vez de derivado do domínio porque este schema valida o que
 * VOLTA DO BANCO, que pode ter sido gravado por uma versão anterior do código.
 * Um evento fora da lista é dado corrompido, não um caso novo a acomodar.
 */
const EVENTOS = ['Lead', 'Contact', 'Schedule', 'CompleteRegistration', 'Purchase'] as const

/**
 * `strip` (o padrão do zod) e não `passthrough`: é a linha que impede prontuário
 * de atravessar. Ver o cabeçalho.
 */
const schemaDoPayload = z.object({
  evento: z.enum(EVENTOS),
  eventId: z.string().min(1),
  /** ISO 8601. String e não Date porque o que vem do `jsonb` é texto. */
  ocorridoEm: z.string().min(1),
  ctwaClid: z.string().min(1),
  telefoneHash: z.string().min(1).nullable(),
  valor: z.number().nullable(),
  moeda: z.literal('BRL').nullable(),
})

/** A forma exata que fica gravada na coluna. */
export type PayloadCongelado = z.infer<typeof schemaDoPayload>

/**
 * `ConversaoPlanejada` → o objeto a gravar em `payload`.
 *
 * O `patientId` e a `chaveIdempotencia` ficam de fora: os dois já são colunas
 * próprias da linha, e o uuid da paciente repetido dentro de um `jsonb` seria
 * uma segunda cópia de um identificador pessoal, num campo que ninguém indexa e
 * que a tela de configuração exibe inteiro.
 */
export function congelarConversao(conversao: ConversaoPlanejada): PayloadCongelado {
  return {
    evento: conversao.evento,
    eventId: conversao.eventId,
    ocorridoEm: conversao.ocorridoEm.toISOString(),
    ctwaClid: conversao.ctwaClid,
    telefoneHash: conversao.telefoneHash,
    valor: conversao.valor,
    moeda: conversao.moeda,
  }
}

/**
 * O `jsonb` do banco → o evento que o adaptador envia.
 *
 * Devolve `null` em vez de lançar quando o payload está corrompido: quem chama é
 * o worker montando um lote, e uma linha ilegível não pode derrubar as outras
 * dezenas do ciclo. O despacho trata o `null` como falha permanente daquele job,
 * com mensagem própria — retentar um JSON quebrado produz o mesmo JSON quebrado.
 *
 * Data inválida é recusada junto: um `ocorridoEm` que vire `Invalid Date` sairia
 * como `event_time: NaN` e a Meta recusaria o evento sem dizer por quê.
 */
export function lerConversaoCongelada(payload: unknown): EventoDeConversao | null {
  const lido = schemaDoPayload.safeParse(payload)
  if (!lido.success) return null

  const ocorridoEm = new Date(lido.data.ocorridoEm)
  if (Number.isNaN(ocorridoEm.getTime())) return null

  return {
    evento: lido.data.evento,
    eventId: lido.data.eventId,
    ocorridoEm,
    ctwaClid: lido.data.ctwaClid,
    telefoneHash: lido.data.telefoneHash,
    valor: lido.data.valor,
    moeda: lido.data.moeda,
  }
}
