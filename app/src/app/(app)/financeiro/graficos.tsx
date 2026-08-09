'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Cartao, EstadoVazio, RotuloMiudo } from '@/components/ui'
import { formatarMoeda, formatarMoedaRedonda } from './formatacao'
import {
  composicaoRecebidoNoPeriodo,
  serieTemValor,
  type FatiaStatusFinanceiro,
  type PontoRecebidoDia,
} from './metricas'

/** Cores via tokens CSS — acompanham tema claro/escuro. */
const COR = {
  acento: 'var(--color-acento)',
  acentoSuave: 'var(--color-acento-suave)',
  texto: 'var(--color-texto)',
  textoSuave: 'var(--color-texto-suave)',
  textoMudo: 'var(--color-texto-mudo)',
  linha: 'var(--color-linha)',
  superficie: 'var(--color-superficie)',
  superficie2: 'var(--color-superficie-2)',
} as const

const COR_STATUS: Record<FatiaStatusFinanceiro['id'], string> = {
  recebido: COR.acento,
  a_receber: COR.textoSuave,
  atrasadas: COR.texto,
}

type Props = {
  serieRecebido: ReadonlyArray<PontoRecebidoDia>
  serieStatus: ReadonlyArray<FatiaStatusFinanceiro>
}

/**
 * Gráficos do painel financeiro. Só o desenho — séries vêm do Server Component.
 */
export function GraficosFinanceiro({ serieRecebido, serieStatus }: Props) {
  const temRecebido = serieTemValor(serieRecebido)
  const temStatus = serieTemValor(serieStatus)
  const composicao = composicaoRecebidoNoPeriodo(serieRecebido)

  const dadosBarras = serieRecebido.map((p) => ({
    rotulo: p.rotulo,
    data: p.data,
    entrada: p.entradaCentavos / 100,
    parcelas: p.parcelasCentavos / 100,
    total: p.totalCentavos / 100,
  }))

  const dadosPizza = serieStatus
    .filter((f) => f.valorCentavos > 0)
    .map((f) => ({
      id: f.id,
      rotulo: f.rotulo,
      valor: f.valorCentavos / 100,
      valorCentavos: f.valorCentavos,
    }))

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Cartao className="p-4 lg:col-span-3">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <RotuloMiudo tom="acento">Recebido no período</RotuloMiudo>
            <p className="mt-1 font-serif text-[17px] tracking-[0.01em]">
              {formatarMoedaRedonda(composicao.totalCentavos)}
            </p>
          </div>
          {temRecebido ? (
            <div className="flex flex-wrap gap-3 text-[11px] text-texto-suave">
              <LegendaCor cor={COR.acento} rotulo="Entrada" />
              <LegendaCor cor={COR.textoSuave} rotulo="Parcelas" />
            </div>
          ) : null}
        </div>

        {!temRecebido ? (
          <EstadoVazio
            mensagem="Nenhum recebimento neste período."
            explicacao="Quando houver entradas ou parcelas liquidadas na janela, a série aparece aqui."
            className="py-8"
          />
        ) : (
          <div className="h-56 w-full min-w-0 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dadosBarras} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COR.linha} vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="rotulo"
                  tick={{ fill: COR.textoMudo, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: COR.linha }}
                  interval="preserveStartEnd"
                  minTickGap={8}
                />
                <YAxis
                  tick={{ fill: COR.textoMudo, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(v: number) => formatarEixoReais(v)}
                />
                <Tooltip
                  cursor={{ fill: COR.acentoSuave, opacity: 0.45 }}
                  content={<TooltipBarras />}
                />
                <Bar
                  dataKey="entrada"
                  name="Entrada"
                  stackId="rx"
                  fill={COR.acento}
                  radius={[0, 0, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="parcelas"
                  name="Parcelas"
                  stackId="rx"
                  fill={COR.textoSuave}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Cartao>

      <Cartao className="p-4 lg:col-span-2">
        <div className="mb-3">
          <RotuloMiudo tom="acento">A receber × recebido × atrasadas</RotuloMiudo>
          <p className="mt-1 text-[12px] text-texto-suave">
            Mesmos totais dos indicadores acima.
          </p>
        </div>

        {!temStatus ? (
          <EstadoVazio
            mensagem="Sem valores para comparar."
            explicacao="Recebido, a receber e atrasadas estão zerados neste recorte."
            className="py-8"
          />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center lg:flex-col">
            <div className="mx-auto h-48 w-full max-w-[220px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dadosPizza}
                    dataKey="valor"
                    nameKey="rotulo"
                    innerRadius="58%"
                    outerRadius="88%"
                    paddingAngle={2}
                    stroke={COR.superficie}
                    strokeWidth={2}
                  >
                    {dadosPizza.map((fatia) => (
                      <Cell key={fatia.id} fill={COR_STATUS[fatia.id]} />
                    ))}
                  </Pie>
                  <Tooltip content={<TooltipPizza />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <ul className="flex flex-1 flex-col gap-2.5">
              {serieStatus.map((fatia) => (
                <li key={fatia.id} className="flex items-center justify-between gap-3">
                  <LegendaCor cor={COR_STATUS[fatia.id]} rotulo={fatia.rotulo} />
                  <span className="font-serif text-[15px] tabular-nums">
                    {formatarMoedaRedonda(fatia.valorCentavos)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Cartao>
    </div>
  )
}

function LegendaCor({ cor, rotulo }: { cor: string; rotulo: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-texto-suave">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ background: cor }}
      />
      {rotulo}
    </span>
  )
}

function formatarEixoReais(reais: number): string {
  if (!Number.isFinite(reais) || reais === 0) return '0'
  if (Math.abs(reais) >= 1000) {
    return `${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  }
  return reais.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

type PayloadBarra = {
  dataKey?: string | number
  name?: string
  value?: number
  color?: string
  payload?: { data?: string; total?: number }
}

function TooltipBarras({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: PayloadBarra[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  const dataISO = payload[0]?.payload?.data
  const total = payload.reduce((acc, p) => acc + (Number(p.value) || 0), 0)

  return (
    <div className="rounded-[10px] border border-linha bg-superficie px-3 py-2 text-[12px] shadow-painel">
      <p className="mb-1.5 font-medium text-texto">
        {typeof label === 'string' ? label : String(label ?? '')}
        {dataISO ? (
          <span className="ml-1.5 font-normal text-texto-mudo">{dataISO}</span>
        ) : null}
      </p>
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-texto-suave">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ background: p.color }}
              />
              {p.name}
            </span>
            <span className="tabular-nums text-texto">
              {formatarMoeda(Math.round((Number(p.value) || 0) * 100))}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 border-t border-linha pt-1 font-medium">
          <span className="text-texto-suave">Total</span>
          <span className="tabular-nums">{formatarMoeda(Math.round(total * 100))}</span>
        </li>
      </ul>
    </div>
  )
}

type PayloadPizza = {
  name?: string
  value?: number
  payload?: { valorCentavos?: number }
}

function TooltipPizza({
  active,
  payload,
}: {
  active?: boolean
  payload?: PayloadPizza[]
}) {
  if (!active || !payload?.length) return null
  const item = payload[0]
  const centavos =
    item?.payload?.valorCentavos ?? Math.round((Number(item?.value) || 0) * 100)

  return (
    <div className="rounded-[10px] border border-linha bg-superficie px-3 py-2 text-[12px] shadow-painel">
      <p className="text-texto-suave">{item?.name}</p>
      <p className="font-serif text-[15px] tabular-nums text-texto">{formatarMoeda(centavos)}</p>
    </div>
  )
}
