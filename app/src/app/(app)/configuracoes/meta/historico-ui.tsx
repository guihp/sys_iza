import {
  Cartao,
  EstadoVazio,
  PilulaTexto,
  RotuloMiudo,
  Tabela,
  TabelaCabecalho,
  TabelaCelula,
  TabelaColuna,
  TabelaCorpo,
  TabelaLinha,
} from '@/components/ui'
import { formatarValorRedondo, ROTULO_STATUS_DA_META, type StatusDaMeta } from '@/lib/meta'
import type { LinhaDoHistoricoDaMeta } from './historico'

const TRACO = '—'

function varianteDoStatus(status: StatusDaMeta): 'solida' | 'suave' | 'contorno' {
  if (status === 'ultrapassou') return 'solida'
  if (status === 'atingiu' || status === 'em_progresso') return 'contorno'
  return 'suave'
}

/**
 * Tabela dos últimos meses: meta, realizado, % e status.
 * Realizado = caixa recebido no mês (igual ao cartão da lateral / Financeiro).
 */
export function HistoricoDaMeta({ linhas }: { linhas: ReadonlyArray<LinhaDoHistoricoDaMeta> }) {
  const temAlgumaMeta = linhas.some((l) => l.metaCentavos != null)

  return (
    <Cartao className="space-y-4 p-5">
      <div>
        <RotuloMiudo tom="acento">Histórico de metas</RotuloMiudo>
        <p className="mt-1 text-[13px] text-texto-suave">
          Últimos {linhas.length} meses. Realizado = caixa recebido no mês (entradas + parcelas),
          igual ao cartão da lateral e ao Financeiro. O mês atual abaixo da meta fica Em
          progresso.
        </p>
      </div>

      {!temAlgumaMeta ? (
        <EstadoVazio
          mensagem="Nenhuma meta registrada"
          explicacao="Salve a meta deste mês acima. Os meses seguintes entram no histórico automaticamente."
        />
      ) : (
        <Tabela>
          <TabelaCabecalho>
            <TabelaLinha>
              <TabelaColuna>Mês</TabelaColuna>
              <TabelaColuna>Meta</TabelaColuna>
              <TabelaColuna>Realizado</TabelaColuna>
              <TabelaColuna>%</TabelaColuna>
              <TabelaColuna>Status</TabelaColuna>
            </TabelaLinha>
          </TabelaCabecalho>
          <TabelaCorpo>
            {linhas.map((linha) => (
              <TabelaLinha key={linha.anoMes}>
                <TabelaCelula>
                  <span>{linha.rotulo}</span>
                  {linha.atual ? (
                    <span className="ml-2 text-[11px] uppercase tracking-[0.08em] text-texto-suave">
                      atual
                    </span>
                  ) : null}
                </TabelaCelula>
                <TabelaCelula>
                  {linha.metaCentavos == null ? TRACO : formatarValorRedondo(linha.metaCentavos)}
                </TabelaCelula>
                <TabelaCelula>{formatarValorRedondo(linha.realizadoCentavos)}</TabelaCelula>
                <TabelaCelula>
                  {linha.metaCentavos == null ? TRACO : `${linha.percentual}%`}
                </TabelaCelula>
                <TabelaCelula>
                  {linha.status == null ? (
                    TRACO
                  ) : (
                    <PilulaTexto variante={varianteDoStatus(linha.status)} className="px-3 py-1">
                      {ROTULO_STATUS_DA_META[linha.status]}
                    </PilulaTexto>
                  )}
                </TabelaCelula>
              </TabelaLinha>
            ))}
          </TabelaCorpo>
        </Tabela>
      )}
    </Cartao>
  )
}
