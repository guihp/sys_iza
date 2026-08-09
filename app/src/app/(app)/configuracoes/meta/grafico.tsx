'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Cartao, EstadoVazio, RotuloMiudo } from '@/components/ui'
import { formatarValorRedondo } from '@/lib/meta'
import type { LinhaDoHistoricoDaMeta } from './historico'

const COR = {
  acento: 'var(--color-acento)',
  textoSuave: 'var(--color-texto-suave)',
  textoMudo: 'var(--color-texto-mudo)',
  linha: 'var(--color-linha)',
  superficie: 'var(--color-superficie)',
} as const

/**
 * Barras meta × realizado dos meses com meta definida.
 * Ordem cronológica (mais antigo → mais recente) para leitura de tendência.
 */
export function GraficoHistoricoDaMeta({
  linhas,
}: {
  linhas: ReadonlyArray<LinhaDoHistoricoDaMeta>
}) {
  const comMeta = [...linhas]
    .filter((l) => l.metaCentavos != null)
    .reverse()
    .map((l) => ({
      rotulo: abreviarRotulo(l.rotulo),
      meta: (l.metaCentavos ?? 0) / 100,
      realizado: l.realizadoCentavos / 100,
      metaCentavos: l.metaCentavos ?? 0,
      realizadoCentavos: l.realizadoCentavos,
    }))

  return (
    <Cartao className="space-y-3 p-5">
      <div>
        <RotuloMiudo tom="acento">Meta × realizado</RotuloMiudo>
        <p className="mt-1 text-[13px] text-texto-suave">Comparativo dos meses com meta definida.</p>
      </div>

      {comMeta.length === 0 ? (
        <EstadoVazio
          mensagem="Sem dados para o gráfico"
          explicacao="Assim que houver meta gravada, as barras aparecem aqui."
        />
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comMeta} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COR.linha} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="rotulo"
                tick={{ fill: COR.textoSuave, fontSize: 11 }}
                axisLine={{ stroke: COR.linha }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: COR.textoMudo, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  new Intl.NumberFormat('pt-BR', {
                    notation: 'compact',
                    compactDisplay: 'short',
                  }).format(v)
                }
              />
              <Tooltip
                cursor={{ fill: COR.linha, opacity: 0.35 }}
                contentStyle={{
                  background: COR.superficie,
                  border: `1px solid ${COR.linha}`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(valor: number | string, nome: string) => {
                  const n = typeof valor === 'number' ? valor : Number(valor)
                  const rotulo = nome === 'meta' ? 'Meta' : 'Realizado'
                  return [formatarValorRedondo(Math.round(n * 100)), rotulo]
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: COR.textoSuave }}
                formatter={(valor) => (valor === 'meta' ? 'Meta' : 'Realizado')}
              />
              <Bar dataKey="meta" fill={COR.textoSuave} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="realizado" fill={COR.acento} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Cartao>
  )
}

/** `agosto de 2026` → `ago/26` para o eixo X. */
function abreviarRotulo(rotulo: string): string {
  const match = rotulo.match(/^(\w+)\s+de\s+(\d{4})$/i)
  if (!match) return rotulo
  const mes = match[1]!.slice(0, 3)
  const ano = match[2]!.slice(2)
  return `${mes}/${ano}`
}
