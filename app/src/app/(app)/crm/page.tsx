import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina, Kpi } from '@/components/ui'
import { dataDaClinica, deslocarData, instanteDaClinica } from '@/lib/datetime'
import { createServerClient } from '@/lib/supabase/server'
import { Kanban, type PacienteDoFunil } from './kanban'
import { montarKpisDoFunil } from './metricas'

export const metadata = { title: 'Funil' }

/**
 * Funil de pacientes em kanban. Server Component: a consulta roda no servidor,
 * com o client autenticado por cookie, então a RLS de `patients` é quem decide
 * o que volta. Nenhuma chave chega ao browser.
 *
 * Sem filtro de estágio na query: são sete colunas na mesma tela, e uma leitura
 * só é mais barata que sete. O agrupamento acontece no kanban, por função pura.
 *
 * Procedimento de interesse ainda não existe no schema — cartões mostram
 * "A definir" / potencial "—" até haver coluna.
 */
export default async function PaginaDoFunil() {
  await requireSessao()
  const supabase = await createServerClient()
  const agora = new Date()
  const hojeISO = dataDaClinica(agora)
  const inicio30 = instanteDaClinica(deslocarData(hojeISO, -30), 0)

  const [pacientesRes, ticketRes] = await Promise.all([
    supabase
      .from('patients')
      .select('id, nome_completo, telefone, lead_source, stage, criado_em')
      .order('criado_em', { ascending: false }),
    supabase
      .from('attendance_records')
      .select('procedures(preco_centavos)')
      .gte('realizado_em', inicio30.toISOString()),
  ])

  const pacientes = (pacientesRes.data ?? []) as PacienteDoFunil[]
  // PostgREST tipa a FK como array em alguns joins; em runtime é objeto ou null.
  const precos = (ticketRes.data ?? []) as unknown as {
    procedures: { preco_centavos: number } | { preco_centavos: number }[] | null
  }[]
  const comPreco = precos
    .map((l) => {
      const proc = l.procedures
      if (!proc) return null
      return Array.isArray(proc) ? proc[0]?.preco_centavos : proc.preco_centavos
    })
    .filter((v): v is number => typeof v === 'number' && v > 0)
  const ticketMedioCentavos =
    comPreco.length === 0
      ? null
      : Math.round(comPreco.reduce((a, b) => a + b, 0) / comPreco.length)

  const kpis = montarKpisDoFunil(pacientes, hojeISO, ticketMedioCentavos)
  const notaNovos =
    kpis.novosNaSemana === 0
      ? 'esta semana'
      : `+${kpis.novosNaSemana} esta semana`

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6">
      <CabecalhoDePagina
        className="shrink-0"
        secao="Pipeline clínico"
        titulo="Funil de pacientes"
        descricao="Arraste o cartão para mudar o estágio. Leads que não seguiram adiante vão para Descartado — o prontuário do paciente permanece salvo."
        kpis={
          <>
            <Kpi rotulo="Leads ativos" valor={kpis.leadsAtivos} sublegenda={notaNovos} />
            <Kpi rotulo="Conversão" valor={kpis.conversao} sublegenda="lead → paciente" />
            <Kpi rotulo="Ticket médio" valor={kpis.ticketMedio} sublegenda="últimos 30 dias" />
          </>
        }
      />

      {pacientesRes.error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar o funil. Recarregue a página.
        </p>
      ) : (
        <Kanban pacientes={pacientes} />
      )}
    </section>
  )
}
