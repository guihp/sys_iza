import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina } from '@/components/ui'
import { nomeDoMes } from '@/lib/meta'
import { carregarDadosDaPaginaDaMeta } from './dados'
import { FormularioDaMeta } from './formulario'
import { GraficoHistoricoDaMeta } from './grafico'
import { HistoricoDaMeta } from './historico-ui'

export const metadata = { title: 'Meta do mês' }

/**
 * Meta mensal de faturamento — alvo do cartão na sidebar + histórico.
 * Exclusiva da Dra. (`notFound` para secretária); a escrita também passa por
 * `exigirDra` na action e pela RLS de `clinic_meta_mensal`.
 */
export default async function PaginaDaMeta() {
  const sessao = await requireSessao()
  if (sessao.role !== 'dra') notFound()

  const { mesAtual, metaCentavos, historico } = await carregarDadosDaPaginaDaMeta()
  const nome = nomeDoMes(mesAtual)

  return (
    <section className="space-y-8">
      <CabecalhoDePagina
        secao="Configurações"
        titulo={`Meta do mês de ${nome}`}
        descricao="Quanto a clínica quer faturar neste mês. O cartão da barra lateral compara o realizado com este alvo. O histórico guarda os meses anteriores."
      />
      <FormularioDaMeta metaInicialCentavos={metaCentavos} nomeDoMesAtual={nome} />
      <HistoricoDaMeta linhas={historico} />
      <GraficoHistoricoDaMeta linhas={historico} />
    </section>
  )
}
