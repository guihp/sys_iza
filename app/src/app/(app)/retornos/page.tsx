import { requireSessao } from '@/auth/session'
import {
  Avatar,
  CabecalhoDePagina,
  Cartao,
  EstadoVazio,
  Kpi,
  PilulaLink,
  classesDePilula,
  Tabela,
  TabelaCabecalho,
  TabelaCelula,
  TabelaColuna,
  TabelaCorpo,
  TabelaLinha,
} from '@/components/ui'
import { renderizarTemplate } from '@/domain/reminders/template'
import { dataDaClinica, formatarDataCurta, formatarDataExtensaComAno } from '@/lib/datetime'
import { formatarTelefone } from '@/lib/phone'
import { createServerClient } from '@/lib/supabase/server'
import {
  descreverCiclo,
  filtrarFila,
  filtroDaUrl,
  linkWhatsApp,
  textoDoRetorno,
  tratamentoParaMensagem,
  type FiltroDaFila,
} from './apresentacao'
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

/**
 * Title do botão WhatsApp. O mockup deixa claro que isto abre o app da
 * secretária — não dispara a Evolution.
 */
const TITULO_WHATSAPP =
  'Abre o WhatsApp com a mensagem pronta. Não envia pela Evolution — a secretária conversa na mão.'

type LinhaDoBanco = {
  id: string
  patient_id: string
  realizado_em: string
  retorno_vencimento: string | null
  patients: {
    nome_completo: string
    como_prefere_ser_chamado: string | null
    telefone: string | null
  } | null
  procedures: { nome: string; default_return_interval_days: number | null } | null
}

const FILTROS: { id: FiltroDaFila; rotulo: string }[] = [
  { id: 'vencidos', rotulo: 'vencidos' },
  { id: 'a_vencer', rotulo: 'a vencer' },
  { id: 'todos', rotulo: 'todos' },
]

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
export default async function PaginaDeRetornos({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string | string[] }>
}) {
  await requireSessao()
  const { filtro: filtroBruto } = await searchParams
  const filtro = filtroDaUrl(filtroBruto)

  const supabase = await createServerClient()

  const [prontuario, template] = await Promise.all([
    supabase
      .from('attendance_records')
      .select(
        'id, patient_id, realizado_em, retorno_vencimento, patients(nome_completo, como_prefere_ser_chamado, telefone), procedures(nome, default_return_interval_days)',
      )
      .order('realizado_em', { ascending: false })
      .limit(TETO_DE_LINHAS),
    supabase
      .from('message_templates')
      .select('corpo')
      .eq('kind', 'retorno')
      .eq('channel', 'whatsapp')
      .eq('ativo', true)
      .maybeSingle(),
  ])

  const registros: AtendimentoDoPaciente[] = (
    (prontuario.data ?? []) as unknown as LinhaDoBanco[]
  ).map((linha) => ({
    atendimentoId: linha.id,
    pacienteId: linha.patient_id,
    paciente: linha.patients?.nome_completo ?? 'Paciente removido',
    apelido: linha.patients?.como_prefere_ser_chamado ?? null,
    telefone: linha.patients?.telefone ?? null,
    procedimento: linha.procedures?.nome ?? 'Procedimento removido',
    intervaloRetornoDias: linha.procedures?.default_return_interval_days ?? null,
    realizadoEm: linha.realizado_em,
    vencimento: linha.retorno_vencimento,
  }))

  const hojeISO = dataDaClinica(new Date())
  const fila = montarFila(registros, hojeISO)
  const { vencidos, vencendo } = contarPorStatus(fila)
  const visivel = filtrarFila(fila, filtro)
  const corpoDoTemplate = template.data?.corpo ?? ''

  /**
   * CONTATADAS nesta rodada.
   *
   * O botão WhatsApp abre `wa.me` na mão da secretária e **não** grava nada —
   * não há coluna nem evento de "contatei nesta rodada". Sem fonte de verdade,
   * o número honesto é zero. Quando houver rastreio, este KPI passa a ler dali.
   */
  const contatadas = 0

  return (
    <section className="space-y-6">
      <CabecalhoDePagina
        secao="Reativação"
        titulo="Retornos"
        descricao="Quem já passou do retorno e quem vence nos próximos 30 dias. Conta o atendimento mais recente de cada paciente — quem voltou sai da lista sozinho."
        kpis={
          <>
            <Kpi rotulo="Vencidos" valor={vencidos} sublegenda="aguardando contato" />
            <Kpi rotulo="Próximos 30 dias" valor={vencendo} sublegenda="a vencer" />
            <Kpi rotulo="Contatadas" valor={contatadas} sublegenda="nesta rodada" />
          </>
        }
      />

      {prontuario.error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar a fila de retornos. Recarregue a página.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {FILTROS.map((chip) => {
              const ativo = filtro === chip.id
              const contagem =
                chip.id === 'vencidos' ? vencidos : chip.id === 'a_vencer' ? vencendo : fila.length
              return (
                <PilulaLink
                  key={chip.id}
                  href={`/retornos?filtro=${chip.id}`}
                  variante={ativo ? 'contorno' : 'suave'}
                  className={ativo ? 'border-acento text-acento' : undefined}
                  aria-current={ativo ? 'page' : undefined}
                >
                  {ativo ? (
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-current"
                    />
                  ) : null}
                  {chip.rotulo} {contagem}
                </PilulaLink>
              )
            })}
          </div>

          {fila.length === 0 || visivel.length === 0 ? (
            <Cartao className="p-4">
              <EstadoVazio
                mensagem="Ninguém para reativar agora."
                explicacao="A fila enche sozinha conforme os atendimentos vencem."
              />
            </Cartao>
          ) : (
            <Cartao className="px-4">
              <Tabela>
                <TabelaCabecalho>
                  <TabelaLinha>
                    <TabelaColuna>Paciente</TabelaColuna>
                    <TabelaColuna>Último procedimento</TabelaColuna>
                    <TabelaColuna>Atendida em</TabelaColuna>
                    <TabelaColuna>Retorno</TabelaColuna>
                    <TabelaColuna>
                      <span className="sr-only">Ações</span>
                    </TabelaColuna>
                  </TabelaLinha>
                </TabelaCabecalho>
                <TabelaCorpo>
                  {visivel.map((linha) => (
                    <LinhaDeRetorno
                      key={linha.atendimentoId}
                      linha={linha}
                      corpoDoTemplate={corpoDoTemplate}
                    />
                  ))}
                </TabelaCorpo>
              </Tabela>
            </Cartao>
          )}
        </div>
      )}
    </section>
  )
}

