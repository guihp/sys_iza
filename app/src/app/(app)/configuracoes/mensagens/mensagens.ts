/**
 * As regras da tela de mensagens, sem I/O.
 *
 * Módulo puro de propósito, e fora de `acoes.ts` por obrigação: arquivo com
 * `'use server'` só pode exportar função async, então uma constante como
 * `GATILHOS` — que a página, o editor e a Server Action precisam ler — não caberia
 * lá. Mesmo precedente de `crm/estagios.ts`, `agenda/grade.ts` e
 * `retornos/fila.ts`.
 *
 * O que este arquivo carrega é a tradução de três coisas que o banco e o worker
 * já sabem, para uma forma que o editor consegue mostrar antes de a Dra. clicar
 * em Salvar:
 *
 *   1. quais pares (gatilho, canal) existem — os mesmos sete que a migration
 *      0007 semeia e que `plan-reminders.ts` de fato produz;
 *   2. quais variáveis cada gatilho alimenta — lidas de `worker/fila.ts`, onde
 *      elas nascem;
 *   3. o que o banco recusaria — as constraints `templates_corpo_nao_vazio` e
 *      `templates_email_tem_assunto`.
 *
 * O item 3 é duplicação consciente. A constraint continua sendo a autoridade; o
 * que existe aqui é para a Dra. ler "e-mail sem assunto vai para o spam" em vez
 * de um erro de Postgres em inglês.
 */

import type { Canal, ReminderKind } from '@/domain/reminders/plan-reminders'
import { renderizarTemplate, variaveisDoTemplate } from '@/domain/reminders/template'
import { formatarDataExtensa, formatarDataExtensaComAno } from '@/lib/datetime'

/** Toda variável que `worker/fila.ts` sabe preencher, em algum gatilho. */
export const VARIAVEIS_CONHECIDAS = [
  'nome',
  'data',
  'hora',
  'procedimento',
  'data_retorno',
] as const

export type Variavel = (typeof VARIAVEIS_CONHECIDAS)[number]

export type Gatilho = {
  kind: ReminderKind
  titulo: string
  /** Quando o lembrete sai, na linguagem de quem escreve o texto. */
  quando: string
  /** Canais que o planejador produz para este gatilho — nem todos têm os dois. */
  canais: Canal[]
  /**
   * Variáveis que este gatilho alimenta de verdade.
   *
   * Não é a lista global: um lembrete de agenda conhece a data e a hora da
   * consulta e não conhece retorno; um de pós-atendimento é o contrário. Citar a
   * variável errada não quebra nada — `renderizarTemplate` devolve string vazia
   * —, e é exatamente esse o problema: a paciente recebe "sua consulta é  às ".
   */
  variaveis: Variavel[]
}

/**
 * Os sete pares que existem.
 *
 * A ordem é a da migration 0007, e o teste amarra as duas: o que a tela lista
 * tem de ser o que o banco tem, senão a Dra. edita um texto que ninguém envia ou
 * deixa de ver um que sai todo dia.
 */
export const GATILHOS: Gatilho[] = [
  {
    kind: 'confirmacao',
    titulo: 'Confirmação da véspera',
    quando: 'Às 09:00 do dia anterior à consulta.',
    canais: ['whatsapp', 'email'],
    variaveis: ['nome', 'data', 'hora', 'procedimento'],
  },
  {
    kind: 'vespera_curta',
    titulo: 'Lembrete do dia',
    quando: 'Três horas antes da consulta. Só WhatsApp — e-mail não chega a tempo.',
    canais: ['whatsapp'],
    variaveis: ['nome', 'data', 'hora', 'procedimento'],
  },
  {
    kind: 'pos_procedimento',
    titulo: 'Cuidados pós-procedimento',
    quando: '24 horas depois do atendimento registrado.',
    canais: ['whatsapp'],
    variaveis: ['nome', 'procedimento'],
  },
  {
    kind: 'avaliacao',
    titulo: 'Como está o resultado',
    quando: 'Sete dias depois do atendimento.',
    canais: ['whatsapp'],
    variaveis: ['nome', 'procedimento'],
  },
  {
    kind: 'retorno',
    titulo: 'Retorno chegando',
    quando: 'Sete dias antes do vencimento do retorno.',
    canais: ['whatsapp', 'email'],
    variaveis: ['nome', 'procedimento', 'data_retorno'],
  },
]

export function gatilho(kind: ReminderKind): Gatilho {
  const achado = GATILHOS.find((g) => g.kind === kind)
  if (!achado) throw new Error(`Gatilho desconhecido: ${kind}`)
  return achado
}

/**
 * Dados de exemplo da prévia.
 *
 * As datas passam pelos mesmos formatadores de `src/lib/datetime.ts` que o
 * worker usa, e não por uma string escrita à mão: a prévia serve para a Dra. ver
 * a frase pronta, e "20/08/2026" onde o envio real diz "20 de agosto" faria a
 * pontuação da frase parecer certa na tela e errada no WhatsApp.
 */
