'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirDra, ErroDePermissao } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import {
  aplicarFeito,
  statusExecucao,
  type LinhaExecucao,
} from '@/domain/clinical/atendimento-execucao'
import { formatarMoeda } from '@/app/(app)/marketing/formatacao'
import {
  gerarParcelas,
  mensagemErroCobranca,
  statusCobranca,
  validarComposicao,
  type FormaEntrada,
  type FormaRestante,
} from '@/domain/finance/cobranca'
import { calcularRetorno } from '@/domain/returns/compute-return'
import { enfileirarConversoes } from '@/lib/conversoes'
import { dataDaClinica, dataDoDiaDeCalendario, diaDeCalendario } from '@/lib/datetime'
import { planejarLembretesDoAtendimento } from '@/lib/lembretes'
import { createServerClient } from '@/lib/supabase/server'

const CAMINHO_FUNIL = '/crm'
const CAMINHO_RETORNOS = '/retornos'
const CAMINHO_FINANCEIRO = '/financeiro'

/** `''` de `<select>` vazio não é UUID — vira `null` antes da validação. */
const uuidOuNulo = z.preprocess(
  (valor) => (valor === '' || valor === undefined ? null : valor),
  z.uuid().nullable(),
)

/** Texto vazio vindo de `<input>` é ausência de valor, não string vazia. */
const textoOpcional = z
  .string()
  .trim()
  .max(2000)
  .transform((valor) => valor || null)
  .nullable()
  .optional()

const schemaItemExecucao = z.object({
  ordem: z.coerce.number().int().nonnegative(),
  rotulo: z.string().trim().max(500),
  unidade: z.enum(['U', 'ml']),
  procedimento_id: uuidOuNulo.optional(),
  preco_centavos: z.coerce.number().int().nonnegative(),
  planejado_qtd: z.coerce.number().nonnegative(),
  feito_qtd: z.coerce.number().nonnegative(),
})

const schemaBaselineExecucao = z.object({
  ordem: z.coerce.number().int().nonnegative(),
  planejado_qtd: z.coerce.number().nonnegative(),
  /** Opcional: UI usa para Planejado R$ congelado; status só precisa de qtd. */
  planejado_centavos: z.coerce.number().int().nonnegative().optional(),
})

const schemaCobranca = z.object({
  valor_total_centavos: z.coerce.number().int().nonnegative(),
  valor_entrada_centavos: z.coerce.number().int().nonnegative(),
  valor_proxima_consulta_centavos: z.coerce.number().int().nonnegative(),
  valor_parcelado_centavos: z.coerce.number().int().nonnegative(),
  parcelas_qtd: z.coerce.number().int().positive().optional(),
  juros_maquininha_centavos: z.coerce.number().int().nonnegative(),
  juros_repassados_ao_cliente: z.boolean(),
  forma_entrada: z
    .enum(['pix', 'dinheiro', 'debito', 'credito', 'outro'])
    .nullable()
    .optional(),
  forma_restante: z.enum(['pix', 'cartao']).nullable().optional(),
  primeiro_vencimento: z.iso.date().optional(),
})

const schema = z
  .object({
    pacienteId: z.uuid(),
    procedimentoId: z.uuid(),
    /** Consulta da agenda que originou o atendimento, quando houve uma. */
    consultaId: uuidOuNulo.optional(),
    regiaoTratada: textoOpcional,
    quantidade: textoOpcional,
    produto: textoOpcional,
    lote: textoOpcional,
    observacoes: textoOpcional,
    /** Termo lido/assinado em papel; scan vai na Pasta. ICP fora de escopo. */
    termoAssinado: z.boolean().optional(),
    /** Nível 2a. Positivo por definição — "sem retorno" é o campo próprio. */
    ajusteDias: z.coerce.number().int().positive().nullable().optional(),
    /** Nível 2b, em `YYYY-MM-DD`. Dia de calendário, sem hora e sem fuso. */
    ajusteData: z.iso.date().nullable().optional(),
    /** Nível 3. Vence tudo. */
    semRetorno: z.boolean().optional(),
    botoxPlanId: uuidOuNulo.optional(),
    fillerPlanId: uuidOuNulo.optional(),
    /** Linhas deste atendimento (pode omitir itens do plano ou incluir extras). */
    execucaoItens: z.array(schemaItemExecucao).optional(),
    /** Snapshot do plano ao abrir — linhas removidas aqui → status parcial. */
    execucaoBaseline: z.array(schemaBaselineExecucao).optional(),
    cobranca: schemaCobranca.nullable().optional(),
  })
  .superRefine((dados, ctx) => {
    const temBotox = Boolean(dados.botoxPlanId)
    const temFiller = Boolean(dados.fillerPlanId)
    if (temBotox && temFiller) {
      ctx.addIssue({
        code: 'custom',
        message: 'Escolha só um plano (toxina ou preenchimento).',
        path: ['botoxPlanId'],
      })
    }
    if ((temBotox || temFiller) && dados.execucaoItens === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe as linhas de execução do plano (mesmo que vazias após remover todas).',
        path: ['execucaoItens'],
      })
    }
  })

