import Link from 'next/link'
import { requireSessao } from '@/auth/session'
import { JANELA_VENCENDO_DIAS } from '@/domain/returns/compute-return'
import { dataDaClinica, formatarDataExtensaComAno } from '@/lib/datetime'
import { createServerClient } from '@/lib/supabase/server'
import { contarPorStatus, montarFila, type AtendimentoDoPaciente, type LinhaDaFila } from './fila'

export const metadata = { title: 'Retornos' }

/**
 * Teto de linhas lidas do prontuário.
 *
 * A fila precisa do atendimento mais RECENTE de cada paciente, e o Postgrest não
 * faz `distinct on` — então a redução acontece em `montarFila`, o que obriga a
 * trazer o histórico e não só as linhas com vencimento. O teto existe para que a
 * consulta não cresça sem limite com os anos; a clínica é de uma profissional só,
 * e a ordenação por `realizado_em desc` garante que, se um dia o teto for
 * atingido, o que ficar de fora é o mais antigo — justamente o que já teria sido
 * descartado pela redução.
 */
const TETO_DE_LINHAS = 5000

type LinhaDoBanco = {
  id: string
  patient_id: string
  realizado_em: string
  retorno_vencimento: string | null
  patients: { nome_completo: string; telefone: string | null } | null
  procedures: { nome: string } | null
}

const CARTAO_DE_STATUS: Record<LinhaDaFila['status'], string> = {
  vencido: 'border-red-600/40 bg-red-500/10',
  vencendo: 'border-amber-600/40 bg-amber-500/10',
}

const BOTAO_DISCRETO = 'rounded-lg border border-linha px-3 py-1.5 text-sm hover:bg-superficie'

/** "vencido há 4 dias" / "vence em 12 dias" / "vence hoje". */
function prazo(linha: LinhaDaFila): string {
  if (linha.diasRestantes < 0) {
    const atraso = Math.abs(linha.diasRestantes)
    return `vencido há ${atraso} ${atraso === 1 ? 'dia' : 'dias'}`
  }
  if (linha.diasRestantes === 0) return 'vence hoje'
  return `vence em ${linha.diasRestantes} ${linha.diasRestantes === 1 ? 'dia' : 'dias'}`
}

/**
 * Fila de retornos: quem precisa ser chamado de volta.
 *
 * Server Component. A leitura roda no servidor com o client autenticado por
 * cookie, então a RLS de `attendance_records` decide o que volta — e ela dá
 * SELECT à equipe inteira justamente para esta tela: é a secretária quem liga.
 *
 * O fuso entra uma vez só, em `dataDaClinica(new Date())`: qual é o dia de hoje
 * na clínica. Das 21:00 em diante, em Brasília, o servidor em UTC já virou o dia
 * — e um "hoje" tirado dele marcaria como vencido quem só vence amanhã, e
 * mandaria a secretária cobrar paciente em dia. Depois disso a conta é
 * calendário puro, em `montarFila`.
 */
export default async function PaginaDeRetornos() {
  await requireSessao()
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, patient_id, realizado_em, retorno_vencimento, patients(nome_completo, telefone), procedures(nome)')
    .order('realizado_em', { ascending: false })
    .limit(TETO_DE_LINHAS)

  const registros: AtendimentoDoPaciente[] = ((data ?? []) as unknown as LinhaDoBanco[]).map(
    (linha) => ({
      atendimentoId: linha.id,
      pacienteId: linha.patient_id,
      paciente: linha.patients?.nome_completo ?? 'Paciente removido',
      telefone: linha.patients?.telefone ?? null,
      procedimento: linha.procedures?.nome ?? 'Procedimento removido',
      realizadoEm: linha.realizado_em,
      vencimento: linha.retorno_vencimento,
    }),
  )

  const hojeISO = dataDaClinica(new Date())
  const fila = montarFila(registros, hojeISO)
  const { vencidos, vencendo } = contarPorStatus(fila)

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Retornos</h1>
        <p className="text-sm text-texto/60">
          Quem já passou do retorno e quem passa nos próximos {JANELA_VENCENDO_DIAS} dias. Conta o
          atendimento mais recente de cada paciente — quem voltou sai da lista sozinha.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar a fila de retornos. Recarregue a página.
        </p>
      ) : (
        <>
          <div className="flex gap-3">
            <p className="rounded-xl border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm">
              <strong className="font-serif text-xl">{vencidos}</strong>{' '}
              {vencidos === 1 ? 'vencido' : 'vencidos'}
            </p>
            <p className="rounded-xl border border-amber-600/40 bg-amber-500/10 px-4 py-3 text-sm">
              <strong className="font-serif text-xl">{vencendo}</strong> a vencer
            </p>
          </div>

          {fila.length === 0 ? (
            <p className="text-sm text-texto/60">
              Nenhum retorno vencido nem a vencer. Nada a cobrar hoje.
            </p>
          ) : (
            <ul className="space-y-2">
              {fila.map((linha) => (
                <li
                  key={linha.atendimentoId}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
                    CARTAO_DE_STATUS[linha.status]
                  }`}
                >
                  <div className="space-y-0.5 text-sm">
                    <p className="font-medium">
                      <Link href={`/pacientes/${linha.pacienteId}`} className="hover:underline">
                        {linha.paciente}
                      </Link>
                    </p>
                    <p className="text-texto/70">
                      {linha.procedimento}
                      {linha.telefone ? ` · ${linha.telefone}` : ' · sem telefone'}
                    </p>
                    <p className="text-texto/60">
                      {formatarDataExtensaComAno(linha.vencimento)} · {prazo(linha)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link href="/agenda" className={BOTAO_DISCRETO}>
                      Agendar
                    </Link>
                    {linha.telefone ? (
                      <a
                        href={`https://wa.me/${linha.telefone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={BOTAO_DISCRETO}
                      >
                        Abrir conversa
                      </a>
                    ) : (
                      <Link href={`/pacientes/${linha.pacienteId}`} className={BOTAO_DISCRETO}>
                        Ver ficha
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
