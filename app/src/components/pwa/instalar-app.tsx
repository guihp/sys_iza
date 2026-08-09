'use client'

import { useEffect, useState } from 'react'

type AntesDeInstalar = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function ehIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium/.test(ua)
  return ios && safari
}

function jaEstaInstalado(): boolean {
  if (typeof window === 'undefined') return false
  const standalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone =
    'standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone)
  return Boolean(standalone || iosStandalone)
}

const CLASSE_BOTAO_CABECALHO =
  'inline-flex min-h-11 items-center justify-center rounded-cartao border border-acento/40 bg-acento-suave px-3 py-2 text-[13px] font-medium leading-tight text-acento transition-colors hover:border-acento'

const CLASSE_FAIXA_MOBILE =
  'fixed inset-x-0 bottom-0 z-30 border-t border-linha bg-superficie px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] sm:hidden'

/**
 * CTA para instalar o PWA.
 *
 * Chrome/Edge: `beforeinstallprompt`. Safari iOS: instrução (não há API de
 * prompt). No telefone a faixa inferior garante área de toque e leitura; no
 * desktop o botão/dica ficam no cabeçalho. Esconde quando já está na tela
 * inicial.
 */
export function BotaoInstalarApp() {
  const [evento, setEvento] = useState<AntesDeInstalar | null>(null)
  const [ios, setIos] = useState(false)
  const [instalado, setInstalado] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setInstalado(jaEstaInstalado())
    setIos(ehIosSafari())

    function aoAntes(e: Event) {
      e.preventDefault()
      setEvento(e as AntesDeInstalar)
    }
    window.addEventListener('beforeinstallprompt', aoAntes)
    return () => window.removeEventListener('beforeinstallprompt', aoAntes)
  }, [])

  if (instalado || dismissed) return null

  async function instalar() {
    if (!evento) return
    await evento.prompt()
    const escolha = await evento.userChoice
    if (escolha.outcome === 'accepted') setInstalado(true)
    setEvento(null)
  }

  if (evento) {
    return (
      <>
        <button type="button" className={`hidden sm:inline-flex ${CLASSE_BOTAO_CABECALHO}`} onClick={instalar}>
          Instalar app
        </button>
        <div className={CLASSE_FAIXA_MOBILE} role="region" aria-label="Instalar aplicativo">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-cartao border border-acento bg-acento px-4 text-[15px] font-medium text-fundo"
            onClick={instalar}
          >
            Instalar na tela inicial
          </button>
          <button
            type="button"
            className="mt-2 w-full py-2 text-center text-[13px] text-texto-suave underline"
            onClick={() => setDismissed(true)}
          >
            Agora não
          </button>
        </div>
      </>
    )
  }

  if (ios) {
    return (
      <>
        <p className="hidden max-w-[16rem] text-[12px] leading-snug text-texto-suave md:block">
          No iPhone: Compartilhar → Adicionar à Tela de Início
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => setDismissed(true)}
            aria-label="Dispensar dica de instalação"
          >
            ok
          </button>
        </p>
        <div className={CLASSE_FAIXA_MOBILE} role="region" aria-label="Como instalar no iPhone">
          <p className="text-[14px] leading-snug text-texto">
            <span className="font-medium text-acento">Instalar no iPhone</span>
            <span className="mt-1 block text-texto-suave">
              Toque em Compartilhar → Adicionar à Tela de Início
            </span>
          </p>
          <button
            type="button"
            className="mt-3 min-h-11 w-full rounded-cartao border border-linha px-4 text-[14px] text-texto-suave"
            onClick={() => setDismissed(true)}
          >
            Entendi
          </button>
        </div>
      </>
    )
  }

  return null
}
