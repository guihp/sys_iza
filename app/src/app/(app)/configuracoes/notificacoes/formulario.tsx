'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  removerPushSubscription,
  salvarPushSubscription,
} from '@/app/(app)/configuracoes/notificacoes/acoes'

type Estado = 'desligado' | 'ligado' | 'sem-suporte' | 'sem-vapid' | 'negado' | 'carregando'

function urlBase64ParaUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Seguro = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Seguro)
  const saida = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) saida[i] = raw.charCodeAt(i)
  return saida
}

async function subscriptionAtual(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/**
 * Toggle: avisos de novo agendamento neste dispositivo.
 *
 * Default off até a pessoa ativar. iOS só funciona com PWA na tela inicial
 * e iOS 16.4+ — o texto da página deixa isso explícito.
 */
export function ToggleNotificacoesPush() {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [pendente, startTransition] = useTransition()

  const vapidPublica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || ''

  useEffect(() => {
    let cancelado = false
    async function conferir() {
      if (!vapidPublica) {
        if (!cancelado) setEstado('sem-vapid')
        return
      }
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelado) setEstado('sem-suporte')
        return
      }
      if (Notification.permission === 'denied') {
        if (!cancelado) setEstado('negado')
        return
      }
      const sub = await subscriptionAtual()
      if (!cancelado) setEstado(sub ? 'ligado' : 'desligado')
    }
    void conferir()
    return () => {
      cancelado = true
    }
  }, [vapidPublica])

  function ligar() {
    setMensagem(null)
    startTransition(async () => {
      try {
        if (!vapidPublica) {
          setEstado('sem-vapid')
          return
        }
        const permissao = await Notification.requestPermission()
        if (permissao !== 'granted') {
          setEstado(permissao === 'denied' ? 'negado' : 'desligado')
          setMensagem('Permissão de notificação não concedida neste navegador.')
          return
        }
        const reg = await navigator.serviceWorker.ready
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ParaUint8Array(vapidPublica) as BufferSource,
          }))
        const json = sub.toJSON()
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          setMensagem('O navegador não devolveu uma subscription completa.')
          return
        }
        const resultado = await salvarPushSubscription({
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          userAgent: navigator.userAgent.slice(0, 500),
        })
        if (!resultado.ok) {
          setMensagem(resultado.erro)
          return
        }
        setEstado('ligado')
      } catch {
        setMensagem('Não foi possível ativar as notificações neste dispositivo.')
      }
    })
  }

  function desligar() {
    setMensagem(null)
    startTransition(async () => {
      try {
        const sub = await subscriptionAtual()
        if (sub) {
          await removerPushSubscription(sub.endpoint)
          await sub.unsubscribe()
        }
        setEstado('desligado')
      } catch {
        setMensagem('Não foi possível desligar neste dispositivo.')
      }
    })
  }

  if (estado === 'carregando') {
    return <p className="text-sm text-texto-suave">Conferindo este dispositivo…</p>
  }

  if (estado === 'sem-vapid') {
    return (
      <p className="text-sm text-texto-suave">
        Push desligado no servidor: faltam as chaves VAPID nas variáveis de ambiente
        (veja DEPLOY.md).
      </p>
    )
  }

  if (estado === 'sem-suporte') {
    return (
      <p className="text-sm text-texto-suave">
        Este navegador não oferece Web Push. No iPhone, instale o app na Tela de Início
        (Safari, iOS 16.4 ou superior) e abra por lá.
      </p>
    )
  }

  if (estado === 'negado') {
    return (
      <p className="text-sm text-texto-suave">
        As notificações foram bloqueadas nas configurações do navegador ou do sistema.
        Libere a permissão e recarregue a página.
      </p>
    )
  }

  const ligado = estado === 'ligado'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          disabled={pendente}
          onClick={() => (ligado ? desligar() : ligar())}
          className={
            ligado
              ? 'inline-flex min-h-11 items-center rounded-cartao bg-acento px-4 text-sm text-white'
              : 'inline-flex min-h-11 items-center rounded-cartao border border-linha px-4 text-sm text-texto'
          }
        >
          {pendente ? 'Aguarde…' : ligado ? 'Avisos ligados neste aparelho' : 'Ligar avisos neste aparelho'}
        </button>
      </div>
      {mensagem ? <p className="text-sm text-texto-suave">{mensagem}</p> : null}
    </div>
  )
}