function mensagemDeValidacao(erro: z.ZodError): string {
  const issue = erro.issues[0]
  if (!issue) return 'Confira os campos: paciente, procedimento e retorno.'
  const caminho = issue.path.map(String).join('.')
  const msg = issue.message

  if (msg === 'Invalid UUID' || (issue as { format?: string }).format === 'uuid') {
    if (caminho === 'procedimentoId' || caminho.endsWith('procedimento_id')) {
      return 'Escolha o procedimento de cada linha e o procedimento realizado.'
    }
    if (caminho === 'pacienteId') return 'Paciente inválida.'
    if (caminho === 'consultaId') return 'Consulta da agenda inválida.'
    if (caminho === 'botoxPlanId' || caminho === 'fillerPlanId') {
      return 'Plano inválido. Escolha de novo na lista.'
    }
    return 'Há um identificador inválido. Confira procedimento, plano e consulta.'
  }

  if (msg && msg !== 'Invalid input') return msg
  return 'Confira os campos: paciente, procedimento e retorno.'
}
/**
 * Resultado de registrar um atendimento.
 *
 * Valor de retorno em vez de exceção pelo mesmo motivo de `agendarConsulta`: em
 * produção o Next apaga a mensagem de qualquer erro lançado numa Server Action e
 * entrega um texto genérico ao cliente. "Procedimento não encontrado no catálogo"
 * é informação que a Dra. precisa ler; erro de negócio é retorno, exceção fica
 * para o inesperado.
 */
export type ResultadoDoRegistro =
  | { ok: true; id: string; vencimento: string | null }
  | { ok: false; erro: string }

/**
 * Registra um atendimento no prontuário e grava o retorno resultante.
 *
 * Exclusiva da Dra., em duas camadas independentes. Aqui, porque Server Action é
 * endpoint público — dá para chamá-la com um POST direto, sem passar pela tela, e
 * esconder o formulário da secretária não é autorização. E no banco, pela policy
 * "so a dra registra atendimento" da migration 0006, que é a que vale mesmo se
 * esta checagem um dia falhar.
 *
 * O vencimento é recalculado **aqui**, com o `default_return_interval_days` lido
 * do catálogo neste instante, e nunca aceito do cliente. A prévia que aparece na
 * tela usa a mesma função pura (`calcularRetorno`), então os dois números batem —
 * mas o que vai para o banco é o que o servidor calculou.
 *
 * Opcionalmente liga a um plano (botox XOR filler), grava linhas de execução e
 * uma cobrança com parcelas.
 */
