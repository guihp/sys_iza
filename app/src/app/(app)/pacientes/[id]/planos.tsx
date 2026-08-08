'use client'

import { useState, useTransition } from 'react'
import { totalMlFiller, totalUnidadesBotox } from '@/domain/clinical/prontuario'
import { BOTAO_PRINCIPAL, BOTAO_SECUNDARIO, CAMPO } from '../campos'
import { salvarPlanoBotox, salvarPlanoFiller } from './acoes-planos'
import type { ItemBotox, ItemFiller, PlanoBotox, PlanoFiller } from './tipos'

type LinhaBotox = {
  musculo: string
  diluicao_seringa: string
  quantidade_unidades: string
  total_unidades: string
}

type LinhaFiller = {
  produto: string
  regiao: string
  camada: string
  tecnica: string
  quantidade_ml: string
}

function linhaBotoxVazia(): LinhaBotox {
  return { musculo: '', diluicao_seringa: '', quantidade_unidades: '', total_unidades: '' }
}

function linhaFillerVazia(): LinhaFiller {
  return { produto: '', regiao: '', camada: '', tecnica: '', quantidade_ml: '' }
}

function deBotox(itens: ItemBotox[]): LinhaBotox[] {
  if (itens.length === 0) return [linhaBotoxVazia()]
  return itens.map((i) => ({
    musculo: i.musculo,
    diluicao_seringa: i.diluicao_seringa ?? '',
    quantidade_unidades: i.quantidade_unidades == null ? '' : String(i.quantidade_unidades),
    total_unidades: i.total_unidades == null ? '' : String(i.total_unidades),
  }))
}

function deFiller(itens: ItemFiller[]): LinhaFiller[] {
  if (itens.length === 0) return [linhaFillerVazia()]
  return itens.map((i) => ({
    produto: i.produto,
    regiao: i.regiao ?? '',
    camada: i.camada ?? '',
    tecnica: i.tecnica ?? '',
    quantidade_ml: i.quantidade_ml == null ? '' : String(i.quantidade_ml),
  }))
}

/**
 * Planos toxina + preenchimento — págs. 4–5.
 */
