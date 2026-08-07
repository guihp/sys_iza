'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirDra, ErroDePermissao } from '@/auth/guard'
import { getSessao } from '@/auth/session'
import { calcularRetorno } from '@/domain/returns/compute-return'
import { enfileirarConversoes } from '@/lib/conversoes'
import { dataDaClinica, dataDoDiaDeCalendario, diaDeCalendario } from '@/lib/datetime'
import { planejarLembretesDoAtendimento } from '@/lib/lembretes'
import { createServerClient } from '@/lib/supabase/server'

const CAMINHO_FUNIL = '/crm'
const CAMINHO_RETORNOS = '/retornos'

/** Texto vazio vindo de `<input>` é ausência de valor, não string vazia. */
const textoOpcional = z
  .string()
  .trim()
  .max(2000)
  .transform((valor) => valor || null)
  .nullable()
  .optional()

const schema = z.object({
  pacienteId: z.uuid(),
  procedimentoId: z.uuid(),
  /** Consulta da agenda que originou o atendimento, quando houve uma. */
  consultaId: z.uuid().nullable().optional(),
  regiaoTratada: textoOpcional,
  quantidade: textoOpcional,
  observacoes: textoOpcional,
  /** Nível 2a. Positivo por definição — "sem retorno" é o campo próprio. */
  ajusteDias: z.coerce.number().int().positive().nullable().optional(),
  /** Nível 2b, em `YYYY-MM-DD`. Dia de calendário, sem hora e sem fuso. */
  ajusteData: z.iso.date().nullable().optional(),
  /** Nível 3. Vence tudo. */
  semRetorno: z.boolean().optional(),
})

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
    return { ok: false, erro: 'Confira os campos: paciente, procedimento e retorno.' }
  }
  const dados = analise.data

  const supabase = await createServerClient()

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
      observacoes: dados.observacoes ?? null,
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
    })
    .select('id, retorno_vencimento')
    .single()

  if (error || !registro) {
    return { ok: false, erro: 'Não foi possível registrar o atendimento. Tente de novo.' }
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

  return { ok: true, id: registro.id, vencimento: registro.retorno_vencimento }
}
