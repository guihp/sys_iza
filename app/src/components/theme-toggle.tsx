'use client'

import { useSyncExternalStore } from 'react'
import { Pilula } from '@/components/ui'
import { CHAVE_TEMA, EVENTO_TEMA, ehTema, type Tema } from '@/lib/tema'

function prefereEscuro(): boolean {
  // jsdom não implementa matchMedia; a guarda mantém o componente testável.
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function assinar(aoMudar: () => void) {
  window.addEventListener(EVENTO_TEMA, aoMudar)
  window.addEventListener('storage', aoMudar)
  return () => {
    window.removeEventListener(EVENTO_TEMA, aoMudar)
    window.removeEventListener('storage', aoMudar)
  }
}

/**
 * O tema não vive em estado do React: a fonte da verdade é o DOM (marcado
 * pelo script do `layout.tsx`), com o `localStorage` e a preferência do
 * sistema como fallback. `useSyncExternalStore` lê isso sem `useEffect` e
 * sem erro de hidratação — no servidor devolve o padrão claro.
 */
function lerTema(): Tema {
  const marcado = document.documentElement.dataset.tema
  if (ehTema(marcado)) return marcado

  const salvo = localStorage.getItem(CHAVE_TEMA)
  if (ehTema(salvo)) return salvo

  return prefereEscuro() ? 'escuro' : 'claro'
}

function lerTemaNoServidor(): Tema {
  return 'claro'
}

export function ThemeToggle() {
  const tema = useSyncExternalStore(assinar, lerTema, lerTemaNoServidor)

  function alternar() {
    const proximo: Tema = tema === 'claro' ? 'escuro' : 'claro'
    document.documentElement.dataset.tema = proximo
    localStorage.setItem(CHAVE_TEMA, proximo)
    window.dispatchEvent(new Event(EVENTO_TEMA))
  }

  // Só a aparência mudou: é uma `Pilula contorno`, e a caixa alta vem do CSS
  // (`uppercase`), não do texto. O rótulo continua sendo "Escuro"/"Claro" no
  // DOM — trocá-lo por "ESCURO" mudaria o que o leitor de tela soletra.
  return (
    <Pilula
      variante="contorno"
      onClick={alternar}
      aria-label="Alternar tema"
      className="min-h-11 px-4"
    >
      {tema === 'claro' ? 'Escuro' : 'Claro'}
    </Pilula>
  )
}
