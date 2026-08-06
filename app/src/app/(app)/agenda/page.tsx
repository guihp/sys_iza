import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina, Kpi } from '@/components/ui'
import { dataDaClinica, deslocarData, instanteDaClinica } from '@/lib/datetime'
import { createServerClient } from '@/lib/supabase/server'
import { diasDaSemana, inicioDaSemana } from './grade'
import { kpisDaSemana } from './kpis-da-semana'
import { ehStatusDeConsulta } from './status'
import {
  AgendaSemanal,
  type ConsultaNaAgenda,
  type OpcaoDePaciente,
  type OpcaoDeProcedimento,
} from './semana'

export const metadata = { title: 'Agenda' }

/** Forma bruta da linha de `appointments` com os dois relacionamentos. */
type LinhaDaAgenda = {
  id: string
  inicio: string
  fim: string
  status: string
  observacoes: string | null
  patients: { nome_completo: string } | null
  procedures: { nome: string } | null
}

/**
 * `?semana=YYYY-MM-DD` vem da URL, então é entrada de usuário. Além do formato,
 * a data precisa existir de verdade: `2026-13-45` casa com a expressão regular
 * mas não é dia nenhum, e `deslocarData` normalizaria em silêncio para fevereiro
 * de 2027 — a agenda abriria numa semana que ninguém pediu.
 */
function semanaPedida(valor: string | string[] | undefined, hoje: string): string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return hoje
  return deslocarData(valor, 0) === valor ? valor : hoje
}

/**
 * Agenda semanal. Server Component: as consultas são lidas no servidor, com o
 * client autenticado por cookie, então quem decide o que volta é a RLS de
 * `appointments`. Nenhuma chave chega ao browser.
 *
 * A semana é recortada no calendário da clínica (America/Sao_Paulo), não no do
 * servidor: a janela vai da meia-noite de segunda em Brasília à meia-noite da
 * segunda seguinte, convertidas em instantes por `instanteDaClinica`.
 */
export default async function PaginaDaAgenda({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string | string[] }>
}) {
  await requireSessao()
  const { semana } = await searchParams

  const hoje = dataDaClinica(new Date())
  const inicioISO = inicioDaSemana(semanaPedida(semana, hoje))
  const dias = diasDaSemana(inicioISO)

  const supabase = await createServerClient()

  const janelaInicio = instanteDaClinica(dias[0], 0)
  const janelaFim = instanteDaClinica(deslocarData(dias[6], 1), 0)

  const [agenda, cadastro, catalogo] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, inicio, fim, status, observacoes, patients(nome_completo), procedures(nome)')
      .gte('inicio', janelaInicio.toISOString())
      .lt('inicio', janelaFim.toISOString())
      .order('inicio'),
    supabase.from('patients').select('id, nome_completo').order('nome_completo'),
    supabase
      .from('procedures')
      .select('id, nome, duracao_minutos')
      .eq('ativo', true)
      .order('nome'),
  ])

  const consultas: ConsultaNaAgenda[] = ((agenda.data ?? []) as unknown as LinhaDaAgenda[]).map(
    (linha) => ({
      id: linha.id,
      inicio: linha.inicio,
      fim: linha.fim,
      // Status desconhecido (enum novo no banco, código antigo na tela) vira
      // 'agendado' em vez de derrubar a página inteira.
      status: ehStatusDeConsulta(linha.status) ? linha.status : 'agendado',
      paciente: linha.patients?.nome_completo ?? 'Paciente removido',
      procedimento: linha.procedures?.nome ?? 'Procedimento removido',
      observacoes: linha.observacoes,
    }),
  )

  const pacientes: OpcaoDePaciente[] = (
    (cadastro.data ?? []) as { id: string; nome_completo: string }[]
  ).map((paciente) => ({ id: paciente.id, nome: paciente.nome_completo }))

  const procedimentos: OpcaoDeProcedimento[] = (
    (catalogo.data ?? []) as { id: string; nome: string; duracao_minutos: number }[]
  ).map((procedimento) => ({
    id: procedimento.id,
    nome: procedimento.nome,
    duracaoMinutos: procedimento.duracao_minutos,
  }))

  const kpis = kpisDaSemana(consultas, dias, hoje)

  return (
    <section className="space-y-6">
      <CabecalhoDePagina
        secao="Semana clínica"
        titulo="Agenda"
        descricao="Clique num horário livre para marcar. Horário ocupado ou fora do expediente é recusado com o motivo — a conferência acontece no servidor, não só na tela."
        kpis={
          <>
            <Kpi rotulo="Atendimentos" valor={kpis.atendimentos} sublegenda="nesta semana" />
            <Kpi
              rotulo="Ocupação"
              valor={`${kpis.ocupacaoPercentual}%`}
              sublegenda="da grade útil"
            />
            <Kpi rotulo="Hoje" valor={kpis.hoje} sublegenda="na cadeira" />
          </>
        }
      />

      {agenda.error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar a agenda. Recarregue a página.
        </p>
      ) : (
        <AgendaSemanal
          inicioDaSemanaISO={inicioISO}
          dias={dias}
          hoje={hoje}
          consultas={consultas}
          pacientes={pacientes}
          procedimentos={procedimentos}
        />
      )}
    </section>
  )
}
