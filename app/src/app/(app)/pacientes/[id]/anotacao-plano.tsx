'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnotacaoPlano, TracoAnotacao } from './tipos'

const CORES = ['#1a1a1a', '#c45c26', '#1d4ed8', '#15803d', '#be123c', '#ffffff'] as const

type Ferramenta = 'caneta' | 'borracha'

function anotacaoVazia(): AnotacaoPlano {
  return { versao: 1, tracos: [] }
}

function normalizarAnotacao(valor: AnotacaoPlano | null | undefined): AnotacaoPlano {
  if (!valor || valor.versao !== 1 || !Array.isArray(valor.tracos)) return anotacaoVazia()
  return { versao: 1, tracos: valor.tracos }
}

/**
 * Canvas de anotação sobre a foto-capa do plano.
 * Caneta, borracha, cores, desfazer/refazer e limpar — sem lib externa.
 */
export function AnotacaoPlanoCanvas({
  capaSrc,
  valor,
  onChange,
  somenteLeitura,
}: {
  capaSrc: string
  valor: AnotacaoPlano | null
  onChange: (prox: AnotacaoPlano) => void
  somenteLeitura: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const desenhando = useRef(false)
  const tracoAtual = useRef<TracoAnotacao | null>(null)

  const [ferramenta, setFerramenta] = useState<Ferramenta>('caneta')
  const [cor, setCor] = useState<string>(CORES[0])
  const [espessura, setEspessura] = useState(3)
  const [historico, setHistorico] = useState<AnotacaoPlano[]>(() => [normalizarAnotacao(valor)])
  const [indice, setIndice] = useState(0)

  const anotacao = historico[indice] ?? anotacaoVazia()

  const publicar = useCallback(
    (prox: AnotacaoPlano, baseIndice = indice) => {
      const truncado = historico.slice(0, baseIndice + 1)
      truncado.push(prox)
      setHistorico(truncado)
      setIndice(truncado.length - 1)
      onChange(prox)
    },
    [historico, indice, onChange],
  )

  const desenhar = useCallback((tracos: TracoAnotacao[]) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return

    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    for (const traco of tracos) {
      if (traco.pontos.length < 2) continue
      ctx.beginPath()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = traco.espessura
      if (traco.ferramenta === 'borracha') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'
      } else {
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = traco.cor
      }
      const [primeiro, ...resto] = traco.pontos
      ctx.moveTo(primeiro.x * w, primeiro.y * h)
      for (const p of resto) ctx.lineTo(p.x * w, p.y * h)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  }, [])

  useEffect(() => {
    desenhar(anotacao.tracos)
  }, [anotacao, desenhar])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => desenhar(anotacao.tracos))
    ro.observe(container)
    return () => ro.disconnect()
  }, [anotacao.tracos, desenhar])

  function pontoDoEvento(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  function aoPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (somenteLeitura) return
    const p = pontoDoEvento(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    desenhando.current = true
    tracoAtual.current = {
      pontos: [p],
      cor,
      espessura: ferramenta === 'borracha' ? Math.max(espessura * 3, 12) : espessura,
      ferramenta,
    }
  }

  function aoPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current || !tracoAtual.current) return
    const p = pontoDoEvento(e)
    if (!p) return
    tracoAtual.current.pontos.push(p)
    desenhar([...anotacao.tracos, tracoAtual.current])
  }

  function finalizarTraco() {
    if (!desenhando.current || !tracoAtual.current) return
    desenhando.current = false
    const traco = tracoAtual.current
    tracoAtual.current = null
    if (traco.pontos.length < 2) {
      desenhar(anotacao.tracos)
      return
    }
    publicar({ versao: 1, tracos: [...anotacao.tracos, traco] })
  }

  function desfazer() {
    if (indice <= 0) return
    const novo = indice - 1
    setIndice(novo)
    onChange(historico[novo] ?? anotacaoVazia())
  }

  function refazer() {
    if (indice >= historico.length - 1) return
    const novo = indice + 1
    setIndice(novo)
    onChange(historico[novo] ?? anotacaoVazia())
  }

  function limpar() {
    if (somenteLeitura) return
    publicar(anotacaoVazia())
  }

  return (
    <div className="space-y-3">
      {!somenteLeitura ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              ferramenta === 'caneta' ? 'border-acento bg-acento/10' : 'border-linha'
            }`}
            onClick={() => setFerramenta('caneta')}
          >
            Caneta
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              ferramenta === 'borracha' ? 'border-acento bg-acento/10' : 'border-linha'
            }`}
            onClick={() => setFerramenta('borracha')}
          >
            Borracha
          </button>
          <div className="flex items-center gap-1.5">
            {CORES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                className={`h-7 w-7 rounded-full border ${
                  cor === c ? 'border-acento ring-2 ring-acento/40' : 'border-linha'
                }`}
                style={{ backgroundColor: c }}
                onClick={() => {
                  setCor(c)
                  setFerramenta('caneta')
                }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-texto/60">
            Espessura
            <input
              type="range"
              min={1}
              max={12}
              value={espessura}
              onChange={(e) => setEspessura(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="rounded-lg border border-linha px-3 py-1.5 text-sm disabled:opacity-40"
            onClick={desfazer}
            disabled={indice <= 0}
          >
            Desfazer
          </button>
          <button
            type="button"
            className="rounded-lg border border-linha px-3 py-1.5 text-sm disabled:opacity-40"
            onClick={refazer}
            disabled={indice >= historico.length - 1}
          >
            Refazer
          </button>
          <button
            type="button"
            className="rounded-lg border border-linha px-3 py-1.5 text-sm"
            onClick={limpar}
          >
            Limpar
          </button>
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-linha bg-fundo-suave"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={capaSrc}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full touch-none ${
            somenteLeitura ? 'pointer-events-none' : 'cursor-crosshair'
          }`}
          onPointerDown={aoPointerDown}
          onPointerMove={aoPointerMove}
          onPointerUp={finalizarTraco}
          onPointerCancel={finalizarTraco}
        />
      </div>
    </div>
  )
}
