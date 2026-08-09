import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
import { Cartao } from '@/components/ui'
import { abaDaUrl, idadeEmAnos } from '@/domain/clinical/prontuario'
import {
  dataDaClinica,
  formatarDataExtensa,
  horaDaClinica,
} from '@/lib/datetime'
import { urlAssinadaDoArquivo } from '@/lib/pasta-paciente'
import { formatarTelefone } from '@/lib/phone'
import { createServerClient } from '@/lib/supabase/server'
import { ROTULOS, ehEstagio } from '../../crm/estagios'
import { AbasDaFicha } from './abas'
import { FormularioAnamnese } from './anamnese'
import { FormularioAvaliacao } from './avaliacao'
import { FormularioCadastro } from './cadastro'
import { PastaDoPaciente } from './pasta'
import { FormularioPlanos } from './planos'
import { FormularioAtendimentos } from './atendimentos'
import type {
  OpcaoDeConsulta,
  OpcaoDeProcedimento,
  PlanoBotoxOpcao,
  PlanoFillerOpcao,
} from './registrar-atendimento'
import type { AtendimentoCompleto, ItemExecucaoSalvo } from './atendimento-tipos'
import type {
  AnamneseLinha,
  AnotacaoPlano,
  ArquivoLinha,
  AvaliacaoLinha,
  FotoLinha,
  ItemBotox,
  ItemFiller,
  PacienteCadastro,
  PlanoBotox,
  PlanoFiller,
  ProcedimentoDoPlano,
} from './tipos'

export const metadata = { title: 'Ficha do paciente' }

const CONSULTAS_NO_SELETOR = 20

type LinhaDeConsulta = {
  id: string
  inicio: string
  status: string
  procedures: { nome: string } | null
}

/**
 * Ficha clínica completa — abas alinhadas às 6 páginas do PDF.
 * Consultas das abas clínicas falham em silêncio (estado vazio), sem derrubar a ficha.
 */