export async function registrarAtendimento(entrada: unknown): Promise<ResultadoDoRegistro> {
  let sessao
  try {
    sessao = exigirDra(await getSessao())
  } catch (erro) {
    if (erro instanceof ErroDePermissao) {
      return { ok: false, erro: 'Só a Dra. registra atendimento.' }
    }
    throw erro
  }

  const analise = schema.safeParse(entrada)
  if (!analise.success) {
    return {
      ok: false,
      erro: mensagemDeValidacao(analise.error),
    }
  }
  const dados = analise.data

  const supabase = await createServerClient()

  const botoxPlanId = dados.botoxPlanId ?? null
  const fillerPlanId = dados.fillerPlanId ?? null
  const veioDePlano = Boolean(botoxPlanId || fillerPlanId)

  if (botoxPlanId) {
    const { data: plano } = await supabase
      .from('botox_plans')
      .select('id')
      .eq('id', botoxPlanId)
      .eq('patient_id', dados.pacienteId)
      .maybeSingle()
    if (!plano) {
      return { ok: false, erro: 'Plano de toxina não encontrado para esta paciente.' }
    }
  }
  if (fillerPlanId) {
    const { data: plano } = await supabase
      .from('filler_plans')
      .select('id')
      .eq('id', fillerPlanId)
      .eq('patient_id', dados.pacienteId)
      .maybeSingle()
    if (!plano) {
      return { ok: false, erro: 'Plano de preenchimento não encontrado para esta paciente.' }
    }
  }

  let linhas: LinhaExecucao[] = []
  let execucaoStatus: 'completo' | 'parcial' | 'nao_aplicavel' = 'nao_aplicavel'

  if (veioDePlano && dados.execucaoItens) {
    // Recalcula centavos no servidor (qtd × preço) — não confia no client.
    linhas = dados.execucaoItens.map((item) => {
      const base: LinhaExecucao = {
        ordem: item.ordem,
        rotulo: item.rotulo,
        unidade: item.unidade,
        procedimento_id: item.procedimento_id ?? null,
        preco_centavos: item.preco_centavos,
        planejado_qtd: item.planejado_qtd,
        feito_qtd: item.planejado_qtd,
        planejado_centavos: 0,
        feito_centavos: 0,
      }
      const comPlanejado = aplicarFeito(base, item.planejado_qtd)
      const comFeito = aplicarFeito(comPlanejado, item.feito_qtd)
      return {
        ...comFeito,
        planejado_qtd: item.planejado_qtd,
        planejado_centavos: comPlanejado.feito_centavos,
      }
    })
    execucaoStatus = statusExecucao(linhas, dados.execucaoBaseline)
  }

  // Nível 1 da precedência, lido do catálogo — não do formulário. Deixar o
  // padrão chegar pelo cliente permitiria forjar um retorno que o procedimento
  // não tem.
  const { data: procedimento, error: erroProcedimento } = await supabase
    .from('procedures')
    // `preco_centavos` entra por causa do `Purchase` da Meta: o valor sai do
    // CATÁLOGO, nunca do formulário, e é arredondado à centena pelo domínio
    // antes de atravessar — o valor exato revelaria a faixa de preço e, com ela,
    // o procedimento.
    .select('id, default_return_interval_days, preco_centavos')
    .eq('id', dados.procedimentoId)
    .single()

  if (erroProcedimento || !procedimento) {
    return { ok: false, erro: 'Procedimento não encontrado no catálogo.' }
  }

  let cobrancaValidada: z.infer<typeof schemaCobranca> | null = null
  if (dados.cobranca) {
    const validacao = validarComposicao(dados.cobranca)
    if (!validacao.ok) {
      return { ok: false, erro: mensagemErroCobranca(validacao, formatarMoeda) }
    }
    if (dados.cobranca.valor_parcelado_centavos > 0) {
      const qtd = dados.cobranca.parcelas_qtd ?? 0
      if (!dados.cobranca.primeiro_vencimento) {
        return { ok: false, erro: 'Informe o vencimento da primeira parcela.' }
      }
      const parcelas = gerarParcelas(
        dados.cobranca.valor_parcelado_centavos,
        qtd,
        dados.cobranca.primeiro_vencimento,
      )
      if (parcelas.length === 0) {
        return { ok: false, erro: 'Não foi possível gerar as parcelas. Confira valores e datas.' }
      }
    }
    cobrancaValidada = dados.cobranca
  }

  const agora = new Date()

  // O fuso entra uma vez só, aqui: qual é o dia de hoje NA CLÍNICA. Às 21:30 de
  // Brasília o UTC já virou, e contar a partir do dia do servidor jogaria o
  // retorno um dia à frente. Decidido o dia, a soma de dias é aritmética de
  // calendário sobre a âncora em UTC, exata mesmo em volta de horário de verão.
  const diaDoAtendimento = diaDeCalendario(dataDaClinica(agora))

  const semRetorno = dados.semRetorno === true

  const vencimento = calcularRetorno({
    realizadoEm: diaDoAtendimento,
    padraoDias: procedimento.default_return_interval_days,
    ajusteDias: semRetorno ? null : dados.ajusteDias,
    ajusteData: semRetorno || !dados.ajusteData ? null : diaDeCalendario(dados.ajusteData),
    semRetorno,
  })

  const { data: registro, error } = await supabase
    .from('attendance_records')
    .insert({
      patient_id: dados.pacienteId,
      procedure_id: dados.procedimentoId,
      appointment_id: dados.consultaId ?? null,
      realizado_em: agora.toISOString(),
      regiao_tratada: dados.regiaoTratada ?? null,
      quantidade: dados.quantidade ?? null,
      produto: dados.produto ?? null,
      lote: dados.lote ?? null,
      observacoes: dados.observacoes ?? null,
      termo_assinado: dados.termoAssinado === true,
      // Quando o nível 3 venceu, os níveis 2 não ficam gravados como se
      // tivessem valido: o formulário desabilita os dois campos, e guardar o
      // que estava neles antes só criaria um registro que se contradiz.
      retorno_ajuste_dias: semRetorno ? null : (dados.ajusteDias ?? null),
      retorno_data: semRetorno ? null : (dados.ajusteData ?? null),
      sem_retorno: semRetorno,
      // Materializado para a fila de retornos poder usar índice. A constraint
      // `attendance_sem_retorno_sem_vencimento` garante que ele e `sem_retorno`
      // nunca se contradigam.
      retorno_vencimento: vencimento ? dataDoDiaDeCalendario(vencimento) : null,
      // A policy de INSERT exige `registrado_por = auth.uid()`: a autoria do
      // prontuário não é um campo que o caller escolhe.
      registrado_por: sessao.userId,
      botox_plan_id: botoxPlanId,
      filler_plan_id: fillerPlanId,
      execucao_status: execucaoStatus,
    })
    .select('id, retorno_vencimento')
    .single()

  if (error || !registro) {
    return {
      ok: false,
      erro: 'Não foi possível registrar o atendimento. Tente de novo.',
    }
  }

  if (linhas.length > 0) {
    const { error: erroItens } = await supabase.from('attendance_execution_items').insert(
      linhas.map((linha) => ({
        attendance_id: registro.id,
        ordem: linha.ordem,
        rotulo: linha.rotulo,
        unidade: linha.unidade,
        procedimento_id: linha.procedimento_id,
        preco_centavos: linha.preco_centavos,
        planejado_qtd: linha.planejado_qtd,
        feito_qtd: linha.feito_qtd,
        planejado_centavos: linha.planejado_centavos,
        feito_centavos: linha.feito_centavos,
      })),
    )
    if (erroItens) {
      return {
        ok: false,
        erro: 'Atendimento criado, mas as linhas de execução não gravaram. Avise o suporte.',
      }
    }
  }

  if (cobrancaValidada) {
    const parcelasPreview =
      cobrancaValidada.valor_parcelado_centavos > 0 && cobrancaValidada.primeiro_vencimento
        ? gerarParcelas(
            cobrancaValidada.valor_parcelado_centavos,
            cobrancaValidada.parcelas_qtd ?? 1,
            cobrancaValidada.primeiro_vencimento,
          )
        : []

    const status = statusCobranca({
      valor_entrada_centavos: cobrancaValidada.valor_entrada_centavos,
      valor_proxima_consulta_centavos: cobrancaValidada.valor_proxima_consulta_centavos,
      parcelas: parcelasPreview.map(() => ({ status: 'pendente' as const })),
    })

    const { data: cobranca, error: erroCobranca } = await supabase
      .from('patient_charges')
      .insert({
        attendance_id: registro.id,
        patient_id: dados.pacienteId,
        registrado_por: sessao.userId,
        valor_total_centavos: cobrancaValidada.valor_total_centavos,
        valor_entrada_centavos: cobrancaValidada.valor_entrada_centavos,
        valor_proxima_consulta_centavos: cobrancaValidada.valor_proxima_consulta_centavos,
        valor_parcelado_centavos: cobrancaValidada.valor_parcelado_centavos,
        parcelas_qtd:
          cobrancaValidada.valor_parcelado_centavos > 0
            ? (cobrancaValidada.parcelas_qtd ?? 1)
            : 1,
        juros_maquininha_centavos: cobrancaValidada.juros_maquininha_centavos,
        juros_repassados_ao_cliente: cobrancaValidada.juros_repassados_ao_cliente,
        forma_entrada: (cobrancaValidada.forma_entrada ?? null) as FormaEntrada | null,
        forma_restante: (cobrancaValidada.forma_restante ?? null) as FormaRestante | null,
        status,
      })
      .select('id')
      .single()

    if (erroCobranca || !cobranca) {
      return {
        ok: false,
        erro: 'Atendimento criado, mas a cobrança não gravou. Avise o suporte.',
      }
    }

    if (parcelasPreview.length > 0) {
      const { error: erroParcelas } = await supabase.from('payment_installments').insert(
        parcelasPreview.map((p) => ({
          charge_id: cobranca.id,
          numero: p.numero,
          valor_centavos: p.valor_centavos,
          vencimento: p.vencimento,
          pago_em: null,
          status: 'pendente',
        })),
      )
      if (erroParcelas) {
        return {
          ok: false,
          erro: 'Cobrança criada, mas as parcelas não gravaram. Avise o suporte.',
        }
      }
    }

    await supabase.from('audit_log').insert({
      ator: sessao.userId,
      acao: 'registrou_cobranca',
      entidade: 'patient_charges',
      registro_id: cobranca.id,
    })
  }

  // A consulta que gerou o atendimento passa a 'compareceu': se a paciente foi
  // atendida, ela compareceu — deixar a agenda dizendo 'agendado' obrigaria a
  // secretária a fechar a consulta na mão depois. Falha aqui não desfaz o
  // registro: o prontuário é o dado que importa, o status da agenda se corrige
  // na própria tela da agenda.
  if (dados.consultaId) {
    await supabase
      .from('appointments')
      .update({ status: 'compareceu' })
      .eq('id', dados.consultaId)
  }

  // Quem foi atendido é paciente, não mais lead nem agendado. O estágio
  // 'retorno' é da fila, e quem move para lá é o acompanhamento do vencimento.
  //
  // O estágio de antes é lido primeiro: é ele que decide se este atendimento
  // fecha a escada (`compareceu → paciente`, só o `Purchase`) ou se a paciente
  // pulou degraus e os intermediários também precisam sair.
  const { data: pacienteAntes } = await supabase
    .from('patients')
    .select('stage')
    .eq('id', dados.pacienteId)
    .single()

  await supabase.from('patients').update({ stage: 'paciente' }).eq('id', dados.pacienteId)

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'registrou_atendimento',
    entidade: 'attendance_records',
    registro_id: registro.id,
  })

  // Lembretes de pós-atendimento: cuidados em 24h, avaliação em 7 dias e o
  // aviso de retorno uma semana antes do vencimento. O vencimento vai como a
  // mesma âncora de dia de calendário usada no cálculo — não a `date` lida de
  // volta do banco — para que a conta de "sete dias antes" não dependa de como o
  // driver serializou a coluna.
  //
  // Falha aqui não desfaz o registro, pelo mesmo critério do status da agenda e
  // do estágio do funil acima: o prontuário é o dado que importa. Replanejar é
  // seguro — a chave de idempotência impede duplicata.
  await planejarLembretesDoAtendimento(supabase, {
    attendanceId: registro.id,
    patientId: dados.pacienteId,
    realizadoEm: agora,
    retornoVencimento: vencimento,
  })

  // Conversão para a Meta: o `Purchase`, o degrau mais fundo do funil. Vai com o
  // preço do catálogo em centavos; o domínio arredonda à centena e o adaptador
  // converte para reais. Nada do prontuário viaja junto — `EntradaDoFunil` não
  // tem campo para região tratada, quantidade nem observação, e é por isso que
  // esta chamada pode ficar ao lado do `insert` do prontuário sem risco.
  //
  // Best-effort e sem try/catch, pelo mesmo critério do status da agenda, do
  // estágio do funil e dos lembretes acima: o prontuário é o dado que importa.
  await enfileirarConversoes(supabase, {
    patientId: dados.pacienteId,
    estagioAnterior: (pacienteAntes as { stage: string } | null)?.stage ?? null,
    estagioNovo: 'paciente',
    valorCentavos: procedimento.preco_centavos,
    ocorridoEm: agora,
  })

  revalidatePath(`/pacientes/${dados.pacienteId}`)
  revalidatePath(CAMINHO_RETORNOS)
  revalidatePath(CAMINHO_FUNIL)
  revalidatePath(CAMINHO_FINANCEIRO)

  return { ok: true, id: registro.id, vencimento: registro.retorno_vencimento }
}