function LinhaDeRetorno({
  linha,
  corpoDoTemplate,
}: {
  linha: LinhaDaFila
  corpoDoTemplate: string
}) {
  const ciclo = descreverCiclo(linha.intervaloRetornoDias)
  const atendidaEm = formatarDataCurta(dataDaClinica(new Date(linha.realizadoEm)))
  const previsto = formatarDataCurta(linha.vencimento)
  const vencido = linha.status === 'vencido'
  const mensagem = corpoDoTemplate
    ? renderizarTemplate(corpoDoTemplate, {
        nome: tratamentoParaMensagem(linha.paciente, linha.apelido),
        procedimento: linha.procedimento,
        data_retorno: formatarDataExtensaComAno(linha.vencimento),
      })
    : ''

  return (
    <TabelaLinha>
      <TabelaCelula>
        <div className="flex items-center gap-3">
          <Avatar nome={linha.paciente} />
          <div className="min-w-0">
            <p className="truncate font-serif text-[17px] leading-tight">{linha.paciente}</p>
            <p className="text-[12px] text-texto-suave">{formatarTelefone(linha.telefone)}</p>
          </div>
        </div>
      </TabelaCelula>

      <TabelaCelula>
        <p className="font-serif text-[17px] leading-tight">{linha.procedimento}</p>
        {ciclo ? <p className="text-[12px] text-texto-suave">{ciclo}</p> : null}
      </TabelaCelula>

      <TabelaCelula>
        <p className="text-[13px] text-texto-suave">{atendidaEm}</p>
      </TabelaCelula>

      <TabelaCelula>
        <p className={vencido ? 'text-[13px] text-alerta' : 'text-[13px] text-texto-suave'}>
          {textoDoRetorno(linha.diasRestantes)}
        </p>
        <p className="text-[11px] text-texto-suave">previsto {previsto}</p>
      </TabelaCelula>

      <TabelaCelula>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {linha.telefone ? (
            <a
              href={linkWhatsApp(linha.telefone, mensagem)}
              target="_blank"
              rel="noopener noreferrer"
              className={classesDePilula('solida')}
              title={TITULO_WHATSAPP}
            >
              WhatsApp
            </a>
          ) : null}
          <PilulaLink href="/agenda" variante="contorno">
            Agendar
          </PilulaLink>
        </div>
      </TabelaCelula>
    </TabelaLinha>
  )
}
