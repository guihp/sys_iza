'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Cartao, Pilula, RotuloMiudo } from '@/components/ui'
import {
  estiloImagemDaLogo,
  LOGO_ESCALA_MAX,
  LOGO_ESCALA_MIN,
  normalizarEnquadramento,
  normalizarEscalaDaLogo,
  normalizarPosicaoDaLogo,
  type EnquadramentoDaLogo,
  type MarcaDaClinica,
} from '@/lib/marca'
import {
  removerFotoDoLogin,
  removerLogo,
  salvarEnquadramentoDaLogo,
  salvarFotoDoLogin,
  salvarLogo,
} from './acoes'
import { removerFundoDeImagem } from '@/lib/marca-remover-fundo'

type Resultado =
  | { ok: true; marca: MarcaDaClinica }
  | { ok: false; erro: string }

function nomeDoArquivo(url: string | null): string | null {
  if (!url) return null
  const pedaco = url.split('/').pop()
  return pedaco && pedaco.length > 0 ? pedaco : null
}

function enqDaMarca(m: MarcaDaClinica): EnquadramentoDaLogo {
  return { escala: m.logoEscala, posX: m.logoPosX, posY: m.logoPosY }
}

function enqSujo(a: EnquadramentoDaLogo, b: EnquadramentoDaLogo): boolean {
  const x = normalizarEnquadramento(a)
  const y = normalizarEnquadramento(b)
  return x.escala !== y.escala || x.posX !== y.posX || x.posY !== y.posY
}

