import Link from 'next/link'
import { requireSessao } from '@/auth/session'
import {
  Avatar,
  CabecalhoDePagina,
  Cartao,
  EstadoVazio,
  Tabela,
  TabelaCabecalho,
  TabelaCelula,
  TabelaColuna,
  TabelaCorpo,
  TabelaLinha,
} from '@/components/ui'
import { formatarTelefone } from '@/lib/phone'
import { createServerClient } from '@/lib/supabase/server'
import { ROTULOS, ehEstagio } from '../crm/estagios'

export const metadata = { title: 'Pacientes' }

type Linha = {
  id: string
  nome_completo: string
  como_prefere_ser_chamado: string | null
  telefone: string | null
  email: string | null
  stage: string
}

/**
 * Lista de pacientes — entrada da ficha clínica além do funil.
 *
 * Server Component. A RLS de `patients` dá SELECT à equipe inteira.
 */
export default async function PaginaDePacientes() {
  await requireSessao()
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('patients')
    .select('id, nome_completo, como_prefere_ser_chamado, telefone, email, stage')
    .order('nome_completo')

  const pacientes = (data ?? []) as Linha[]

  return (
    <section className="space-y-8">
      <CabecalhoDePagina
        secao="Clínica"
        titulo="Pacientes"
        descricao="Cadastro, anamnese, avaliação, planos e pasta de cada pessoa."
      />

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar a lista. Recarregue a página.
        </p>
      ) : pacientes.length === 0 ? (
        <Cartao className="p-2">
          <EstadoVazio
            mensagem="Nenhuma paciente cadastrada ainda."
            explicacao="Crie um lead pelo botão NOVO LEAD ou pelo funil — a ficha completa abre daqui."
            acao={
              <Link href="/crm" className="text-sm text-acento underline-offset-2 hover:underline">
                Ir ao funil
              </Link>
            }
          />
        </Cartao>
      ) : (
        <Cartao className="overflow-hidden">
          <Tabela>
            <TabelaCabecalho>
              <TabelaLinha>
                <TabelaColuna>Nome</TabelaColuna>
                <TabelaColuna>Telefone</TabelaColuna>
                <TabelaColuna>E-mail</TabelaColuna>
                <TabelaColuna>Estágio</TabelaColuna>
              </TabelaLinha>
            </TabelaCabecalho>
            <TabelaCorpo>
              {pacientes.map((paciente) => {
                const tratamento =
                  paciente.como_prefere_ser_chamado || paciente.nome_completo
                const estagio = ehEstagio(paciente.stage)
                  ? ROTULOS[paciente.stage]
                  : '—'
                return (
                  <TabelaLinha key={paciente.id}>
                    <TabelaCelula>
                      <Link
                        href={`/pacientes/${paciente.id}`}
                        className="flex items-center gap-3 text-texto hover:text-acento"
                      >
                        <Avatar nome={paciente.nome_completo} />
                        <span>
                          <span className="block font-medium">{paciente.nome_completo}</span>
                          {tratamento !== paciente.nome_completo ? (
                            <span className="block text-xs text-texto-suave">
                              Chamar de {tratamento}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </TabelaCelula>
                    <TabelaCelula>{formatarTelefone(paciente.telefone)}</TabelaCelula>
                    <TabelaCelula>
                      <span className="text-texto-suave">{paciente.email || '—'}</span>
                    </TabelaCelula>
                    <TabelaCelula>{estagio}</TabelaCelula>
                  </TabelaLinha>
                )
              })}
            </TabelaCorpo>
          </Tabela>
        </Cartao>
      )}
    </section>
  )
}
