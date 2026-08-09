'use client'

import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  centavosLinhaFiller,
  centavosLinhaToxina,
  linhaBotoxTemConteudo,
  linhaFillerTemConteudo,
  limparRotuloHerdadoDoCatalogo,
  parseQuantidade,
  serializarItemBotox,
  serializarItemFiller,
  somarCentavos,
  type LinhaBotoxRascunho,
  type LinhaFillerRascunho,
} from '@/domain/clinical/planos-calc'
import { totalMlFiller, totalUnidadesBotox } from '@/domain/clinical/prontuario'
import { formatarPreco } from '@/app/(app)/configuracoes/procedimentos/formatacao'
import { formatarDataCurta } from '@/lib/datetime'
import { EstadoVazio, StatusAutosave } from '@/components/ui'
import { useAutosave } from '@/hooks/use-autosave'
import { BOTAO_PRINCIPAL, BOTAO_SECUNDARIO, CAMPO } from '../campos'
import { AnotacaoPlanoCanvas } from './anotacao-plano'
import { apagarPlanoBotox, apagarPlanoFiller, salvarPlanoBotox, salvarPlanoFiller } from './acoes-planos'
import type {
  AnotacaoPlano,
  ItemBotox,
  ItemFiller,
  PlanoBotox,
  PlanoFiller,
  ProcedimentoDoPlano,
  TipoPlano,
} from './tipos'

const CAPA_TOXINA = '/ToxinaBotulinica.png'
const CAPA_FILLER = '/PreenchimentoFacial.png'

type LinhaBotox = LinhaBotoxRascunho
type LinhaFiller = LinhaFillerRascunho

type RascunhoEditor = {
  id: string | null
  tipo: TipoPlano
  realizado_em: string
  produto_nome: string
  validade: string
  marca: string
  anotacao: AnotacaoPlano | null
  linhasBotox: LinhaBotox[]
  linhasFiller: LinhaFiller[]
}

type CardGaleria = {
  chave: string
  tipo: TipoPlano
  id: string
  realizado_em: string
  totalCentavos: number
  totalClinico: string
}

function linhaBotoxVazia(): LinhaBotox {
  return {
    musculo: '',
    diluicao_seringa: '',
    quantidade_unidades: '',
    total_unidades: '',
    procedimento_id: '',
  }
}

function linhaFillerVazia(): LinhaFiller {
  return {
    produto: '',
    regiao: '',
    camada: '',
    tecnica: '',
    quantidade_ml: '',
    procedimento_id: '',
  }
}

/** Digits + no máximo um separador decimal (, ou .) — rejeita letras. */
function filtrarQuantidadeDigitada(valor: string): string {
  let out = ''
  let sep = false
  for (const ch of valor) {
    if (ch >= '0' && ch <= '9') out += ch
    else if ((ch === ',' || ch === '.') && !sep) {
      out += ch
      sep = true
    }
  }
  return out
}

function deBotox(
  itens: ItemBotox[],
  catalogo: ReadonlyArray<{ id: string; nome: string }>,
): LinhaBotox[] {
  if (itens.length === 0) return [linhaBotoxVazia()]
  return itens.map((i) => ({
    musculo: limparRotuloHerdadoDoCatalogo(i.musculo, i.procedimento_id, catalogo),
    diluicao_seringa: i.diluicao_seringa ?? '',
    quantidade_unidades: i.quantidade_unidades == null ? '' : String(i.quantidade_unidades),
    total_unidades: i.total_unidades == null ? '' : String(i.total_unidades),
    procedimento_id: i.procedimento_id ?? '',
  }))
}

function deFiller(
  itens: ItemFiller[],
  catalogo: ReadonlyArray<{ id: string; nome: string }>,
): LinhaFiller[] {
  if (itens.length === 0) return [linhaFillerVazia()]
  return itens.map((i) => ({
    produto: limparRotuloHerdadoDoCatalogo(i.produto, i.procedimento_id, catalogo),
    regiao: i.regiao ?? '',
    camada: i.camada ?? '',
    tecnica: i.tecnica ?? '',
    quantidade_ml: i.quantidade_ml == null ? '' : String(i.quantidade_ml),
    procedimento_id: i.procedimento_id ?? '',
  }))
}