export function FormularioDaMarca({ marcaInicial }: { marcaInicial: MarcaDaClinica }) {
  const [marca, setMarca] = useState(marcaInicial)
  const [previaHero, setPreviaHero] = useState<string | null>(null)
  const [arquivoHero, setArquivoHero] = useState<File | null>(null)
  const [previaLogo, setPreviaLogo] = useState<string | null>(null)
  const [arquivoLogo, setArquivoLogo] = useState<File | null>(null)
  const [enq, setEnq] = useState(enqDaMarca(marcaInicial))
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const [removendoFundo, setRemovendoFundo] = useState(false)
  const inputHero = useRef<HTMLInputElement>(null)
  const inputLogo = useRef<HTMLInputElement>(null)
  const arrasto = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null)
  const idHero = useId()
  const idLogo = useId()
  const idZoom = useId()
  const idPosX = useId()
  const idPosY = useId()

  useEffect(() => {
    setMarca(marcaInicial)
    setEnq(enqDaMarca(marcaInicial))
  }, [marcaInicial])

  useEffect(() => {
    return () => {
      if (previaHero) URL.revokeObjectURL(previaHero)
      if (previaLogo) URL.revokeObjectURL(previaLogo)
    }
  }, [previaHero, previaLogo])

  function escolher(
    evento: ChangeEvent<HTMLInputElement>,
    setArquivo: (f: File | null) => void,
    setPrevia: (url: string | null) => void,
    previaAtual: string | null,
  ) {
    const arquivo = evento.target.files?.[0] ?? null
    if (previaAtual) URL.revokeObjectURL(previaAtual)
    setArquivo(arquivo)
    setPrevia(arquivo ? URL.createObjectURL(arquivo) : null)
    setErro(null)
    setAviso(null)
  }

  function limparHeroLocal() {
    if (previaHero) URL.revokeObjectURL(previaHero)
    setPreviaHero(null)
    setArquivoHero(null)
    if (inputHero.current) inputHero.current.value = ''
  }

  function limparLogoLocal() {
    if (previaLogo) URL.revokeObjectURL(previaLogo)
    setPreviaLogo(null)
    setArquivoLogo(null)
    if (inputLogo.current) inputLogo.current.value = ''
  }

  function aplicarMarca(proxima: MarcaDaClinica) {
    setMarca(proxima)
    setEnq(enqDaMarca(proxima))
  }

  function salvar(
    arquivo: File | null,
    acao: (dados: FormData) => Promise<Resultado>,
    sucesso: string,
    limparLocal: () => void,
  ) {
    if (!arquivo) {
      setErro('Escolha uma imagem antes de salvar.')
      return
    }
    const dados = new FormData()
    dados.set('arquivo', arquivo)
    setErro(null)
    setAviso(null)
    iniciar(async () => {
      const resposta = await acao(dados)
      if (!resposta.ok) {
        setErro(resposta.erro)
        return
      }
      aplicarMarca(resposta.marca)
      setAviso(sucesso)
      limparLocal()
    })
  }

  function remover(acao: () => Promise<Resultado>, sucesso: string, limparLocal: () => void) {
    setErro(null)
    setAviso(null)
    iniciar(async () => {
      const resposta = await acao()
      if (!resposta.ok) {
        setErro(resposta.erro)
        return
      }
      aplicarMarca(resposta.marca)
      setAviso(sucesso)
      limparLocal()
    })
  }

  function gravarEnquadramento() {
    setErro(null)
    setAviso(null)
    iniciar(async () => {
      const resposta = await salvarEnquadramentoDaLogo(normalizarEnquadramento(enq))
      if (!resposta.ok) {
        setErro(resposta.erro)
        return
      }
      aplicarMarca(resposta.marca)
      setAviso('Enquadramento salvo — login, lateral e ícone do app.')
    })
  }

  async function aoRemoverFundo() {
    const fonte = arquivoLogo ?? previaLogo ?? marca.logoUrl
    if (!fonte) {
      setErro('Escolha ou salve uma logo antes de remover o fundo.')
      return
    }
    setErro(null)
    setAviso(null)
    setRemovendoFundo(true)
    try {
      const semFundo = await removerFundoDeImagem(fonte)
      if (previaLogo) URL.revokeObjectURL(previaLogo)
      setArquivoLogo(semFundo)
      setPreviaLogo(URL.createObjectURL(semFundo))
      setAviso('Fundo removido (prévia). Clique em Salvar logo para gravar no sistema.')
    } catch {
      setErro(
        'Não foi possível remover o fundo. Confira a conexão (baixa o modelo na 1ª vez) e tente de novo.',
      )
    } finally {
      setRemovendoFundo(false)
    }
  }

  function aoPointerDown(evento: ReactPointerEvent<HTMLDivElement>) {
    if (!logoVisivel || pendente) return
    evento.currentTarget.setPointerCapture(evento.pointerId)
    arrasto.current = {
      x: evento.clientX,
      y: evento.clientY,
      posX: enq.posX,
      posY: enq.posY,
    }
  }

  function aoPointerMove(evento: ReactPointerEvent<HTMLDivElement>) {
    const inicio = arrasto.current
    if (!inicio) return
    const dx = evento.clientX - inicio.x
    const dy = evento.clientY - inicio.y
    // Arrastar a imagem: movimento inverso no foco (como pan de mapa).
    setEnq((atual) =>
      normalizarEnquadramento({
        ...atual,
        posX: inicio.posX - dx * 0.35,
        posY: inicio.posY - dy * 0.35,
      }),
    )
  }

  function aoPointerUp(evento: ReactPointerEvent<HTMLDivElement>) {
    if (arrasto.current) {
      try {
        evento.currentTarget.releasePointerCapture(evento.pointerId)
      } catch {
        /* já solto */
      }
    }
    arrasto.current = null
  }

  const heroVisivel = previaHero ?? marca.heroUrl
  const logoVisivel = previaLogo ?? marca.logoUrl
  const zoomPct = Math.round(normalizarEscalaDaLogo(enq.escala) * 100)
  const sujo = enqSujo(enq, enqDaMarca(marca))

  return (
    <div className="space-y-6">
      {erro ? (
        <p role="alert" className="text-sm text-alerta">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p role="status" className="text-sm text-texto-suave">
          {aviso}
        </p>
      ) : null}

      <Cartao className="space-y-4 p-6">
        <div className="space-y-1">
          <RotuloMiudo tom="acento">Foto do login</RotuloMiudo>
          <h2 className="font-serif text-[22px] leading-tight">Painel esquerdo</h2>
          <p className="text-[13px] text-texto-suave">
            Aparece atrás do texto de boas-vindas na tela de login. JPEG, PNG ou WebP, até 5 MB.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-cartao border border-linha bg-superficie-2">
          {heroVisivel ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroVisivel}
              alt={previaHero ? 'Prévia da foto do login' : 'Foto salva do login'}
              className="h-48 w-full object-cover"
            />
          ) : (
            <p className="px-4 py-16 text-center text-[13px] text-texto-suave">
              Nenhuma foto ainda — o login usa só o fundo cream.
            </p>
          )}
          {previaHero ? (
            <span className="absolute left-3 top-3 rounded-full bg-solido px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-solido-texto">
              Prévia
            </span>
          ) : marca.heroUrl ? (
            <span className="absolute left-3 top-3 rounded-full bg-acento-suave px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-acento">
              Salva
            </span>
          ) : null}
        </div>

        <p className="text-[13px] text-texto-suave">
          {arquivoHero
            ? `Nova imagem: ${arquivoHero.name} — clique em Salvar para gravar.`
            : marca.heroUrl
              ? `Foto salva: ${nomeDoArquivo(marca.heroUrl)}`
              : 'Nenhuma foto salva.'}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            id={idHero}
            ref={inputHero}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(evento) => escolher(evento, setArquivoHero, setPreviaHero, previaHero)}
          />
          <Pilula type="button" variante="contorno" onClick={() => inputHero.current?.click()}>
            {marca.heroUrl || arquivoHero ? 'Trocar foto' : 'Escolher foto'}
          </Pilula>
          <Pilula
            type="button"
            variante="solida"
            disabled={pendente || !arquivoHero}
            onClick={() =>
              salvar(arquivoHero, salvarFotoDoLogin, 'Foto do login salva.', limparHeroLocal)
            }
          >
            {pendente ? 'Salvando…' : 'Salvar foto'}
          </Pilula>
          {marca.heroUrl || previaHero ? (
            <Pilula
              type="button"
              variante="contorno"
              disabled={pendente}
              onClick={() => {
                if (arquivoHero) {
                  limparHeroLocal()
                  return
                }
                remover(removerFotoDoLogin, 'Foto do login removida.', limparHeroLocal)
              }}
            >
              {arquivoHero ? 'Cancelar prévia' : 'Remover'}
            </Pilula>
          ) : null}
        </div>
      </Cartao>

      <Cartao className="space-y-4 p-6">
        <div className="space-y-1">
          <RotuloMiudo tom="acento">Logo</RotuloMiudo>
          <h2 className="font-serif text-[22px] leading-tight">Identidade</h2>
          <p className="text-[13px] text-texto-suave">
            Recorte, zoom e remoção de fundo. Vale no login, na barra lateral e no ícone do app.
          </p>
        </div>

        <div
          className={`relative mx-auto touch-none select-none overflow-hidden rounded-cartao border border-linha ${
            logoVisivel ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
          style={{
            width: 200,
            height: 72,
            maxWidth: '100%',
            backgroundColor: '#f3efe8',
            backgroundImage:
              'linear-gradient(45deg, #e4ded4 25%, transparent 25%), linear-gradient(-45deg, #e4ded4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e4ded4 75%), linear-gradient(-45deg, transparent 75%, #e4ded4 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
          }}
          onPointerDown={aoPointerDown}
          onPointerMove={aoPointerMove}
          onPointerUp={aoPointerUp}
          onPointerCancel={aoPointerUp}
        >
          {logoVisivel ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoVisivel}
              alt={previaLogo ? 'Prévia da logo' : 'Logo salva'}
              draggable={false}
              className="pointer-events-none"
              style={estiloImagemDaLogo(enq)}
            />
          ) : (
            <p className="flex h-full items-center justify-center text-[13px] text-texto-suave">
              Nenhuma logo ainda.
            </p>
          )}
          {previaLogo ? (
            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-solido px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-solido-texto">
              Prévia
            </span>
          ) : marca.logoUrl ? (
            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-acento-suave px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-acento">
              Salva
            </span>
          ) : null}
        </div>
        <p className="text-center text-[12px] text-texto-mudo">
          Arraste no quadro para escolher o recorte
        </p>

        <div className="space-y-4 rounded-cartao border border-linha-2 bg-superficie-2 p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={idZoom} className="text-[13px] text-texto">
                Zoom
              </label>
              <span className="tabular-nums text-[13px] text-texto-suave">{zoomPct}%</span>
            </div>
            <input
              id={idZoom}
              type="range"
              min={LOGO_ESCALA_MIN}
              max={LOGO_ESCALA_MAX}
              step={0.05}
              value={enq.escala}
              disabled={!logoVisivel || pendente}
              onChange={(evento) =>
                setEnq((a) => ({ ...a, escala: normalizarEscalaDaLogo(Number(evento.target.value)) }))
              }
              className="w-full accent-[var(--color-acento)] disabled:opacity-40"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={idPosX} className="text-[13px] text-texto">
                Lateral (esquerda ↔ direita)
              </label>
              <span className="tabular-nums text-[13px] text-texto-suave">
                {Math.round(enq.posX)}%
              </span>
            </div>
            <input
              id={idPosX}
              type="range"
              min={0}
              max={100}
              step={1}
              value={enq.posX}
              disabled={!logoVisivel || pendente}
              onChange={(evento) =>
                setEnq((a) => ({
                  ...a,
                  posX: normalizarPosicaoDaLogo(Number(evento.target.value)),
                }))
              }
              className="w-full accent-[var(--color-acento)] disabled:opacity-40"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={idPosY} className="text-[13px] text-texto">
                Vertical (cima ↔ baixo)
              </label>
              <span className="tabular-nums text-[13px] text-texto-suave">
                {Math.round(enq.posY)}%
              </span>
            </div>
            <input
              id={idPosY}
              type="range"
              min={0}
              max={100}
              step={1}
              value={enq.posY}
              disabled={!logoVisivel || pendente}
              onChange={(evento) =>
                setEnq((a) => ({
                  ...a,
                  posY: normalizarPosicaoDaLogo(Number(evento.target.value)),
                }))
              }
              className="w-full accent-[var(--color-acento)] disabled:opacity-40"
            />
          </div>

          <p className="text-[12px] text-texto-mudo">
            Zoom aproxima a arte dentro de um quadro fixo (menu não encolhe). Use laterais /
            arraste pra enquadrar. Salve o enquadramento para gravar.
          </p>

          <div className="flex flex-wrap gap-3">
            <Pilula
              type="button"
              variante="solida"
              disabled={pendente || !logoVisivel || !sujo}
              onClick={gravarEnquadramento}
            >
              {pendente ? 'Salvando…' : 'Salvar enquadramento'}
            </Pilula>
            <Pilula
              type="button"
              variante="contorno"
              disabled={pendente || !logoVisivel}
              onClick={() =>
                setEnq({ escala: 1, posX: 50, posY: 50 })
              }
            >
              Resetar
            </Pilula>
          </div>
        </div>

        <p className="text-[13px] text-texto-suave">
          {arquivoLogo
            ? `Nova imagem: ${arquivoLogo.name} — clique em Salvar logo para gravar.`
            : marca.logoUrl
              ? `Logo salva: ${nomeDoArquivo(marca.logoUrl)}`
              : 'Nenhuma logo salva.'}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            id={idLogo}
            ref={inputLogo}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(evento) => escolher(evento, setArquivoLogo, setPreviaLogo, previaLogo)}
          />
          <Pilula type="button" variante="contorno" onClick={() => inputLogo.current?.click()}>
            {marca.logoUrl || arquivoLogo ? 'Trocar logo' : 'Escolher logo'}
          </Pilula>
          <Pilula
            type="button"
            variante="contorno"
            disabled={pendente || removendoFundo || !(arquivoLogo || marca.logoUrl || previaLogo)}
            onClick={() => void aoRemoverFundo()}
          >
            {removendoFundo ? 'Removendo fundo…' : 'Remover fundo'}
          </Pilula>
          <Pilula
            type="button"
            variante="solida"
            disabled={pendente || removendoFundo || !arquivoLogo}
            onClick={() => salvar(arquivoLogo, salvarLogo, 'Logo salva.', limparLogoLocal)}
          >
            {pendente ? 'Salvando…' : 'Salvar logo'}
          </Pilula>
          {marca.logoUrl || previaLogo ? (
            <Pilula
              type="button"
              variante="contorno"
              disabled={pendente || removendoFundo}
              onClick={() => {
                if (arquivoLogo) {
                  limparLogoLocal()
                  return
                }
                remover(removerLogo, 'Logo removida.', limparLogoLocal)
              }}
            >
              {arquivoLogo ? 'Cancelar prévia' : 'Remover'}
            </Pilula>
          ) : null}
        </div>
      </Cartao>
    </div>
  )
}
