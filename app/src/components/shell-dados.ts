import type { Sessao } from '@/auth/session'
import { montarFila, type AtendimentoDoPaciente } from '@/app/(app)/retornos/fila'
import { carregarCobrancasParaMetricas } from '@/app/(app)/financeiro/cobrancas'
import { recebidoDoMesCentavos } from '@/app/(app)/financeiro/metricas'
import { carregarMetaMensalCentavos } from '@/lib/clinic-settings'
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
 *
 * Realizado = caixa recebido no mês, não faturamento de catálogo (mesma regra
 * do KPI "Recebido" em `/financeiro`).
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
  /** Alvo do mês corrente (`clinic_meta_mensal`, com fallback em `clinic_settings`). */
  metaDoMesCentavos: number
  hojeISO: string
}

/** Estágios que NÃO contam como lead ativo. */
const FORA_DO_FUNIL = ['paciente', 'descartado']

export async function carregarDadosDaCasca(sessao: Sessao): Promise<DadosCarregadosDaCasca> {
  const hojeISO = dataDaClinica(new Date())
  const supabase = await createServerClient()

  const inicioDeHoje = instanteDaClinica(hojeISO, 0)
  const fimDeHoje = instanteDaClinica(deslocarData(hojeISO, 1), 0)

  const [funil, agenda, prontuario, cobrancas, templates, metaDoMesCentavos] = await Promise.all([
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

    carregarCobrancasParaMetricas(),

    // A secretária não vê Configurações no menu; o contador de mensagens ativas
    // só aparece ali. A RLS deixaria ela ler, mas o número não iria a lugar
    // nenhum.
    sessao.role === 'dra'
      ? supabase
          .from('message_templates')
          .select('kind', { count: 'exact', head: true })
          .eq('ativo', true)
      : Promise.resolve({ count: 0, error: null }),

    carregarMetaMensalCentavos(),
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
    // Realizado = caixa recebido no mês, não faturamento de catálogo.
    realizadoDoMesCentavos: recebidoDoMesCentavos(cobrancas, hojeISO),
    metaDoMesCentavos,
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