function mapaPrecos(procedimentos: ProcedimentoDoPlano[]) {
  const mapa = new Map<string, number>()
  for (const p of procedimentos) mapa.set(p.id, p.preco_centavos)
  return mapa
}

function totalCentavosBotox(itens: ItemBotox[], precos: Map<string, number>) {
  return somarCentavos(
    itens.map((i) => {
      const u = i.total_unidades ?? i.quantidade_unidades
      const preco = i.procedimento_id ? (precos.get(i.procedimento_id) ?? null) : null
      return centavosLinhaToxina(u, preco)
    }),
  )
}

function totalCentavosFiller(itens: ItemFiller[], precos: Map<string, number>) {
  return somarCentavos(
    itens.map((i) => {
      const preco = i.procedimento_id ? (precos.get(i.procedimento_id) ?? null) : null
      return centavosLinhaFiller(i.quantidade_ml, preco)
    }),
  )
}

function novoRascunho(tipo: TipoPlano, hojeISO: string): RascunhoEditor {
  return {
    id: null,
    tipo,
    realizado_em: hojeISO,
    produto_nome: '',
    validade: '',
    marca: '',
    anotacao: null,
    linhasBotox: [linhaBotoxVazia()],
    linhasFiller: [linhaFillerVazia()],
  }
}

function dePlanoBotox(
  plano: PlanoBotox,
  catalogo: ReadonlyArray<{ id: string; nome: string }>,
): RascunhoEditor {
  return {
    id: plano.id,
    tipo: 'toxina',
    realizado_em: plano.realizado_em,
    produto_nome: plano.produto_nome ?? '',
    validade: plano.validade ?? '',
    marca: plano.marca ?? '',
    anotacao: plano.anotacao_json,
    linhasBotox: deBotox(plano.itens, catalogo),
    linhasFiller: [linhaFillerVazia()],
  }
}

function dePlanoFiller(
  plano: PlanoFiller,
  catalogo: ReadonlyArray<{ id: string; nome: string }>,
): RascunhoEditor {
  return {
    id: plano.id,
    tipo: 'preenchimento',
    realizado_em: plano.realizado_em,
    produto_nome: plano.produto_nome ?? '',
    validade: plano.validade ?? '',
    marca: plano.marca ?? '',
    anotacao: plano.anotacao_json,
    linhasBotox: [linhaBotoxVazia()],
    linhasFiller: deFiller(plano.itens, catalogo),
  }
}

/**
 * Aba Planos: galeria de planos datados, escolha por capa e editor
 * (anotação + tabela + calculadora R$).
 */
