import Link from 'next/link'
import { requireSessao } from '@/auth/session'
import {
  Avatar,
  CabecalhoDePagina,
  Cartao,
  EstadoVazio,
  Kpi,
  PilulaLink,
  PilulaTexto,
  RotuloMiudo,
  Tabela,
  TabelaCabecalho,
  TabelaCelula,
  TabelaColuna,
  TabelaCorpo,
  TabelaLinha,
  juntar,
} from '@/components/ui'
import { dataDaClinica, formatarDataCurta } from '@/lib/datetime'
import { createServerClient } from '@/lib/supabase/server'
import type { FormaRestante, StatusCobranca } from '@/domain/finance/cobranca'
import {
  FILTROS_FINANCEIRO,
  formatarMoeda,
  formatarMoedaRedonda,
  rotuloFormaRestante,
  rotuloMes,
  rotuloStatusCobranca,
  sublegendaDoPeriodo,
} from './formatacao'
import { GraficosFinanceiro } from './graficos'
import {
  calcularKpis,
  contarPorFiltro,
  deslocarMes,
  filtrarCobrancas,
  filtroDaUrl,
  periodoDaUrl,
  proximaParcelaAberta,
  resumoParcelas,
  serieRecebidoPorDia,
  serieStatusResumo,
  statusEfetivoDaParcela,
  type CobrancaParaMetricas,
  type FiltroFinanceiro,
  type PeriodoFinanceiro,
} from './metricas'

export const metadata = { title: 'Financeiro' }

const TETO_DE_COBRANCAS = 500

type ParcelaDoBanco = {
  id: string
  numero: number
  valor_centavos: number
  vencimento: string
  pago_em: string | null
  status: string
}

type LinhaDoBanco = {
  id: string
  patient_id: string
  valor_total_centavos: number
  valor_entrada_centavos: number
  valor_proxima_consulta_centavos: number
  valor_parcelado_centavos: number
  parcelas_qtd: number
  forma_restante: FormaRestante | null
  status: StatusCobranca
  criado_em: string
  patients: { nome_completo: string } | null
  attendance_records: { realizado_em: string } | null
  payment_installments: ParcelaDoBanco[] | null
}

type LinhaDeTabela = LinhaNormalizada & CobrancaParaMetricas

type LinhaNormalizada = {
  id: string
  patientId: string
  paciente: string
  realizadoEm: string | null
  valor_total_centavos: number
  valor_entrada_centavos: number
  valor_proxima_consulta_centavos: number
  forma_restante: FormaRestante | null
  status: StatusCobranca
  criado_em: string
  realizado_em: string | null
  parcelas: ParcelaDoBanco[]
}

/**
 * Painel de recebimentos: período (semana / mês / mês escolhido), filtros de
 * status e tabela de cobranças.
 *
 * Equipe inteira lê (Dra. e secretária). Parcelas no cartão seguem o vencimento
 * — não há botão de baixa manual nesta tela.
 */