const schemaAtualizar = z
  .object({
    atendimentoId: z.uuid(),
    pacienteId: z.uuid(),
    procedimentoId: z.uuid(),
    consultaId: uuidOuNulo.optional(),
    regiaoTratada: textoOpcional,
    quantidade: textoOpcional,
    produto: textoOpcional,
    lote: textoOpcional,
    observacoes: textoOpcional,
    termoAssinado: z.boolean().optional(),
    /** Linhas deste atendimento (omitir se avulso sem tabela). */
    execucaoItens: z.array(schemaItemExecucao).optional(),
    execucaoBaseline: z.array(schemaBaselineExecucao).optional(),
    cobranca: schemaCobranca.nullable().optional(),
  })
  .superRefine((dados, ctx) => {
    // Na edição, se há baseline/itens, ambos precisam bater com o registro
    // (origem plano já gravada — não se troca botox/filler aqui).
    if (dados.execucaoItens !== undefined && dados.execucaoBaseline === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe o snapshot de execução (baseline) ao editar linhas.',
        path: ['execucaoBaseline'],
      })
    }
  })

export type ResultadoDaAtualizacao =
  | { ok: true; id: string }
  | { ok: false; erro: string }

/**
 * Atualiza atendimento existente: clínica, execução e cobrança.
 *
 * **Não** altera retorno (`retorno_*` / `sem_retorno`) nem reenfileira lembretes.
 * A chave de idempotência dos jobs é `{attendanceId}:retorno:{canal}` **sem** a
 * data — replanejar após mudar o vencimento deixaria o job antigo (data velha) e
 * engoliria o novo. Corrigir retorno depois do create exige fluxo à parte
 * (atualizar job pendente); por enquanto fica travado na UI.
 *
 * Também **não** reenvia conversão Meta nem mexe no estágio do funil.
 */