export function FormularioPlanos({
  pacienteId,
  planosBotox,
  planosFiller,
  procedimentos,
  hojeISO,
  somenteLeitura,
}: {
  pacienteId: string
  planosBotox: PlanoBotox[]
  planosFiller: PlanoFiller[]
  procedimentos: ProcedimentoDoPlano[]
  hojeISO: string
  somenteLeitura: boolean
}) {
  const router = useRouter()
  const [visao, setVisao] = useState<'galeria' | 'escolha' | 'editor'>('galeria')
  const [rascunho, setRascunho] = useState<RascunhoEditor | null>(null)
  const [erroApagar, setErroApagar] = useState<string | null>(null)
  const [pendenteApagar, iniciarApagar] = useTransition()

  const precos = useMemo(() => mapaPrecos(procedimentos), [procedimentos])

  const cards = useMemo((): CardGaleria[] => {
    const toxina = planosBotox.map((p) => ({
      chave: `toxina-${p.id}`,
      tipo: 'toxina' as const,
      id: p.id,
      realizado_em: p.realizado_em,
      totalCentavos: totalCentavosBotox(p.itens, precos),
      totalClinico: `${totalUnidadesBotox(p.itens)} U`,
    }))
    const filler = planosFiller.map((p) => ({
      chave: `filler-${p.id}`,
      tipo: 'preenchimento' as const,
      id: p.id,
      realizado_em: p.realizado_em,
      totalCentavos: totalCentavosFiller(p.itens, precos),
      totalClinico: `${totalMlFiller(p.itens)} mL`,
    }))
    return [...toxina, ...filler].sort((a, b) => {
      if (a.realizado_em !== b.realizado_em) return a.realizado_em < b.realizado_em ? 1 : -1
      return 0
    })
  }, [planosBotox, planosFiller, precos])

  function abrirPlano(card: CardGaleria) {
    setErroApagar(null)
    if (card.tipo === 'toxina') {
      const plano = planosBotox.find((p) => p.id === card.id)
      if (!plano) return
      setRascunho(dePlanoBotox(plano, procedimentos))
    } else {
      const plano = planosFiller.find((p) => p.id === card.id)
      if (!plano) return
      setRascunho(dePlanoFiller(plano, procedimentos))
    }
    setVisao('editor')
  }

  function criarTipo(tipo: TipoPlano) {
    setErroApagar(null)
    setRascunho(novoRascunho(tipo, hojeISO))
    setVisao('editor')
  }

  function voltarGaleria() {
    setVisao('galeria')
    setRascunho(null)
    setErroApagar(null)
    // Só aqui — nunca no autosave (revalidatePath/refresh remonta e perde o editor).
    router.refresh()
  }

  if (visao === 'escolha') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-lg">Criar plano</h2>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setVisao('galeria')}>
            Voltar
          </button>
        </div>
        <p className="text-sm text-texto/60">Escolha o tipo — a capa entra no editor para anotação.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            className="group overflow-hidden rounded-xl border border-linha text-left transition hover:border-acento"
            onClick={() => criarTipo('toxina')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={CAPA_TOXINA} alt="" className="aspect-[4/3] w-full object-cover" />
            <div className="space-y-1 p-3">
              <p className="font-medium">Toxina botulínica</p>
              <p className="text-xs text-texto/60">Unidades × R$/U do catálogo</p>
            </div>
          </button>
          <button
            type="button"
            className="group overflow-hidden rounded-xl border border-linha text-left transition hover:border-acento"
            onClick={() => criarTipo('preenchimento')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={CAPA_FILLER} alt="" className="aspect-[4/3] w-full object-cover" />
            <div className="space-y-1 p-3">
              <p className="font-medium">Preenchimento facial</p>
              <p className="text-xs text-texto/60">mL × R$/mL do catálogo</p>
            </div>
          </button>
        </div>
      </div>
    )
  }

  if (visao === 'editor' && rascunho) {
    return (
      <EditorPlano
        pacienteId={pacienteId}
        rascunho={rascunho}
        setRascunho={setRascunho}
        procedimentos={procedimentos}
        precos={precos}
        somenteLeitura={somenteLeitura}
        pendenteApagar={pendenteApagar}
        erroApagar={erroApagar}
        onVoltar={voltarGaleria}
        onErroApagar={setErroApagar}
        iniciarApagar={iniciarApagar}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg">Planos</h2>
          <p className="text-sm text-texto/60">Histórico datado de toxina e preenchimento</p>
        </div>
        {!somenteLeitura ? (
          <button type="button" className={BOTAO_PRINCIPAL} onClick={() => setVisao('escolha')}>
            Criar plano
          </button>
        ) : (
          <p className="text-xs text-texto/50">Somente leitura</p>
        )}
      </div>

      {cards.length === 0 ? (
        <EstadoVazio
          mensagem="Nenhum plano ainda"
          explicacao={
            somenteLeitura
              ? 'A Dra. registra os planos de toxina e preenchimento nesta aba.'
              : 'Crie um plano pela capa para anotar e calcular o estimado em R$.'
          }
          acao={
            !somenteLeitura ? (
              <button type="button" className={BOTAO_PRINCIPAL} onClick={() => setVisao('escolha')}>
                Criar plano
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const capa = card.tipo === 'toxina' ? CAPA_TOXINA : CAPA_FILLER
            const rotulo = card.tipo === 'toxina' ? 'Toxina' : 'Preenchimento'
            return (
              <li key={card.chave}>
                <button
                  type="button"
                  onClick={() => abrirPlano(card)}
                  className="w-full overflow-hidden rounded-xl border border-linha text-left transition hover:border-acento"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={capa} alt="" className="aspect-[4/3] w-full object-cover" />
                  <div className="space-y-1 p-3">
                    <p className="text-sm font-medium">{rotulo}</p>
                    <p className="text-xs text-texto/60">
                      {formatarDataCurta(card.realizado_em)} · {card.totalClinico}
                    </p>
                    <p className="text-sm">{formatarPreco(card.totalCentavos)}</p>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function EditorPlano({
  pacienteId,
  rascunho,
  setRascunho,
  procedimentos,
  precos,
  somenteLeitura,
  pendenteApagar,
  erroApagar,
  onVoltar,
  onErroApagar,
  iniciarApagar,
}: {
  pacienteId: string
  rascunho: RascunhoEditor
  setRascunho: Dispatch<SetStateAction<RascunhoEditor | null>>
  procedimentos: ProcedimentoDoPlano[]
  precos: Map<string, number>
  somenteLeitura: boolean
  pendenteApagar: boolean
  erroApagar: string | null
  onVoltar: () => void
  onErroApagar: (v: string | null) => void
  iniciarApagar: (fn: () => void) => void
}) {
  const capa = rascunho.tipo === 'toxina' ? CAPA_TOXINA : CAPA_FILLER
  // Catálogo completo — Dra. escolhe qualquer procedimento ativo, sem filtro por tipo.
  const catalogo = procedimentos
  const rotuloPreco = rascunho.tipo === 'toxina' ? 'R$/U' : 'R$/mL'
  // Estável na sessão do editor — não remonta o canvas quando o id chega no 1º save.
  const [chaveCanvas] = useState(() => rascunho.id ?? `novo-${rascunho.tipo}`)
  // Id efetivo imediato (evita create duplicado se o 2º save sai antes do setState).
  const planoIdRef = useRef<string | null>(rascunho.id)

  // Autosave quieto: não chama router.refresh / não zera visao. Após criar,
  // só grava o id no rascunho e segue editando o mesmo EditorPlano.
  const { status, erro: erroAutosave, flush } = useAutosave({
    value: rascunho,
    enabled: !somenteLeitura,
    delayMs: 400,
    save: async (r) => {
      const idEfetivo = r.id ?? planoIdRef.current
      if (r.tipo === 'toxina') {
        const itens = r.linhasBotox
          .filter(linhaBotoxTemConteudo)
          .map((l, ordem) => serializarItemBotox(l, ordem))
        const resultado = await salvarPlanoBotox({
          id: idEfetivo,
          pacienteId,
          realizado_em: r.realizado_em,
          produto_nome: r.produto_nome || null,
          validade: r.validade || null,
          lote: null,
          marca: r.marca || null,
          anotacao_json: r.anotacao,
          itens,
        })
        if (!resultado.ok) return resultado
        planoIdRef.current = resultado.id
        // Create → update no mesmo id, sem fechar o editor.
        if (!r.id) {
          setRascunho((prev) => (prev && !prev.id ? { ...prev, id: resultado.id } : prev))
        }
        return { ok: true }
      }

      const itens = r.linhasFiller
        .filter(linhaFillerTemConteudo)
        .map((l, ordem) => serializarItemFiller(l, ordem))
      const resultado = await salvarPlanoFiller({
        id: idEfetivo,
        pacienteId,
        realizado_em: r.realizado_em,
        produto_nome: r.produto_nome || null,
        validade: r.validade || null,
        lote: null,
        marca: r.marca || null,
        anotacao_json: r.anotacao,
        itens,
      })
      if (!resultado.ok) return resultado
      planoIdRef.current = resultado.id
      if (!r.id) {
        setRascunho((prev) => (prev && !prev.id ? { ...prev, id: resultado.id } : prev))
      }
      return { ok: true }
    },
  })

  async function voltarComFlush() {
    if (!somenteLeitura) {
      await flush()
    }
    onVoltar()
  }

  const totalU = totalUnidadesBotox(
    rascunho.linhasBotox.map((l) => ({
      quantidade_unidades: parseQuantidade(l.quantidade_unidades),
      total_unidades: parseQuantidade(l.total_unidades),
    })),
  )
  const totalMl = totalMlFiller(
    rascunho.linhasFiller.map((l) => ({
      quantidade_ml: parseQuantidade(l.quantidade_ml),
    })),
  )

  const totaisLinhaToxina = rascunho.linhasBotox.map((l) => {
    const u = parseQuantidade(l.total_unidades) ?? parseQuantidade(l.quantidade_unidades)
    const preco = l.procedimento_id ? (precos.get(l.procedimento_id) ?? null) : null
    return centavosLinhaToxina(u, preco)
  })
  const totaisLinhaFiller = rascunho.linhasFiller.map((l) => {
    const ml = parseQuantidade(l.quantidade_ml)
    const preco = l.procedimento_id ? (precos.get(l.procedimento_id) ?? null) : null
    return centavosLinhaFiller(ml, preco)
  })
  const totalReais =
    rascunho.tipo === 'toxina' ? somarCentavos(totaisLinhaToxina) : somarCentavos(totaisLinhaFiller)

  function apagar() {
    if (!rascunho.id && !planoIdRef.current) {
      void voltarComFlush()
      return
    }
    const planoId = rascunho.id ?? planoIdRef.current
    if (!planoId) return
    if (!window.confirm('Apagar este plano?')) return
    onErroApagar(null)
    iniciarApagar(async () => {
      await flush()
      const resultado =
        rascunho.tipo === 'toxina'
          ? await apagarPlanoBotox({ id: planoId, pacienteId })
          : await apagarPlanoFiller({ id: planoId, pacienteId })
      if (!resultado.ok) {
        onErroApagar(resultado.erro)
        return
      }
      onVoltar()
    })
  }

  const erro = erroAutosave ?? erroApagar

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg">
            {rascunho.tipo === 'toxina' ? 'Plano — toxina' : 'Plano — preenchimento'}
          </h2>
          <p className="text-sm text-texto/60">
            {rascunho.id || planoIdRef.current ? 'Editando plano salvo' : 'Novo plano'} ·
            anotação na capa + tabela
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!somenteLeitura ? <StatusAutosave status={status} erro={erroAutosave} /> : null}
          <button type="button" className={BOTAO_SECUNDARIO} onClick={() => void voltarComFlush()}>
            Voltar
          </button>
        </div>
      </div>

      {erro ? (
        <p role="alert" className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}

      <AnotacaoPlanoCanvas
        key={chaveCanvas}
        capaSrc={capa}
        valor={rascunho.anotacao}
        onChange={(anotacao) =>
          setRascunho((prev) => (prev ? { ...prev, anotacao } : prev))
        }
        somenteLeitura={somenteLeitura}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Data do plano</span>
          <input
            type="date"
            value={rascunho.realizado_em}
            disabled={somenteLeitura}
            onChange={(e) => {
              const realizado_em = e.target.value
              setRascunho((prev) => (prev ? { ...prev, realizado_em } : prev))
            }}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Nome do produto</span>
          <input
            value={rascunho.produto_nome}
            disabled={somenteLeitura}
            onChange={(e) => {
              const produto_nome = e.target.value
              setRascunho((prev) => (prev ? { ...prev, produto_nome } : prev))
            }}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Validade</span>
          <input
            type="date"
            value={rascunho.validade}
            disabled={somenteLeitura}
            onChange={(e) => {
              const validade = e.target.value
              setRascunho((prev) => (prev ? { ...prev, validade } : prev))
            }}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Marca</span>
          <input
            value={rascunho.marca}
            disabled={somenteLeitura}
            onChange={(e) => {
              const marca = e.target.value
              setRascunho((prev) => (prev ? { ...prev, marca } : prev))
            }}
            className={CAMPO}
          />
        </label>
      </div>

      {rascunho.tipo === 'toxina' ? (
        <TabelaToxina
          linhas={rascunho.linhasBotox}
          totaisLinha={totaisLinhaToxina}
          catalogo={catalogo}
          rotuloPreco={rotuloPreco}
          somenteLeitura={somenteLeitura}
          onChange={(linhasBotox) => {
            setRascunho((prev) => (prev ? { ...prev, linhasBotox } : prev))
          }}
        />
      ) : (
        <TabelaFiller
          linhas={rascunho.linhasFiller}
          totaisLinha={totaisLinhaFiller}
          catalogo={catalogo}
          rotuloPreco={rotuloPreco}
          somenteLeitura={somenteLeitura}
          onChange={(linhasFiller) => {
            setRascunho((prev) => (prev ? { ...prev, linhasFiller } : prev))
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linha pt-4">
        <div className="space-y-1 text-sm text-texto/70">
          <p>
            Total clínico:{' '}
            <strong className="text-texto">
              {rascunho.tipo === 'toxina' ? `${totalU} U` : `${totalMl} mL`}
            </strong>
          </p>
          <p>
            Total estimado:{' '}
            <strong className="text-texto">{formatarPreco(totalReais)}</strong>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!somenteLeitura && (rascunho.id || planoIdRef.current) ? (
            <button
              type="button"
              className={BOTAO_SECUNDARIO}
              disabled={pendenteApagar}
              onClick={apagar}
            >
              Apagar
            </button>
          ) : null}
          <button type="button" className={BOTAO_SECUNDARIO} onClick={() => void voltarComFlush()}>
            Voltar
          </button>
        </div>
      </div>
    </div>
  )
}

function SelectProcedimento({
  valor,
  catalogo,
  rotuloPreco,
  disabled,
  onChange,
}: {
  valor: string
  catalogo: ProcedimentoDoPlano[]
  rotuloPreco: string
  disabled: boolean
  onChange: (id: string) => void
}) {
  return (
    <select
      value={valor}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={CAMPO}
    >
      <option value="">Procedimento…</option>
      {catalogo.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome} · {formatarPreco(p.preco_centavos)}/{rotuloPreco.replace('R$/', '')}
        </option>
      ))}
    </select>
  )
}

function TabelaToxina({
  linhas,
  totaisLinha,
  catalogo,
  rotuloPreco,
  somenteLeitura,
  onChange,
}: {
  linhas: LinhaBotox[]
  totaisLinha: number[]
  catalogo: ProcedimentoDoPlano[]
  rotuloPreco: string
  somenteLeitura: boolean
  onChange: (linhas: LinhaBotox[]) => void
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-linha text-texto/60">
              <th className="py-2 pr-2 font-medium">Músculo</th>
              <th className="py-2 pr-2 font-medium">Diluição / seringa</th>
              <th className="py-2 pr-2 font-medium">Unidades</th>
              <th className="py-2 pr-2 font-medium">Total U</th>
              <th className="py-2 pr-2 font-medium">Procedimento ({rotuloPreco})</th>
              <th className="py-2 pr-2 font-medium">Total R$</th>
              {!somenteLeitura ? <th className="py-2 font-medium" /> : null}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, i) => (
              <tr key={i} className="border-b border-linha/60">
                <td className="py-2 pr-2">
                  <input
                    value={linha.musculo}
                    disabled={somenteLeitura}
                    onChange={(e) => {
                      const next = [...linhas]
                      next[i] = { ...linha, musculo: e.target.value }
                      onChange(next)
                    }}
                    className={CAMPO}
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={linha.diluicao_seringa}
                    disabled={somenteLeitura}
                    onChange={(e) => {
                      const next = [...linhas]
                      next[i] = { ...linha, diluicao_seringa: e.target.value }
                      onChange(next)
                    }}
                    className={CAMPO}
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    inputMode="decimal"
                    value={linha.quantidade_unidades}
                    disabled={somenteLeitura}
                    onChange={(e) => {
                      const next = [...linhas]
                      next[i] = {
                        ...linha,
                        quantidade_unidades: filtrarQuantidadeDigitada(e.target.value),
                      }
                      onChange(next)
                    }}
                    className={CAMPO}
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    inputMode="decimal"
                    value={linha.total_unidades}
                    disabled={somenteLeitura}
                    onChange={(e) => {
                      const next = [...linhas]
                      next[i] = {
                        ...linha,
                        total_unidades: filtrarQuantidadeDigitada(e.target.value),
                      }
                      onChange(next)
                    }}
                    className={CAMPO}
                  />
                </td>
                <td className="py-2 pr-2">
                  <SelectProcedimento
                    valor={linha.procedimento_id}
                    catalogo={catalogo}
                    rotuloPreco={rotuloPreco}
                    disabled={somenteLeitura}
                    onChange={(procedimento_id) => {
                      const next = [...linhas]
                      next[i] = { ...linha, procedimento_id }
                      onChange(next)
                    }}
                  />
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  {(totaisLinha[i] ?? 0) === 0 ? '—' : formatarPreco(totaisLinha[i] ?? 0)}
                </td>
                {!somenteLeitura ? (
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-xs text-texto/50 hover:text-texto"
                      onClick={() => onChange(linhas.filter((_, j) => j !== i))}
                      disabled={linhas.length <= 1}
                    >
                      Remover
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!somenteLeitura ? (
        <button
          type="button"
          className={BOTAO_SECUNDARIO}
          onClick={() => onChange([...linhas, linhaBotoxVazia()])}
        >
          + Linha
        </button>
      ) : null}
    </div>
  )
}

function TabelaFiller({
  linhas,
  totaisLinha,
  catalogo,
  rotuloPreco,
  somenteLeitura,
  onChange,
}: {
  linhas: LinhaFiller[]
  totaisLinha: number[]
  catalogo: ProcedimentoDoPlano[]
  rotuloPreco: string
  somenteLeitura: boolean
  onChange: (linhas: LinhaFiller[]) => void
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr className="border-b border-linha text-texto/60">
              <th className="py-2 pr-2 font-medium">Produto</th>
              <th className="py-2 pr-2 font-medium">Região</th>
              <th className="py-2 pr-2 font-medium">Camada</th>
              <th className="py-2 pr-2 font-medium">Técnica</th>
              <th className="py-2 pr-2 font-medium">mL</th>
              <th className="py-2 pr-2 font-medium">Procedimento ({rotuloPreco})</th>
              <th className="py-2 pr-2 font-medium">Total R$</th>
              {!somenteLeitura ? <th className="py-2 font-medium" /> : null}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, i) => (
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
                      disabled={somenteLeitura}
                      onChange={(e) => {
                        const next = [...linhas]
                        next[i] = { ...linha, [campo]: e.target.value }
                        onChange(next)
                      }}
                      className={CAMPO}
                    />
                  </td>
                ))}
                <td className="py-2 pr-2">
                  <input
                    inputMode="decimal"
                    value={linha.quantidade_ml}
                    disabled={somenteLeitura}
                    onChange={(e) => {
                      const next = [...linhas]
                      next[i] = {
                        ...linha,
                        quantidade_ml: filtrarQuantidadeDigitada(e.target.value),
                      }
                      onChange(next)
                    }}
                    className={CAMPO}
                  />
                </td>
                <td className="py-2 pr-2">
                  <SelectProcedimento
                    valor={linha.procedimento_id}
                    catalogo={catalogo}
                    rotuloPreco={rotuloPreco}
                    disabled={somenteLeitura}
                    onChange={(procedimento_id) => {
                      const next = [...linhas]
                      next[i] = { ...linha, procedimento_id }
                      onChange(next)
                    }}
                  />
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  {(totaisLinha[i] ?? 0) === 0 ? '—' : formatarPreco(totaisLinha[i] ?? 0)}
                </td>
                {!somenteLeitura ? (
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-xs text-texto/50 hover:text-texto"
                      onClick={() => onChange(linhas.filter((_, j) => j !== i))}
                      disabled={linhas.length <= 1}
                    >
                      Remover
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!somenteLeitura ? (
        <button
          type="button"
          className={BOTAO_SECUNDARIO}
          onClick={() => onChange([...linhas, linhaFillerVazia()])}
        >
          + Linha
        </button>
      ) : null}
    </div>
  )
}