export default async function PaginaDeFinanceiro({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string | string[]; filtro?: string | string[] }>
}) {
  await requireSessao()
  const { periodo: periodoBruto, filtro: filtroBruto } = await searchParams
  const hojeISO = dataDaClinica(new Date())
  const periodo = periodoDaUrl(periodoBruto, hojeISO)
  const filtro = filtroDaUrl(filtroBruto)
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('patient_charges')
    .select(
      `
      id,
      patient_id,
      valor_total_centavos,
      valor_entrada_centavos,
      valor_proxima_consulta_centavos,
      valor_parcelado_centavos,
      parcelas_qtd,
      forma_restante,
      status,
      criado_em,
      patients(nome_completo),
      attendance_records(realizado_em),
      payment_installments(id, numero, valor_centavos, vencimento, pago_em, status)
    `,
    )
    .order('criado_em', { ascending: false })
    .limit(TETO_DE_COBRANCAS)

  const linhas: LinhaDeTabela[] = ((data ?? []) as unknown as LinhaDoBanco[]).map(normalizarLinha)
  const kpis = calcularKpis(linhas, hojeISO, periodo)
  const contagens = contarPorFiltro(linhas, periodo, hojeISO)
  const linhasVisiveis = filtrarCobrancas(linhas, filtro, periodo, hojeISO)
  const serieRecebido = serieRecebidoPorDia(linhas, hojeISO, periodo)
  const serieStatus = serieStatusResumo(kpis)

  const subPeriodo = sublegendaDoPeriodo(periodo)
  const mesNavegacao = periodo.inicio.slice(0, 7)
  const mesAnterior = deslocarMes(mesNavegacao, -1)
  const mesSeguinte = deslocarMes(mesNavegacao, 1)
  const chavePeriodo = chavePeriodoNaUrl(periodo)

  return (
    <section className="space-y-6">
      <CabecalhoDePagina
        secao="Recebimentos"
        titulo="Financeiro"
        descricao="Entradas dos atendimentos e parcelas no cartão pelo vencimento. Sem baixa manual — o cartão liquida na data."
        kpis={
          <>
            <Kpi
              rotulo="Recebido"
              valor={formatarMoedaRedonda(kpis.recebidoNoPeriodoCentavos)}
              sublegenda={`entradas + parcelas · ${subPeriodo}`}
            />
            <Kpi
              rotulo="A receber"
              valor={formatarMoedaRedonda(kpis.aReceberCentavos)}
              sublegenda="próxima + parcelas abertas"
            />
            <Kpi
              rotulo="Atrasadas"
              valor={formatarMoedaRedonda(kpis.atrasadasCentavos)}
              sublegenda="vencidas sem baixa"
            />
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <RotuloMiudo className="mr-1">Período</RotuloMiudo>
          <PilulaLink
            href={hrefFinanceiro({ periodo: 'semana', filtro })}
            variante={periodo.modo === 'semana' ? 'contorno' : 'suave'}
            className={juntar(
              'min-h-11',
              periodo.modo === 'semana' ? 'border-acento text-acento' : undefined,
            )}
            aria-current={periodo.modo === 'semana' ? 'page' : undefined}
          >
            {periodo.modo === 'semana' ? (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
            ) : null}
            Esta semana
          </PilulaLink>
          <PilulaLink
            href={hrefFinanceiro({ periodo: 'mes', filtro })}
            variante={periodo.modo === 'mes' ? 'contorno' : 'suave'}
            className={juntar(
              'min-h-11',
              periodo.modo === 'mes' ? 'border-acento text-acento' : undefined,
            )}
            aria-current={periodo.modo === 'mes' ? 'page' : undefined}
          >
            {periodo.modo === 'mes' ? (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
            ) : null}
            Este mês
          </PilulaLink>

          <span className="mx-1 hidden h-5 w-px bg-linha sm:block" aria-hidden />

          <PilulaLink
            href={hrefFinanceiro({ periodo: mesAnterior, filtro })}
            variante="suave"
            className="min-h-11"
            title={`Mês anterior: ${rotuloMes(mesAnterior)}`}
          >
            ←
          </PilulaLink>
          <span className="min-w-[10rem] text-center font-serif text-[15px] capitalize tracking-[0.01em]">
            {rotuloMes(mesNavegacao)}
          </span>
          <PilulaLink
            href={hrefFinanceiro({ periodo: mesSeguinte, filtro })}
            variante="suave"
            className="min-h-11"
            title={`Próximo mês: ${rotuloMes(mesSeguinte)}`}
          >
            →
          </PilulaLink>

          <span className="text-[11px] text-texto-suave">
            {formatarDataCurta(periodo.inicio)} a {formatarDataCurta(periodo.fim)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RotuloMiudo className="mr-1">Status</RotuloMiudo>
          {FILTROS_FINANCEIRO.map((opcao) => {
            const ativo = opcao.id === filtro
            const qtd = contagens[opcao.id]
            return (
              <PilulaLink
                key={opcao.id}
                href={hrefFinanceiro({ periodo: chavePeriodo, filtro: opcao.id })}
                variante={ativo ? 'contorno' : 'suave'}
                className={juntar('min-h-11', ativo ? 'border-acento text-acento' : undefined)}
                aria-current={ativo ? 'page' : undefined}
              >
                {ativo ? (
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
                ) : null}
                {opcao.rotulo}
                <span className="text-texto-suave">{qtd}</span>
              </PilulaLink>
            )
          })}
        </div>
      </div>

      {!error ? (
        <GraficosFinanceiro serieRecebido={serieRecebido} serieStatus={serieStatus} />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar as cobranças. Recarregue a página.
        </p>
      ) : linhas.length === 0 ? (
        <Cartao className="p-4">
          <EstadoVazio
            mensagem="Nenhuma cobrança ainda."
            explicacao="Quando um atendimento registrar pagamento, a cobrança aparece aqui com entrada, forma do restante e parcelas."
          />
        </Cartao>
      ) : linhasVisiveis.length === 0 ? (
        <Cartao className="p-4">
          <EstadoVazio
            mensagem={mensagemVazio(filtro)}
            explicacao="Ajuste o período ou o filtro de status para ver outras cobranças."
          />
        </Cartao>
      ) : (
        <Cartao className="px-4">
          <Tabela>
            <TabelaCabecalho>
              <TabelaLinha>
                <TabelaColuna>Paciente</TabelaColuna>
                <TabelaColuna>Data</TabelaColuna>
                <TabelaColuna>Total</TabelaColuna>
                <TabelaColuna>Entrada</TabelaColuna>
                <TabelaColuna>Restante</TabelaColuna>
                <TabelaColuna>Parcelas</TabelaColuna>
                <TabelaColuna>Status</TabelaColuna>
              </TabelaLinha>
            </TabelaCabecalho>
            <TabelaCorpo>
              {linhasVisiveis.map((linha) => (
                <LinhaDeCobranca key={linha.id} linha={linha} hojeISO={hojeISO} />
              ))}
            </TabelaCorpo>
          </Tabela>
        </Cartao>
      )}
    </section>
  )
}

function normalizarLinha(linha: LinhaDoBanco): LinhaDeTabela {
  const parcelas = [...(linha.payment_installments ?? [])].sort((a, b) => a.numero - b.numero)
  const realizadoEm = linha.attendance_records?.realizado_em ?? null
  return {
    id: linha.id,
    patientId: linha.patient_id,
    paciente: linha.patients?.nome_completo ?? 'Paciente removido',
    realizadoEm,
    valor_total_centavos: linha.valor_total_centavos,
    valor_entrada_centavos: linha.valor_entrada_centavos,
    valor_proxima_consulta_centavos: linha.valor_proxima_consulta_centavos,
    forma_restante: linha.forma_restante ?? null,
    status: linha.status,
    criado_em: linha.criado_em,
    realizado_em: realizadoEm,
    parcelas,
  }
}

function LinhaDeCobranca({
  linha,
  hojeISO,
}: {
  linha: LinhaDeTabela
  hojeISO: string
}) {
  const dataAtendimento = linha.realizadoEm
    ? formatarDataCurta(dataDaClinica(new Date(linha.realizadoEm)))
    : '—'
  const resumo = resumoParcelas(linha.parcelas, hojeISO)
  const proxima = proximaParcelaAberta(linha.parcelas, hojeISO)
  const textoParcelas =
    resumo.total === 0 ? '—' : `${resumo.pagas}/${resumo.total} liquidadas`
  const detalheParcela = detalheAgendaParcelas(linha.parcelas, hojeISO, proxima)

  return (
    <TabelaLinha>
      <TabelaCelula>
        <Link
          href={`/pacientes/${linha.patientId}`}
          className="flex items-center gap-3 hover:text-acento"
        >
          <Avatar nome={linha.paciente} />
          <p className="truncate font-serif text-[17px] leading-tight">{linha.paciente}</p>
        </Link>
      </TabelaCelula>

      <TabelaCelula>
        <p className="text-[13px] text-texto-suave">{dataAtendimento}</p>
      </TabelaCelula>

      <TabelaCelula>
        <p className="font-serif text-[15px]">{formatarMoeda(linha.valor_total_centavos)}</p>
      </TabelaCelula>

      <TabelaCelula>
        <p className="text-[13px]">{formatarMoeda(linha.valor_entrada_centavos)}</p>
        {linha.valor_proxima_consulta_centavos > 0 ? (
          <p className="text-[11px] text-texto-suave">
            próxima {formatarMoeda(linha.valor_proxima_consulta_centavos)}
          </p>
        ) : null}
      </TabelaCelula>

      <TabelaCelula>
        <p className="text-[13px]">{rotuloFormaRestante(linha.forma_restante)}</p>
      </TabelaCelula>

      <TabelaCelula>
        <p className="text-[13px]">{textoParcelas}</p>
        {detalheParcela ? (
          <p
            className={juntar(
              'text-[11px]',
              resumo.atrasadas > 0 ? 'text-alerta' : 'text-texto-suave',
            )}
          >
            {detalheParcela}
          </p>
        ) : null}
      </TabelaCelula>

      <TabelaCelula>
        <PilulaTexto variante={linha.status === 'quitado' ? 'suave' : 'contorno'}>
          {rotuloStatusCobranca(linha.status)}
        </PilulaTexto>
      </TabelaCelula>
    </TabelaLinha>
  )
}

function detalheAgendaParcelas(
  parcelas: ParcelaDoBanco[],
  hojeISO: string,
  proxima: ParcelaDoBanco | null,
): string | null {
  if (parcelas.length === 0) return null

  const atrasadas = parcelas.filter((p) => statusEfetivoDaParcela(p, hojeISO) === 'atrasado')
  if (atrasadas.length > 0) {
    const n = atrasadas.length
    return n === 1 ? '1 atrasada' : `${n} atrasadas`
  }

  if (proxima) {
    return `próx. ${formatarDataCurta(proxima.vencimento)}`
  }

  return null
}

function chavePeriodoNaUrl(periodo: PeriodoFinanceiro): string {
  if (periodo.modo === 'semana') return 'semana'
  if (periodo.modo === 'mes') return 'mes'
  return periodo.chave
}

function hrefFinanceiro(args: { periodo: string; filtro: FiltroFinanceiro }): string {
  const params = new URLSearchParams()
  params.set('periodo', args.periodo)
  if (args.filtro !== 'todos') params.set('filtro', args.filtro)
  return `/financeiro?${params.toString()}`
}

function mensagemVazio(filtro: FiltroFinanceiro): string {
  if (filtro === 'a_receber') return 'Nada a receber neste recorte.'
  if (filtro === 'recebido') return 'Nenhum recebimento neste recorte.'
  if (filtro === 'atrasadas') return 'Nenhuma parcela atrasada.'
  if (filtro === 'quitadas') return 'Nenhuma cobrança quitada.'
  return 'Nenhuma cobrança neste período.'
}