export async function atualizarAtendimento(entrada: unknown): Promise<ResultadoDaAtualizacao> {
  let sessao
  try {
    sessao = exigirDra(await getSessao())
  } catch (erro) {
    if (erro instanceof ErroDePermissao) {
      return { ok: false, erro: 'Só a Dra. edita atendimento.' }
    }
    throw erro
  }

  const analise = schemaAtualizar.safeParse(entrada)
  if (!analise.success) {
    return { ok: false, erro: mensagemDeValidacao(analise.error) }
  }
  const dados = analise.data
  const supabase = await createServerClient()

  const { data: existente, error: erroExiste } = await supabase
    .from('attendance_records')
    .select('id, patient_id, botox_plan_id, filler_plan_id, execucao_status')
    .eq('id', dados.atendimentoId)
    .eq('patient_id', dados.pacienteId)
    .maybeSingle()

  if (erroExiste || !existente) {
    return { ok: false, erro: 'Atendimento não encontrado nesta ficha.' }
  }

  const veioDePlano = Boolean(existente.botox_plan_id || existente.filler_plan_id)

  const { data: procedimento, error: erroProcedimento } = await supabase
    .from('procedures')
    .select('id')
    .eq('id', dados.procedimentoId)
    .single()

  if (erroProcedimento || !procedimento) {
    return { ok: false, erro: 'Procedimento não encontrado no catálogo.' }
  }

  let linhas: LinhaExecucao[] = []
  let execucaoStatus: 'completo' | 'parcial' | 'nao_aplicavel' = 'nao_aplicavel'

  if (veioDePlano) {
    if (!dados.execucaoItens) {
      return {
        ok: false,
        erro: 'Informe as linhas de execução do plano (mesmo que vazias após remover todas).',
      }
    }
    linhas = dados.execucaoItens.map((item) => {
      const base: LinhaExecucao = {
        ordem: item.ordem,
        rotulo: item.rotulo,
        unidade: item.unidade,
        procedimento_id: item.procedimento_id ?? null,
        preco_centavos: item.preco_centavos,
        planejado_qtd: item.planejado_qtd,
        feito_qtd: item.planejado_qtd,
        planejado_centavos: 0,
        feito_centavos: 0,
      }
      const comPlanejado = aplicarFeito(base, item.planejado_qtd)
      const comFeito = aplicarFeito(comPlanejado, item.feito_qtd)
      return {
        ...comFeito,
        planejado_qtd: item.planejado_qtd,
        planejado_centavos: comPlanejado.feito_centavos,
      }
    })
    execucaoStatus = statusExecucao(linhas, dados.execucaoBaseline)
  }

  let cobrancaValidada: z.infer<typeof schemaCobranca> | null = null
  if (dados.cobranca) {
    const validacao = validarComposicao(dados.cobranca)
    if (!validacao.ok) {
      return { ok: false, erro: mensagemErroCobranca(validacao, formatarMoeda) }
    }
    if (dados.cobranca.valor_parcelado_centavos > 0) {
      const qtd = dados.cobranca.parcelas_qtd ?? 0
      if (!dados.cobranca.primeiro_vencimento) {
        return { ok: false, erro: 'Informe o vencimento da primeira parcela.' }
      }
      const parcelas = gerarParcelas(
        dados.cobranca.valor_parcelado_centavos,
        qtd,
        dados.cobranca.primeiro_vencimento,
      )
      if (parcelas.length === 0) {
        return { ok: false, erro: 'Não foi possível gerar as parcelas. Confira valores e datas.' }
      }
    }
    cobrancaValidada = dados.cobranca
  }

  const { error: erroUpdate } = await supabase
    .from('attendance_records')
    .update({
      procedure_id: dados.procedimentoId,
      appointment_id: dados.consultaId ?? null,
      regiao_tratada: dados.regiaoTratada ?? null,
      quantidade: dados.quantidade ?? null,
      produto: dados.produto ?? null,
      lote: dados.lote ?? null,
      observacoes: dados.observacoes ?? null,
      termo_assinado: dados.termoAssinado === true,
      execucao_status: veioDePlano ? execucaoStatus : 'nao_aplicavel',
      // retorno_* intencionalmente omitido — ver docstring.
    })
    .eq('id', dados.atendimentoId)
    .eq('patient_id', dados.pacienteId)

  if (erroUpdate) {
    return { ok: false, erro: 'Não foi possível salvar o atendimento. Tente de novo.' }
  }

  if (veioDePlano) {
    const { error: erroApagaItens } = await supabase
      .from('attendance_execution_items')
      .delete()
      .eq('attendance_id', dados.atendimentoId)

    if (erroApagaItens) {
      return {
        ok: false,
        erro: 'Atendimento atualizado, mas as linhas de execução não puderam ser substituídas.',
      }
    }

    if (linhas.length > 0) {
      const { error: erroItens } = await supabase.from('attendance_execution_items').insert(
        linhas.map((linha) => ({
          attendance_id: dados.atendimentoId,
          ordem: linha.ordem,
          rotulo: linha.rotulo,
          unidade: linha.unidade,
          procedimento_id: linha.procedimento_id,
          preco_centavos: linha.preco_centavos,
          planejado_qtd: linha.planejado_qtd,
          feito_qtd: linha.feito_qtd,
          planejado_centavos: linha.planejado_centavos,
          feito_centavos: linha.feito_centavos,
        })),
      )
      if (erroItens) {
        return {
          ok: false,
          erro: 'Atendimento atualizado, mas as linhas de execução não gravaram. Avise o suporte.',
        }
      }
    }
  }

  const { data: cobrancaExistente } = await supabase
    .from('patient_charges')
    .select('id')
    .eq('attendance_id', dados.atendimentoId)
    .maybeSingle()

  if (cobrancaValidada) {
    const { data: parcelasExistentes } = cobrancaExistente
      ? await supabase
          .from('payment_installments')
          .select('id, status')
          .eq('charge_id', cobrancaExistente.id)
      : { data: [] as { id: string; status: string }[] }

    const temParcelaPaga = (parcelasExistentes ?? []).some((p) => p.status === 'pago')

    const parcelasPreview =
      cobrancaValidada.valor_parcelado_centavos > 0 && cobrancaValidada.primeiro_vencimento
        ? gerarParcelas(
            cobrancaValidada.valor_parcelado_centavos,
            cobrancaValidada.parcelas_qtd ?? 1,
            cobrancaValidada.primeiro_vencimento,
          )
        : []

    const status = statusCobranca({
      valor_entrada_centavos: cobrancaValidada.valor_entrada_centavos,
      valor_proxima_consulta_centavos: cobrancaValidada.valor_proxima_consulta_centavos,
      parcelas: temParcelaPaga
        ? (parcelasExistentes ?? []).map((p) => ({
            status: p.status as 'pendente' | 'pago' | 'atrasado',
          }))
        : parcelasPreview.map(() => ({ status: 'pendente' as const })),
    })

    const payloadCobranca = {
      valor_total_centavos: cobrancaValidada.valor_total_centavos,
      valor_entrada_centavos: cobrancaValidada.valor_entrada_centavos,
      valor_proxima_consulta_centavos: cobrancaValidada.valor_proxima_consulta_centavos,
      valor_parcelado_centavos: cobrancaValidada.valor_parcelado_centavos,
      parcelas_qtd:
        cobrancaValidada.valor_parcelado_centavos > 0
          ? (cobrancaValidada.parcelas_qtd ?? 1)
          : 1,
      juros_maquininha_centavos: cobrancaValidada.juros_maquininha_centavos,
      juros_repassados_ao_cliente: cobrancaValidada.juros_repassados_ao_cliente,
      forma_entrada: (cobrancaValidada.forma_entrada ?? null) as FormaEntrada | null,
      forma_restante: (cobrancaValidada.forma_restante ?? null) as FormaRestante | null,
      status,
    }

    if (cobrancaExistente) {
      const { error: erroCobranca } = await supabase
        .from('patient_charges')
        .update(payloadCobranca)
        .eq('id', cobrancaExistente.id)

      if (erroCobranca) {
        return {
          ok: false,
          erro: 'Atendimento salvo, mas a cobrança não atualizou. Avise o suporte.',
        }
      }

      // Regenera parcelas só se nenhuma estiver paga — senão preserva o histórico.
      if (!temParcelaPaga) {
        await supabase
          .from('payment_installments')
          .delete()
          .eq('charge_id', cobrancaExistente.id)

        if (parcelasPreview.length > 0) {
          const { error: erroParcelas } = await supabase.from('payment_installments').insert(
            parcelasPreview.map((p) => ({
              charge_id: cobrancaExistente.id,
              numero: p.numero,
              valor_centavos: p.valor_centavos,
              vencimento: p.vencimento,
              pago_em: null,
              status: 'pendente',
            })),
          )
          if (erroParcelas) {
            return {
              ok: false,
              erro: 'Cobrança atualizada, mas as parcelas não gravaram. Avise o suporte.',
            }
          }
        }
      }
    } else {
      const { data: cobranca, error: erroCobranca } = await supabase
        .from('patient_charges')
        .insert({
          attendance_id: dados.atendimentoId,
          patient_id: dados.pacienteId,
          registrado_por: sessao.userId,
          ...payloadCobranca,
        })
        .select('id')
        .single()

      if (erroCobranca || !cobranca) {
        return {
          ok: false,
          erro: 'Atendimento salvo, mas a cobrança não gravou. Avise o suporte.',
        }
      }

      if (parcelasPreview.length > 0) {
        const { error: erroParcelas } = await supabase.from('payment_installments').insert(
          parcelasPreview.map((p) => ({
            charge_id: cobranca.id,
            numero: p.numero,
            valor_centavos: p.valor_centavos,
            vencimento: p.vencimento,
            pago_em: null,
            status: 'pendente',
          })),
        )
        if (erroParcelas) {
          return {
            ok: false,
            erro: 'Cobrança criada, mas as parcelas não gravaram. Avise o suporte.',
          }
        }
      }

      await supabase.from('audit_log').insert({
        ator: sessao.userId,
        acao: 'registrou_cobranca',
        entidade: 'patient_charges',
        registro_id: cobranca.id,
      })
    }
  }

  if (dados.consultaId) {
    await supabase
      .from('appointments')
      .update({ status: 'compareceu' })
      .eq('id', dados.consultaId)
  }

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: 'atualizou_atendimento',
    entidade: 'attendance_records',
    registro_id: dados.atendimentoId,
  })

  revalidatePath(`/pacientes/${dados.pacienteId}`)
  revalidatePath(CAMINHO_RETORNOS)
  revalidatePath(CAMINHO_FINANCEIRO)

  return { ok: true, id: dados.atendimentoId }
}
