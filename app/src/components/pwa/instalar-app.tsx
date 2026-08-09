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

/**
 * CTA discreto para instalar o PWA.
 *
 * Chrome/Edge: `beforeinstallprompt`. Safari iOS: só instrução (não há API
 * de prompt). Esconde quando já está na tela inicial.
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

  if (evento) {
    return (
      <button
        type="button"
        className="hidden rounded-cartao border border-linha px-3 py-1.5 text-[12px] text-texto-suave transition-colors hover:border-acento hover:text-texto sm:inline-flex"
        onClick={async () => {
          await evento.prompt()
          const escolha = await evento.userChoice
          if (escolha.outcome === 'accepted') setInstalado(true)
          setEvento(null)
        }}
      >
        Instalar app
      </button>
    )
  }

  if (ios) {
    return (
      <p className="hidden max-w-[14rem] text-[11px] leading-snug text-texto-mudo md:block">
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
    )
  }

  return null
}
