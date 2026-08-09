'use client'

import { useEffect } from 'react'

/**
 * Registra o service worker depois do login (área autenticada).
 *
 * Só em HTTPS ou localhost — o browser recusa em HTTP comum. Falha silenciosa:
 * sem SW não há PWA nem push, mas o sistema web segue normal.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    const seguro =
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    if (!seguro) return

    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registro falhou (SW inválido, rede): ignore — app web continua.
    })
  }, [])

  return null
}
