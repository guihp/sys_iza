import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
import { Cartao } from '@/components/ui'
import { abaDaUrl, idadeEmAnos } from '@/domain/clinical/prontuario'
import { statusRetorno } from '@/domain/returns/compute-return'
import {
  dataDaClinica,
  diaDeCalendario,
  formatarDataExtensa,
  formatarDataExtensaComAno,
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
import {
  RegistrarAtendimento,
  type OpcaoDeConsulta,
  type OpcaoDeProcedimento,
} from './registrar-atendimento'
import type {
  AnamneseLinha,
  ArquivoLinha,
  AvaliacaoLinha,
  FotoLinha,
  ItemBotox,
  ItemFiller,
  PacienteCadastro,
  PlanoBotox,
  PlanoFiller,
} from './tipos'

export const metadata = { title: 'Ficha do paciente' }

const CONSULTAS_NO_SELETOR = 20

type LinhaDeAtendimento = {
  id: string
  realizado_em: string
  regiao_tratada: string | null
  quantidade: string | null
  produto: string | null
  lote: string | null
  observacoes: string | null
  termo_assinado: boolean
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
       nacionalidade, naturalidade, email, endereco, lead_source,
       contato_emergencia_nome, contato_emergencia_parentesco, contato_emergencia_telefone,
       profissao, observacoes, stage, aceita_whatsapp, aceita_email`,
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !paciente) notFound()

  const cadastro = paciente as PacienteCadastro
  const hojeISO = dataDaClinica(new Date())
  const hoje = diaDeCalendario(hojeISO)
  const idade = cadastro.nascimento ? idadeEmAnos(cadastro.nascimento, hojeISO) : null
  const nome = cadastro.como_prefere_ser_chamado || cadastro.nome_completo
  const estagio = ehEstagio(cadastro.stage) ? ROTULOS[cadastro.stage] : '—'

  const [catalogo, agenda, anamneseRes, avaliacaoRes, botoxRes, fillerRes, fotosRes, arquivosRes] =
    await Promise.all([
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
      supabase.from('anamneses').select('*').eq('patient_id', id).maybeSingle(),
      supabase.from('skin_assessments').select('*').eq('patient_id', id).maybeSingle(),
      supabase
        .from('botox_plans')
        .select('id, produto_nome, validade, lote, marca, botox_plan_items(*)')
        .eq('patient_id', id)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('filler_plans')
        .select('id, produto_nome, validade, lote, marca, filler_plan_items(*)')
        .eq('patient_id', id)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
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
      `id, realizado_em, regiao_tratada, quantidade, produto, lote, observacoes,
       termo_assinado, retorno_vencimento, sem_retorno, procedures(nome)`,
    )
    .eq('patient_id', id)
    .order('realizado_em', { ascending: false })

  const procedimentos: OpcaoDeProcedimento[] = (
    (catalogo.data ?? []) as {
      id: string
      nome: string
      default_return_interval_days: number | null
    }[]
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
      rotulo: `${formatarDataExtensa(dataDaClinica(inicio))} · ${horaDaClinica(inicio)} · ${
        consulta.procedures?.nome ?? 'Procedimento removido'
      }`,
    }
  })

  const atendimentos = (prontuario.data ?? []).map((linha) => {
    const a = linha as unknown as Partial<LinhaDeAtendimento> & {
      id: string
      realizado_em: string
      retorno_vencimento: string | null
      sem_retorno: boolean
      procedures: { nome: string } | null
    }
    return {
      id: a.id,
      realizado_em: a.realizado_em,
      regiao_tratada: a.regiao_tratada ?? null,
      quantidade: a.quantidade ?? null,
      produto: a.produto ?? null,
      lote: a.lote ?? null,
      observacoes: a.observacoes ?? null,
      termo_assinado: a.termo_assinado === true,
      retorno_vencimento: a.retorno_vencimento,
      sem_retorno: a.sem_retorno,
      procedures: a.procedures,
    } satisfies LinhaDeAtendimento
  })

  const anamnese = (anamneseRes.data ?? null) as AnamneseLinha | null
  const avaliacao = (avaliacaoRes.data ?? null) as AvaliacaoLinha | null

  const botoxBruto = botoxRes.data as
    | (Omit<PlanoBotox, 'itens'> & { botox_plan_items: ItemBotox[] | null })
    | null
  const botox: PlanoBotox | null = botoxBruto
    ? {
        id: botoxBruto.id,
        produto_nome: botoxBruto.produto_nome,
        validade: botoxBruto.validade,
        lote: botoxBruto.lote,
        marca: botoxBruto.marca,
        itens: [...(botoxBruto.botox_plan_items ?? [])].sort(
          (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0),
        ),
      }
    : null

  const fillerBruto = fillerRes.data as
    | (Omit<PlanoFiller, 'itens'> & { filler_plan_items: ItemFiller[] | null })
    | null
  const filler: PlanoFiller | null = fillerBruto
    ? {
        id: fillerBruto.id,
        produto_nome: fillerBruto.produto_nome,
        validade: fillerBruto.validade,
        lote: fillerBruto.lote,
        marca: fillerBruto.marca,
        itens: [...(fillerBruto.filler_plan_items ?? [])].sort(
          (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0),
        ),
      }
    : null

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
          <FormularioCadastro paciente={cadastro} hojeISO={hojeISO} />
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
            botox={botox}
            filler={filler}
            somenteLeitura={somenteLeitura}
          />
        ) : null}

        {aba === 'atendimentos' ? (
          <div className="space-y-6">
            {sessao.role === 'dra' ? (
              <RegistrarAtendimento
                pacienteId={cadastro.id}
                hojeISO={hojeISO}
                procedimentos={procedimentos}
                consultas={consultas}
              />
            ) : (
              <p className="rounded-xl border border-linha p-4 text-sm text-texto/60">
                O prontuário é registrado somente pela Dra. Aqui você consulta o
                histórico e o retorno previsto.
              </p>
            )}

            <section className="space-y-3">
              <h2 className="font-serif text-lg">Registros de atendimento</h2>
              {prontuario.error ? (
                <p role="alert" className="text-sm text-red-600">
                  Não foi possível carregar os atendimentos. Tente recarregar a
                  página.
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
                      <li
                        key={atendimento.id}
                        className="rounded-xl border border-linha p-4 text-sm"
                      >
                        <p className="font-medium">
                          {formatarDataExtensaComAno(realizado)} ·{' '}
                          {atendimento.procedures?.nome ?? 'Procedimento removido'}
                        </p>
                        {(atendimento.produto ||
                          atendimento.lote ||
                          atendimento.regiao_tratada ||
                          atendimento.quantidade) && (
                          <p className="text-texto/70">
                            {[
                              atendimento.produto,
                              atendimento.lote ? `lote ${atendimento.lote}` : null,
                              atendimento.regiao_tratada,
                              atendimento.quantidade,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        {atendimento.observacoes ? (
                          <p className="text-texto/60">{atendimento.observacoes}</p>
                        ) : null}
                        {atendimento.termo_assinado ? (
                          <p className="text-xs text-texto/50">Termo assinado em papel</p>
                        ) : null}
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
          </div>
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

const TEXTO_DE_STATUS: Record<ReturnType<typeof statusRetorno>, string> = {
  sem_retorno: 'não previsto',
  em_dia: 'em dia',
  vencendo: 'a vencer',
  vencido: 'vencido',
}
