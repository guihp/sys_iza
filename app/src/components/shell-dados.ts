import type { Sessao } from '@/auth/session'
import { montarFila, type AtendimentoDoPaciente } from '@/app/(app)/retornos/fila'
import { dataDaClinica, deslocarData, instanteDaClinica } from '@/lib/datetime'
import { createServerClient } from '@/lib/supabase/server'
import { CONTADORES_ZERADOS, type ContadoresDaCasca } from './navegacao'

/**
 * Os números da casca: os contadores do menu e o realizado do mês.
 *
 * Roda no layout, uma vez por navegação, com o client autenticado por cookie —
 * quem decide o que volta é a RLS de cada tabela. Nenhuma chave chega ao
 * browser.
 *
 * Tudo tolera falha em silêncio: se uma das leituras der erro, aquele contador
 * fica zerado e some da lateral. Um número errado no menu é ruído; a casca
 * inteira caindo por causa de um contador seria a tela toda perdida por um
 * enfeite.
 */

/**
 * Teto de linhas do prontuário lidas para contar vencidos. Mesmo raciocínio do
 * teto da tela de Retornos: a redução ao último atendimento de cada paciente
 * acontece na aplicação, porque o PostgREST não faz `distinct on`.
 */
const TETO_DE_LINHAS = 5000

export type DadosCarregadosDaCasca = {
  contadores: ContadoresDaCasca
  realizadoDoMesCentavos: number
  hojeISO: string
}

/** Estágios que NÃO contam como lead ativo. */
const FORA_DO_FUNIL = ['paciente', 'descartado']

export async function carregarDadosDaCasca(sessao: Sessao): Promise<DadosCarregadosDaCasca> {
  const hojeISO = dataDaClinica(new Date())
  const supabase = await createServerClient()

  const inicioDeHoje = instanteDaClinica(hojeISO, 0)
  const fimDeHoje = instanteDaClinica(deslocarData(hojeISO, 1), 0)

  const primeiroDoMes = `${hojeISO.slice(0, 7)}-01`
  const inicioDoMes = instanteDaClinica(primeiroDoMes, 0)
  // Dia 1 do mês seguinte, sem aritmética de calendário na mão.
  const proximoMes =
    Number(hojeISO.slice(5, 7)) === 12
      ? `${Number(hojeISO.slice(0, 4)) + 1}-01-01`
      : `${hojeISO.slice(0, 4)}-${String(Number(hojeISO.slice(5, 7)) + 1).padStart(2, '0')}-01`
  const fimDoMes = instanteDaClinica(proximoMes, 0)

  const [funil, agenda, prontuario, mes, templates] = await Promise.all([
    supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .not('stage', 'in', `(${FORA_DO_FUNIL.join(',')})`),

    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .gte('inicio', inicioDeHoje.toISOString())
      .lt('inicio', fimDeHoje.toISOString())
      .neq('status', 'cancelado'),

    // Só as três colunas de que a conta precisa. A tela de Retornos lê as
    // mesmas linhas com os dois relacionamentos; aqui, que é só um número na
    // lateral, o join sairia caro à toa.
    supabase
      .from('attendance_records')
      .select('id, patient_id, realizado_em, retorno_vencimento')
      .order('realizado_em', { ascending: false })
      .limit(TETO_DE_LINHAS),

    supabase
      .from('attendance_records')
      .select('procedures(preco_centavos)')
      .gte('realizado_em', inicioDoMes.toISOString())
      .lt('realizado_em', fimDoMes.toISOString()),

    // A secretária não vê o item Mensagens no menu; não há por que buscar o
    // número dele. A RLS deixaria ela ler, mas o contador não iria a lugar
    // nenhum.
    sessao.role === 'dra'
      ? supabase
          .from('message_templates')
          .select('kind', { count: 'exact', head: true })
          .eq('ativo', true)
      : Promise.resolve({ count: 0, error: null }),
  ])

  return {
    hojeISO,
    contadores: {
      ...CONTADORES_ZERADOS,
      funil: funil.count ?? 0,
      agendaHoje: agenda.count ?? 0,
      retornosVencidos: contarVencidos(prontuario.data, hojeISO),
      mensagensAtivas: templates.count ?? 0,
    },
    realizadoDoMesCentavos: somarRealizado(mes.data),
  }
}

type LinhaDeProntuario = {
  id: string
  patient_id: string
  realizado_em: string
  retorno_vencimento: string | null
}

/**
 * Quantos retornos estão vencidos.
 *
 * Reusa `montarFila`, que é a regra já testada da tela de Retornos — inclusive
 * o passo que salva a conta de mentir: só o atendimento mais recente de cada
 * paciente descreve a situação de agora. Os campos de exibição vão em branco de
 * propósito; `montarFila` não os lê, e inventar nome de paciente aqui só
 * abriria caminho para eles vazarem para algum lugar.
 */
function contarVencidos(data: unknown, hojeISO: string): number {
  const registros: AtendimentoDoPaciente[] = ((data ?? []) as LinhaDeProntuario[]).map((linha) => ({
    atendimentoId: linha.id,
    pacienteId: linha.patient_id,
    paciente: '',
    apelido: null,
    telefone: null,
    procedimento: '',
    intervaloRetornoDias: null,
    realizadoEm: linha.realizado_em,
    vencimento: linha.retorno_vencimento,
  }))

  return montarFila(registros, hojeISO).filter((linha) => linha.status === 'vencido').length
}

/**
 * Realizado do mês: soma do preço de catálogo dos atendimentos registrados.
 *
 * É estimativa, e assumidamente: `attendance_records` não guarda valor cobrado,
 * então o que dá para somar é o preço padrão do procedimento no catálogo de
 * hoje. Desconto, cortesia e reajuste passado não aparecem. Serve para a barra
 * da meta, não para fechar caixa.
 */
function somarRealizado(data: unknown): number {
  const linhas = (data ?? []) as { procedures: { preco_centavos: number } | null }[]
  return linhas.reduce((total, linha) => total + (linha.procedures?.preco_centavos ?? 0), 0)
}