const EXEMPLO: Record<Variavel, string> = {
  nome: 'Maria',
  data: formatarDataExtensa('2026-08-20'),
  hora: '14:00',
  procedimento: 'Toxina botulínica',
  data_retorno: formatarDataExtensaComAno('2026-12-18'),
}

/**
 * O exemplo restrito ao que o gatilho alimenta.
 *
 * Restringir é o ponto: assim a prévia reproduz o buraco. Um `{{data}}` num
 * texto de pós-procedimento aparece em branco na tela, do mesmo jeito que
 * apareceria na mensagem — o aviso de variável explica a causa, a prévia mostra
 * o estrago.
 */
export function exemploDoGatilho(kind: ReminderKind): Record<string, string> {
  const disponiveis = gatilho(kind).variaveis
  return Object.fromEntries(disponiveis.map((nome) => [nome, EXEMPLO[nome]]))
}

export type AvisoDeVariavel = {
  nome: string
  /**
   * `desconhecida` — não é variável do sistema; quase sempre erro de digitação
   * (`{{procedimeto}}`). `indisponivel` — variável real, mas este gatilho não a
   * alimenta. As duas saem em branco na mensagem; a explicação para a Dra. é
   * diferente, e por isso o motivo viaja junto.
   */
  motivo: 'desconhecida' | 'indisponivel'
}

/**
 * As variáveis do texto que vão sair em branco, na ordem em que aparecem.
 *
 * Aviso, não impedimento — `salvarTemplate` grava mesmo com aviso na tela. É
 * decisão explícita: a lista de variáveis disponíveis por gatilho vive neste
 * arquivo e pode ficar defasada em relação a `worker/fila.ts` num dia em que
 * alguém acrescentar uma variável lá e esquecer daqui. Um aviso defasado é um
 * incômodo; um bloqueio defasado impediria a Dra. de salvar um texto correto,
 * sem saída pela tela.
 */
export function avisosDeVariaveis(texto: string, kind: ReminderKind): AvisoDeVariavel[] {
  const disponiveis = new Set<string>(gatilho(kind).variaveis)
  const conhecidas = new Set<string>(VARIAVEIS_CONHECIDAS)

  return variaveisDoTemplate(texto)
    .filter((nome) => !disponiveis.has(nome))
    .map((nome) => ({
      nome,
      motivo: conhecidas.has(nome) ? ('indisponivel' as const) : ('desconhecida' as const),
    }))
}

export type EntradaDeTemplate = {
  kind: ReminderKind
  channel: Canal
  assunto: string | null
  corpo: string
}

export type ResultadoDaValidacao =
  | { ok: true; valor: EntradaDeTemplate }
  | { ok: false; erro: string }

/**
 * Recusa antes do banco recusar.
 *
 * As três primeiras regras espelham constraints da migration 0007; a quarta não
 * tem equivalente no banco e existe porque a tabela aceitaria uma oitava linha
 * (`vespera_curta` + `email`, por exemplo) que nenhum planejamento produz — texto
 * escrito com cuidado que nunca chegaria a ninguém.
 *
 * O assunto do WhatsApp é zerado em vez de recusado: o formulário não oferece o
 * campo, então um assunto só chega aqui por requisição forjada, e nesse caso
 * descartar o valor é a resposta certa — `templates_email_tem_assunto` exige
 * nulo fora do e-mail.
 */
export function validarTemplate(entrada: EntradaDeTemplate): ResultadoDaValidacao {
  const alvo = GATILHOS.find((g) => g.kind === entrada.kind)
  if (!alvo || !alvo.canais.includes(entrada.channel)) {
    return { ok: false, erro: 'Este lembrete não é enviado por esse canal.' }
  }

  const corpo = entrada.corpo.trim()
  if (corpo === '') {
    return {
      ok: false,
      erro: 'O texto não pode ficar em branco. Para parar de enviar este lembrete, use Desligar.',
    }
  }

  if (entrada.channel === 'email') {
    const assunto = entrada.assunto?.trim() ?? ''
    if (assunto === '') {
      return {
        ok: false,
        erro: 'E-mail precisa de assunto: sem ele a mensagem chega como spam ou "(sem assunto)".',
      }
    }
    return { ok: true, valor: { ...entrada, assunto, corpo } }
  }

  return { ok: true, valor: { ...entrada, assunto: null, corpo } }
}

/** Assunto e corpo renderizados com os dados de exemplo do gatilho. */
export function previaDoTemplate(entrada: EntradaDeTemplate): {
  assunto: string | null
  corpo: string
} {
  const variaveis = exemploDoGatilho(entrada.kind)
  return {
    assunto: entrada.assunto ? renderizarTemplate(entrada.assunto, variaveis) : null,
    corpo: renderizarTemplate(entrada.corpo, variaveis),
  }
}
