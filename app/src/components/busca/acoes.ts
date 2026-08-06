'use server'

import { requireSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import {
  interpretarBusca,
  mesclarPacientes,
  TETO_POR_GRUPO,
  type PacienteEncontrado,
  type ProcedimentoEncontrado,
  type ResultadoDaBusca,
} from './consulta'

/**
 * Busca global da barra superior: paciente por nome, paciente por telefone e
 * procedimento por nome.
 *
 * Server Action é endpoint público — dá para chamá-la com um POST direto, sem
 * passar pelo campo. Por isso o `requireSessao()` está aqui e não na tela; e
 * por isso a leitura usa o client autenticado por cookie, deixando a RLS de
 * `patients` e `procedures` decidir o que volta. Nenhuma chave chega ao browser.
 *
 * Com o banco vazio o retorno é `{ pacientes: [], procedimentos: [] }` — o
 * mesmo caminho de "digitei um nome que não existe". A tela não precisa
 * distinguir os dois casos, e não distingue.
 */
export async function buscarGlobal(termo: string): Promise<ResultadoDaBusca> {
  await requireSessao()

  const alvo = interpretarBusca(termo)
  if (!alvo) return { termo: termo.trim(), pacientes: [], procedimentos: [] }

  const supabase = await createServerClient()

  const [porNome, porTelefone, catalogo] = await Promise.all([
    supabase
      .from('patients')
      .select('id, nome_completo, telefone')
      .ilike('nome_completo', alvo.padraoNome)
      .order('nome_completo')
      .limit(TETO_POR_GRUPO),
    alvo.padraoTelefone
      ? supabase
          .from('patients')
          .select('id, nome_completo, telefone')
          .ilike('telefone', alvo.padraoTelefone)
          .order('nome_completo')
          .limit(TETO_POR_GRUPO)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('procedures')
      .select('id, nome, duracao_minutos, preco_centavos')
      .eq('ativo', true)
      .ilike('nome', alvo.padraoNome)
      .order('nome')
      .limit(TETO_POR_GRUPO),
  ])

  return {
    termo: alvo.termo,
    pacientes: mesclarPacientes(paraPacientes(porNome.data), paraPacientes(porTelefone.data)),
    procedimentos: paraProcedimentos(catalogo.data),
  }
}

type LinhaDePaciente = { id: string; nome_completo: string; telefone: string | null }
type LinhaDeProcedimento = {
  id: string
  nome: string
  duracao_minutos: number
  preco_centavos: number
}

function paraPacientes(data: unknown): PacienteEncontrado[] {
  return ((data ?? []) as LinhaDePaciente[]).map((linha) => ({
    id: linha.id,
    nome: linha.nome_completo,
    telefone: linha.telefone,
  }))
}

function paraProcedimentos(data: unknown): ProcedimentoEncontrado[] {
  return ((data ?? []) as LinhaDeProcedimento[]).map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    duracaoMinutos: linha.duracao_minutos,
    precoCentavos: linha.preco_centavos,
  }))
}
