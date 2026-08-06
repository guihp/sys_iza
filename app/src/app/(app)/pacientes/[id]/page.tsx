import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
import { statusRetorno } from '@/domain/returns/compute-return'
import {
  dataDaClinica,
  diaDeCalendario,
  formatarDataExtensa,
  formatarDataExtensaComAno,
  horaDaClinica,
} from '@/lib/datetime'
import { createServerClient } from '@/lib/supabase/server'
import { ROTULOS, ehEstagio } from '../../crm/estagios'
import {
  RegistrarAtendimento,
  type OpcaoDeConsulta,
  type OpcaoDeProcedimento,
} from './registrar-atendimento'

export const metadata = { title: 'Ficha do paciente' }

/** Quantas consultas passadas aparecem no seletor de vínculo do formulário. */
const CONSULTAS_NO_SELETOR = 20

type LinhaDeAtendimento = {
  id: string
  realizado_em: string
  regiao_tratada: string | null
  quantidade: string | null
  observacoes: string | null
  retorno_vencimento: string | null
  sem_retorno: boolean
  procedures: { nome: string } | null
}

type LinhaDeConsulta = {
  id: string
  inicio: string
  status: string
  procedures: { nome: string } | null
}

/**
 * Ficha do paciente: cadastro, prontuário e o formulário de registro.
 *
 * Server Component. As três consultas rodam no servidor com o client autenticado
 * por cookie, então quem decide o que volta é a RLS — inclusive a de
 * `attendance_records`, que dá SELECT à equipe inteira. A secretária abre esta
 * página e lê o prontuário; o que ela não recebe é o formulário, e mesmo que o
 * recebesse a Server Action e a policy da 0006 a barrariam.
 */
export default async function FichaDoPaciente({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await requireSessao()
  const { id } = await params

  const supabase = await createServerClient()

  const { data: paciente, error } = await supabase
    .from('patients')
    .select('id, nome_completo, como_prefere_ser_chamado, telefone, email, stage, observacoes')
    .eq('id', id)
    .maybeSingle()

  // `error` cobre o id malformado (o Postgres recusa o cast para uuid) e
  // `!paciente` cobre o id válido que não existe ou que a RLS não deixa ler.
  if (error || !paciente) notFound()

  const [catalogo, agenda, prontuario] = await Promise.all([
    supabase
      .from('procedures')
      .select('id, nome, default_return_interval_days')
      .eq('ativo', true)
      .order('nome'),
    supabase
      .from('appointments')
      .select('id, inicio, status, procedures(nome)')
      .eq('patient_id', id)
      .neq('status', 'cancelado')
      .order('inicio', { ascending: false })
      .limit(CONSULTAS_NO_SELETOR),
    supabase
      .from('attendance_records')
      .select(
        'id, realizado_em, regiao_tratada, quantidade, observacoes, retorno_vencimento, sem_retorno, procedures(nome)',
      )
      .eq('patient_id', id)
      .order('realizado_em', { ascending: false }),
  ])

  const procedimentos: OpcaoDeProcedimento[] = (
    (catalogo.data ?? []) as { id: string; nome: string; default_return_interval_days: number | null }[]
  ).map((procedimento) => ({
    id: procedimento.id,
    nome: procedimento.nome,
    retornoPadraoDias: procedimento.default_return_interval_days,
  }))

  const consultas: OpcaoDeConsulta[] = (
    (agenda.data ?? []) as unknown as LinhaDeConsulta[]
  ).map((consulta) => {
    const inicio = new Date(consulta.inicio)
    return {
      id: consulta.id,
      // Data e hora saem do fuso da clínica, não dos caracteres do ISO: uma
      // consulta às 21:00 de Brasília já é o dia seguinte em UTC.
      rotulo: `${formatarDataExtensa(dataDaClinica(inicio))} · ${horaDaClinica(inicio)} · ${
        consulta.procedures?.nome ?? 'Procedimento removido'
      }`,
    }
  })

  const atendimentos = (prontuario.data ?? []) as unknown as LinhaDeAtendimento[]

  const hojeISO = dataDaClinica(new Date())
  const hoje = diaDeCalendario(hojeISO)

  const nome = paciente.como_prefere_ser_chamado || paciente.nome_completo
  const estagio = ehEstagio(paciente.stage) ? ROTULOS[paciente.stage] : '—'

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <Link href="/crm" className="text-sm text-texto/60 hover:text-texto">
          ← Voltar ao funil
        </Link>
        <h1 className="font-serif text-2xl">{paciente.nome_completo}</h1>
        <p className="text-sm text-texto/60">
          {[nome !== paciente.nome_completo ? `Chamar de ${nome}` : null, paciente.telefone, paciente.email, estagio]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {paciente.observacoes && <p className="text-sm text-texto/60">{paciente.observacoes}</p>}
      </header>

      {sessao.role === 'dra' ? (
        <RegistrarAtendimento
          pacienteId={paciente.id}
          hojeISO={hojeISO}
          procedimentos={procedimentos}
          consultas={consultas}
        />
      ) : (
        <p className="rounded-xl border border-linha p-4 text-sm text-texto/60">
          O prontuário é registrado e editado somente pela Dra. Aqui você consulta o histórico e o
          retorno previsto.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-serif text-lg">Prontuário</h2>

        {prontuario.error ? (
          <p role="alert" className="text-sm text-red-600">
            Não foi possível carregar o prontuário. Recarregue a página.
          </p>
        ) : atendimentos.length === 0 ? (
          <p className="text-sm text-texto/60">Nenhum atendimento registrado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {atendimentos.map((atendimento) => {
              const realizado = dataDaClinica(new Date(atendimento.realizado_em))
              const status = statusRetorno(
                atendimento.retorno_vencimento
                  ? diaDeCalendario(atendimento.retorno_vencimento)
                  : null,
                hoje,
              )

              return (
                <li key={atendimento.id} className="rounded-xl border border-linha p-4 text-sm">
                  <p className="font-medium">
                    {formatarDataExtensaComAno(realizado)} ·{' '}
                    {atendimento.procedures?.nome ?? 'Procedimento removido'}
                  </p>
                  {(atendimento.regiao_tratada || atendimento.quantidade) && (
                    <p className="text-texto/70">
                      {[atendimento.regiao_tratada, atendimento.quantidade]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  {atendimento.observacoes && (
                    <p className="text-texto/60">{atendimento.observacoes}</p>
                  )}
                  <p className="text-texto/50">
                    {atendimento.retorno_vencimento
                      ? `Retorno ${TEXTO_DE_STATUS[status]} · ${formatarDataExtensaComAno(atendimento.retorno_vencimento)}`
                      : atendimento.sem_retorno
                        ? 'Sem retorno — dispensado pela Dra.'
                        : 'Sem retorno previsto'}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </section>
  )
}

/** Texto que acompanha a data do retorno em cada linha do prontuário. */
const TEXTO_DE_STATUS: Record<ReturnType<typeof statusRetorno>, string> = {
  sem_retorno: 'não previsto',
  em_dia: 'em dia',
  vencendo: 'a vencer',
  vencido: 'vencido',
}