export default async function FichaDoPaciente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ aba?: string | string[] }>
}) {
  const sessao = await requireSessao()
  const { id } = await params
  const { aba: abaBruta } = await searchParams
  const aba = abaDaUrl(abaBruta)
  const supabase = await createServerClient()

  const { data: paciente, error } = await supabase
    .from('patients')
    .select(
      `id, nome_completo, como_prefere_ser_chamado, nascimento, sexo, telefone, cpf,
       nacionalidade, naturalidade, email, endereco, lead_source, procedimento_interesse_id,
       contato_emergencia_nome, contato_emergencia_parentesco, contato_emergencia_telefone,
       profissao, observacoes, stage, aceita_whatsapp, aceita_email`,
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !paciente) notFound()

  const cadastro = paciente as PacienteCadastro
  const hojeISO = dataDaClinica(new Date())
  const idade = cadastro.nascimento ? idadeEmAnos(cadastro.nascimento, hojeISO) : null
  const nome = cadastro.como_prefere_ser_chamado || cadastro.nome_completo
  const estagio = ehEstagio(cadastro.stage) ? ROTULOS[cadastro.stage] : '—'

  const [catalogo, agenda, anamneseRes, avaliacaoRes, botoxRes, fillerRes, fotosRes, arquivosRes] =
    await Promise.all([
      supabase
        .from('procedures')
        .select('id, nome, default_return_interval_days, preco_centavos, categoria')
        .eq('ativo', true)
        .order('nome'),
      supabase
        .from('appointments')
        .select('id, inicio, status, procedures(nome)')
        .eq('patient_id', id)
        .neq('status', 'cancelado')
        .order('inicio', { ascending: false })
        .limit(CONSULTAS_NO_SELETOR),
      supabase.from('anamneses').select('*').eq('patient_id', id).maybeSingle(),
      supabase.from('skin_assessments').select('*').eq('patient_id', id).maybeSingle(),
      supabase
        .from('botox_plans')
        .select(
          'id, realizado_em, produto_nome, validade, lote, marca, anotacao_json, botox_plan_items(*)',
        )
        .eq('patient_id', id)
        .order('realizado_em', { ascending: false })
        .order('criado_em', { ascending: false }),
      supabase
        .from('filler_plans')
        .select(
          'id, realizado_em, produto_nome, validade, lote, marca, anotacao_json, filler_plan_items(*)',
        )
        .eq('patient_id', id)
        .order('realizado_em', { ascending: false })
        .order('criado_em', { ascending: false }),
      supabase
        .from('photos')
        .select('id, angulo, storage_path, mime_type, criado_em')
        .eq('patient_id', id)
        .order('criado_em', { ascending: false }),
      supabase
        .from('patient_files')
        .select('id, titulo, categoria, storage_path, mime_type, criado_em')
        .eq('patient_id', id)
        .order('criado_em', { ascending: false }),
    ])

  const prontuario = await supabase
    .from('attendance_records')
    .select(
      `id, realizado_em, procedure_id, appointment_id, regiao_tratada, quantidade, produto, lote,
       observacoes, termo_assinado, retorno_vencimento, sem_retorno, retorno_ajuste_dias, retorno_data,
       execucao_status, botox_plan_id, filler_plan_id,
       procedures(nome),
       attendance_execution_items(
         id, ordem, rotulo, unidade, procedimento_id, preco_centavos,
         planejado_qtd, feito_qtd, planejado_centavos, feito_centavos
       ),
       patient_charges(
         id, valor_total_centavos, valor_entrada_centavos, valor_proxima_consulta_centavos,
         valor_parcelado_centavos, parcelas_qtd, juros_maquininha_centavos,
         juros_repassados_ao_cliente, forma_entrada, forma_restante, status,
         payment_installments(id, numero, valor_centavos, vencimento, pago_em, status)
       )`,
    )
    .eq('patient_id', id)
    .order('realizado_em', { ascending: false })

  const procedimentos: OpcaoDeProcedimento[] = (
    (catalogo.data ?? []) as {
      id: string
      nome: string
      default_return_interval_days: number | null
      preco_centavos: number
      categoria: string | null
    }[]
  ).map((procedimento) => ({
    id: procedimento.id,
    nome: procedimento.nome,
    retornoPadraoDias: procedimento.default_return_interval_days,
    precoCentavos: procedimento.preco_centavos,
  }))

  const procedimentosDoPlano: ProcedimentoDoPlano[] = (
    (catalogo.data ?? []) as {
      id: string
      nome: string
      preco_centavos: number
      categoria: string | null
    }[]
  ).map((p) => ({
    id: p.id,
    nome: p.nome,
    preco_centavos: p.preco_centavos,
    categoria: p.categoria,
  }))

  const consultas: OpcaoDeConsulta[] = (
    (agenda.data ?? []) as unknown as LinhaDeConsulta[]
  ).map((consulta) => {
    const inicio = new Date(consulta.inicio)
    return {
      id: consulta.id,
      rotulo: `${formatarDataExtensa(dataDaClinica(inicio))} · ${horaDaClinica(inicio)} · ${
        consulta.procedures?.nome ?? 'Procedimento removido'
      }`,
    }
  })

  const atendimentos: AtendimentoCompleto[] = (prontuario.data ?? []).map((linha) => {
    const a = linha as unknown as {
      id: string
      realizado_em: string
      procedure_id: string
      appointment_id: string | null
      regiao_tratada: string | null
      quantidade: string | null
      produto: string | null
      lote: string | null
      observacoes: string | null
      termo_assinado: boolean | null
      retorno_vencimento: string | null
      sem_retorno: boolean
      retorno_ajuste_dias: number | null
      retorno_data: string | null
      execucao_status: AtendimentoCompleto['execucao_status'] | null
      botox_plan_id: string | null
      filler_plan_id: string | null
      procedures: { nome: string } | null
      attendance_execution_items: ItemExecucaoSalvo[] | null
      patient_charges:
        | (Omit<NonNullable<AtendimentoCompleto['cobranca']>, 'parcelas'> & {
            payment_installments: NonNullable<
              AtendimentoCompleto['cobranca']
            >['parcelas'] | null
          })
        | (Omit<NonNullable<AtendimentoCompleto['cobranca']>, 'parcelas'> & {
            payment_installments: NonNullable<
              AtendimentoCompleto['cobranca']
            >['parcelas'] | null
          })[]
        | null
    }

    const cobrancaBruta = Array.isArray(a.patient_charges)
      ? a.patient_charges[0] ?? null
      : a.patient_charges ?? null

    const itens = [...(a.attendance_execution_items ?? [])]
      .map((item) => ({
        ...item,
        planejado_qtd: Number(item.planejado_qtd),
        feito_qtd: Number(item.feito_qtd),
        unidade: item.unidade as ItemExecucaoSalvo['unidade'],
      }))
      .sort((x, y) => x.ordem - y.ordem)

    const cobranca = cobrancaBruta
      ? {
          id: cobrancaBruta.id,
          valor_total_centavos: cobrancaBruta.valor_total_centavos,
          valor_entrada_centavos: cobrancaBruta.valor_entrada_centavos,
          valor_proxima_consulta_centavos: cobrancaBruta.valor_proxima_consulta_centavos,
          valor_parcelado_centavos: cobrancaBruta.valor_parcelado_centavos,
          parcelas_qtd: cobrancaBruta.parcelas_qtd,
          juros_maquininha_centavos: cobrancaBruta.juros_maquininha_centavos,
          juros_repassados_ao_cliente: cobrancaBruta.juros_repassados_ao_cliente,
          forma_entrada: cobrancaBruta.forma_entrada,
          forma_restante: cobrancaBruta.forma_restante ?? null,
          status: cobrancaBruta.status,
          parcelas: [...(cobrancaBruta.payment_installments ?? [])].sort(
            (x, y) => x.numero - y.numero,
          ),
        }
      : null

    return {
      id: a.id,
      realizado_em: a.realizado_em,
      procedure_id: a.procedure_id,
      appointment_id: a.appointment_id,
      regiao_tratada: a.regiao_tratada,
      quantidade: a.quantidade,
      produto: a.produto,
      lote: a.lote,
      observacoes: a.observacoes,
      termo_assinado: a.termo_assinado === true,
      retorno_vencimento: a.retorno_vencimento,
      sem_retorno: a.sem_retorno,
      retorno_ajuste_dias: a.retorno_ajuste_dias,
      retorno_data: a.retorno_data,
      execucao_status: a.execucao_status ?? 'nao_aplicavel',
      botox_plan_id: a.botox_plan_id,
      filler_plan_id: a.filler_plan_id,
      procedures: a.procedures,
      itens,
      cobranca,
    } satisfies AtendimentoCompleto
  })

  const anamnese = (anamneseRes.data ?? null) as AnamneseLinha | null
  const avaliacao = (avaliacaoRes.data ?? null) as AvaliacaoLinha | null

  const botoxLista = (botoxRes.data ?? []) as (Omit<PlanoBotox, 'itens' | 'anotacao_json'> & {
    anotacao_json: AnotacaoPlano | null
    botox_plan_items: ItemBotox[] | null
  })[]
  const planosBotox: PlanoBotox[] = botoxLista.map((plano) => ({
    id: plano.id,
    realizado_em: plano.realizado_em,
    produto_nome: plano.produto_nome,
    validade: plano.validade,
    lote: plano.lote,
    marca: plano.marca,
    anotacao_json: plano.anotacao_json,
    itens: [...(plano.botox_plan_items ?? [])]
      .map((item) => ({
        ...item,
        procedimento_id: item.procedimento_id ?? null,
      }))
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)),
  }))

  const fillerLista = (fillerRes.data ?? []) as (Omit<PlanoFiller, 'itens' | 'anotacao_json'> & {
    anotacao_json: AnotacaoPlano | null
    filler_plan_items: ItemFiller[] | null
  })[]
  const planosFiller: PlanoFiller[] = fillerLista.map((plano) => ({
    id: plano.id,
    realizado_em: plano.realizado_em,
    produto_nome: plano.produto_nome,
    validade: plano.validade,
    lote: plano.lote,
    marca: plano.marca,
    anotacao_json: plano.anotacao_json,
    itens: [...(plano.filler_plan_items ?? [])]
      .map((item) => ({
        ...item,
        procedimento_id: item.procedimento_id ?? null,
      }))
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)),
  }))

  const planosBotoxOpcao: PlanoBotoxOpcao[] = planosBotox.map((plano) => {
    const totalU = plano.itens.reduce(
      (soma, item) => soma + (item.total_unidades ?? item.quantidade_unidades ?? 0),
      0,
    )
    const data = formatarDataExtensa(dataDaClinica(new Date(plano.realizado_em)))
    const partes = [
      data,
      plano.produto_nome || null,
      totalU > 0 ? `${totalU} U` : null,
    ].filter(Boolean)
    return {
      id: plano.id,
      rotulo: partes.join(' · '),
      itens: plano.itens.map((item) => ({
        musculo: item.musculo,
        quantidade_unidades: item.quantidade_unidades,
        total_unidades: item.total_unidades,
        procedimento_id: item.procedimento_id,
        ordem: item.ordem,
      })),
    }
  })

  const planosFillerOpcao: PlanoFillerOpcao[] = planosFiller.map((plano) => {
    const totalMl = plano.itens.reduce((soma, item) => soma + (item.quantidade_ml ?? 0), 0)
    const data = formatarDataExtensa(dataDaClinica(new Date(plano.realizado_em)))
    const mlTexto =
      totalMl > 0
        ? `${Number.isInteger(totalMl) ? String(totalMl) : String(totalMl).replace('.', ',')} mL`
        : null
    const partes = [data, plano.produto_nome || null, mlTexto].filter(Boolean)
    return {
      id: plano.id,
      rotulo: partes.join(' · '),
      itens: plano.itens.map((item) => ({
        produto: item.produto,
        quantidade_ml: item.quantidade_ml,
        procedimento_id: item.procedimento_id,
        ordem: item.ordem,
      })),
    }
  })

  const fotosBrutas = (fotosRes.data ?? []) as Omit<FotoLinha, 'urlAssinada'>[]
  const arquivosBrutos = (arquivosRes.data ?? []) as Omit<ArquivoLinha, 'urlAssinada'>[]

  const fotos: FotoLinha[] = await Promise.all(
    fotosBrutas.map(async (foto) => ({
      ...foto,
      urlAssinada: await urlAssinadaDoArquivo(supabase, foto.storage_path),
    })),
  )

  const arquivos: ArquivoLinha[] = await Promise.all(
    arquivosBrutos.map(async (arquivo) => ({
      ...arquivo,
      urlAssinada: await urlAssinadaDoArquivo(supabase, arquivo.storage_path),
    })),
  )

  const somenteLeitura = sessao.role !== 'dra'

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <Link href="/pacientes" className="text-sm text-texto/60 hover:text-texto">
          ← Pacientes
        </Link>
        <h1 className="font-serif text-xl break-words sm:text-2xl">{cadastro.nome_completo}</h1>
        <p className="text-sm break-words text-texto/60">
          {[
            nome !== cadastro.nome_completo ? `Chamar de ${nome}` : null,
            idade != null ? `${idade} anos` : null,
            formatarTelefone(cadastro.telefone),
            cadastro.email,
            estagio,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <AbasDaFicha pacienteId={cadastro.id} ativa={aba} />

      <Cartao className="p-4 sm:p-6">
        {aba === 'cadastro' ? (
          <FormularioCadastro
            paciente={cadastro}
            hojeISO={hojeISO}
            procedimentos={procedimentos.map((p) => ({ id: p.id, nome: p.nome }))}
          />
        ) : null}

        {aba === 'anamnese' ? (
          <FormularioAnamnese
            pacienteId={cadastro.id}
            anamnese={anamnese}
            somenteLeitura={somenteLeitura}
          />
        ) : null}

        {aba === 'avaliacao' ? (
          <FormularioAvaliacao
            pacienteId={cadastro.id}
            avaliacao={avaliacao}
            somenteLeitura={somenteLeitura}
          />
        ) : null}

        {aba === 'planos' ? (
          <FormularioPlanos
            pacienteId={cadastro.id}
            planosBotox={planosBotox}
            planosFiller={planosFiller}
            procedimentos={procedimentosDoPlano}
            hojeISO={hojeISO}
            somenteLeitura={somenteLeitura}
          />
        ) : null}

        {aba === 'atendimentos' ? (
          <FormularioAtendimentos
            pacienteId={cadastro.id}
            atendimentos={atendimentos}
            hojeISO={hojeISO}
            procedimentos={procedimentos}
            consultas={consultas}
            planosBotox={planosBotoxOpcao}
            planosFiller={planosFillerOpcao}
            somenteLeitura={somenteLeitura}
            erroCarregar={Boolean(prontuario.error)}
          />
        ) : null}

        {aba === 'pasta' ? (
          <PastaDoPaciente
            pacienteId={cadastro.id}
            fotos={fotos}
            arquivos={arquivos}
            somenteLeitura={somenteLeitura}
          />
        ) : null}
      </Cartao>
    </section>
  )
}