export function FormularioPlanos({
  pacienteId,
  botox,
  filler,
  somenteLeitura,
}: {
  pacienteId: string
  botox: PlanoBotox | null
  filler: PlanoFiller | null
  somenteLeitura: boolean
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  const [produtoBotox, setProdutoBotox] = useState(botox?.produto_nome ?? '')
  const [validadeBotox, setValidadeBotox] = useState(botox?.validade ?? '')
  const [loteBotox, setLoteBotox] = useState(botox?.lote ?? '')
  const [marcaBotox, setMarcaBotox] = useState(botox?.marca ?? '')
  const [linhasBotox, setLinhasBotox] = useState(() => deBotox(botox?.itens ?? []))

  const [produtoFiller, setProdutoFiller] = useState(filler?.produto_nome ?? '')
  const [validadeFiller, setValidadeFiller] = useState(filler?.validade ?? '')
  const [loteFiller, setLoteFiller] = useState(filler?.lote ?? '')
  const [marcaFiller, setMarcaFiller] = useState(filler?.marca ?? '')
  const [linhasFiller, setLinhasFiller] = useState(() => deFiller(filler?.itens ?? []))

  if (somenteLeitura) {
    return (
      <p className="rounded-xl border border-linha p-4 text-sm text-texto/60">
        Os planos são registrados somente pela Dra.
      </p>
    )
  }

  const totalU = totalUnidadesBotox(
    linhasBotox.map((l) => ({
      quantidade_unidades: l.quantidade_unidades ? Number(l.quantidade_unidades) : null,
      total_unidades: l.total_unidades ? Number(l.total_unidades) : null,
    })),
  )
  const totalMl = totalMlFiller(
    linhasFiller.map((l) => ({
      quantidade_ml: l.quantidade_ml ? Number(l.quantidade_ml.replace(',', '.')) : null,
    })),
  )

  return (
    <div className="space-y-8">
      {erro ? (
        <p role="alert" className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {ok}
        </p>
      ) : null}

      <section className="space-y-4 rounded-xl border border-linha p-4">
        <header>
          <h2 className="font-serif text-lg">Planejamento — toxina</h2>
          <p className="text-sm text-texto/60">Página 4 · músculo × diluição × unidades</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Nome do produto</span>
            <input value={produtoBotox} onChange={(e) => setProdutoBotox(e.target.value)} className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Validade</span>
            <input
              type="date"
              value={validadeBotox}
              onChange={(e) => setValidadeBotox(e.target.value)}
              className={CAMPO}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Lote / série</span>
            <input value={loteBotox} onChange={(e) => setLoteBotox(e.target.value)} className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Marca</span>
            <input value={marcaBotox} onChange={(e) => setMarcaBotox(e.target.value)} className={CAMPO} />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-linha text-texto/60">
                <th className="py-2 pr-2 font-medium">Músculo</th>
                <th className="py-2 pr-2 font-medium">Diluição / seringa</th>
                <th className="py-2 pr-2 font-medium">Unidades</th>
                <th className="py-2 pr-2 font-medium">Total U</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {linhasBotox.map((linha, i) => (
                <tr key={i} className="border-b border-linha/60">
                  <td className="py-2 pr-2">
                    <input
                      value={linha.musculo}
                      onChange={(e) => {
                        const next = [...linhasBotox]
                        next[i] = { ...linha, musculo: e.target.value }
                        setLinhasBotox(next)
                      }}
                      className={CAMPO}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={linha.diluicao_seringa}
                      onChange={(e) => {
                        const next = [...linhasBotox]
                        next[i] = { ...linha, diluicao_seringa: e.target.value }
                        setLinhasBotox(next)
                      }}
                      className={CAMPO}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={linha.quantidade_unidades}
                      onChange={(e) => {
                        const next = [...linhasBotox]
                        next[i] = { ...linha, quantidade_unidades: e.target.value }
                        setLinhasBotox(next)
                      }}
                      className={CAMPO}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={linha.total_unidades}
                      onChange={(e) => {
                        const next = [...linhasBotox]
                        next[i] = { ...linha, total_unidades: e.target.value }
                        setLinhasBotox(next)
                      }}
                      className={CAMPO}
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-xs text-texto/50 hover:text-texto"
                      onClick={() => setLinhasBotox(linhasBotox.filter((_, j) => j !== i))}
                      disabled={linhasBotox.length <= 1}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className={BOTAO_SECUNDARIO}
            onClick={() => setLinhasBotox([...linhasBotox, linhaBotoxVazia()])}
          >
            + Linha
          </button>
          <p className="text-sm text-texto/60">
            Total estimado: <strong className="text-texto">{totalU}</strong> U
          </p>
          <button
            type="button"
            disabled={pendente}
            className={BOTAO_PRINCIPAL}
            onClick={() => {
              setErro(null)
              setOk(null)
              iniciar(async () => {
                const resultado = await salvarPlanoBotox({
                  pacienteId,
                  produto_nome: produtoBotox || null,
                  validade: validadeBotox || null,
                  lote: loteBotox || null,
                  marca: marcaBotox || null,
                  itens: linhasBotox
                    .filter((l) => l.musculo.trim())
                    .map((l, ordem) => ({
                      musculo: l.musculo.trim(),
                      diluicao_seringa: l.diluicao_seringa.trim() || null,
                      quantidade_unidades: l.quantidade_unidades
                        ? Number(l.quantidade_unidades)
                        : null,
                      total_unidades: l.total_unidades ? Number(l.total_unidades) : null,
                      ordem,
                    })),
                })
                if (!resultado.ok) {
                  setErro(resultado.erro)
                  return
                }
                setOk('Plano de toxina salvo.')
              })
            }}
          >
            {pendente ? 'Salvando…' : 'Salvar plano de toxina'}
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-linha p-4">
        <header>
          <h2 className="font-serif text-lg">Preenchimento facial</h2>
          <p className="text-sm text-texto/60">Página 5 · produto × região × camada × técnica × ml</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Nome do produto</span>
            <input value={produtoFiller} onChange={(e) => setProdutoFiller(e.target.value)} className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Validade</span>
            <input
              type="date"
              value={validadeFiller}
              onChange={(e) => setValidadeFiller(e.target.value)}
              className={CAMPO}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Lote / série</span>
            <input value={loteFiller} onChange={(e) => setLoteFiller(e.target.value)} className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Marca</span>
            <input value={marcaFiller} onChange={(e) => setMarcaFiller(e.target.value)} className={CAMPO} />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-linha text-texto/60">
                <th className="py-2 pr-2 font-medium">Produto</th>
                <th className="py-2 pr-2 font-medium">Região</th>
                <th className="py-2 pr-2 font-medium">Camada</th>
                <th className="py-2 pr-2 font-medium">Técnica</th>
                <th className="py-2 pr-2 font-medium">ml</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {linhasFiller.map((linha, i) => (
                <tr key={i} className="border-b border-linha/60">
                  {(
                    [
                      ['produto', linha.produto],
                      ['regiao', linha.regiao],
                      ['camada', linha.camada],
                      ['tecnica', linha.tecnica],
                    ] as const
                  ).map(([campo, valor]) => (
                    <td key={campo} className="py-2 pr-2">
                      <input
                        value={valor}
                        onChange={(e) => {
                          const next = [...linhasFiller]
                          next[i] = { ...linha, [campo]: e.target.value }
                          setLinhasFiller(next)
                        }}
                        className={CAMPO}
                      />
                    </td>
                  ))}
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={linha.quantidade_ml}
                      onChange={(e) => {
                        const next = [...linhasFiller]
                        next[i] = { ...linha, quantidade_ml: e.target.value }
                        setLinhasFiller(next)
                      }}
                      className={CAMPO}
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-xs text-texto/50 hover:text-texto"
                      onClick={() => setLinhasFiller(linhasFiller.filter((_, j) => j !== i))}
                      disabled={linhasFiller.length <= 1}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className={BOTAO_SECUNDARIO}
            onClick={() => setLinhasFiller([...linhasFiller, linhaFillerVazia()])}
          >
            + Linha
          </button>
          <p className="text-sm text-texto/60">
            Total estimado: <strong className="text-texto">{totalMl}</strong> ml
          </p>
          <button
            type="button"
            disabled={pendente}
            className={BOTAO_PRINCIPAL}
            onClick={() => {
              setErro(null)
              setOk(null)
              iniciar(async () => {
                const resultado = await salvarPlanoFiller({
                  pacienteId,
                  produto_nome: produtoFiller || null,
                  validade: validadeFiller || null,
                  lote: loteFiller || null,
                  marca: marcaFiller || null,
                  itens: linhasFiller
                    .filter((l) => l.produto.trim())
                    .map((l, ordem) => ({
                      produto: l.produto.trim(),
                      regiao: l.regiao.trim() || null,
                      camada: l.camada.trim() || null,
                      tecnica: l.tecnica.trim() || null,
                      quantidade_ml: l.quantidade_ml
                        ? Number(l.quantidade_ml.replace(',', '.'))
                        : null,
                      ordem,
                    })),
                })
                if (!resultado.ok) {
                  setErro(resultado.erro)
                  return
                }
                setOk('Plano de preenchimento salvo.')
              })
            }}
          >
            {pendente ? 'Salvando…' : 'Salvar plano de preenchimento'}
          </button>
        </div>
      </section>
    </div>
  )
}
