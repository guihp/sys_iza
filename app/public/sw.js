/**
 * Service worker da PWA — cache leve da casca + Web Push.
 *
 * Fica em /public para ser servido na raiz (`/sw.js`). Sem framework: o SW
 * precisa ser um arquivo estático previsível para o registro no client.
 *
 * Som da notificação:
 * - `silent: false` pede o som do sistema (comportamento padrão).
 * - `sound` aponta um WAV curto; Chrome no Android em geral ignora som
 *   customizado e usa o tom do sistema; iOS (PWA na Tela de Início, 16.4+)
 *   também usa o som do sistema — não há como forçar um arquivo próprio em
 *   todos os aparelhos. Sem `silent: true`, o SO decide o áudio.
 */

const CACHE = 'clinica-iza-shell-v3'
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/Favicon_Logo_App.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/sounds/notificacao.wav',
]
const SOM_NOTIFICACAO = '/sounds/notificacao.wav'

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((chave) => chave !== CACHE).map((chave) => caches.delete(chave))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request
  if (pedido.method !== 'GET') return
  // Só cacheia navegação e assets estáticos da casca — dados da API nunca.
  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin) return
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      fetch(pedido).catch(() => caches.match('/') || caches.match(pedido)),
    )
    return
  }
  if (SHELL.some((caminho) => url.pathname === caminho)) {
    evento.respondWith(
      caches.match(pedido).then((hit) => hit || fetch(pedido)),
    )
  }
})

self.addEventListener('push', (evento) => {
  let dados = { titulo: 'Novo agendamento', corpo: 'Há um novo horário na agenda.', url: '/agenda' }
  try {
    if (evento.data) {
      const json = evento.data.json()
      dados = {
        titulo: typeof json.titulo === 'string' ? json.titulo : dados.titulo,
        corpo: typeof json.corpo === 'string' ? json.corpo : dados.corpo,
        url: typeof json.url === 'string' ? json.url : dados.url,
      }
    }
  } catch {
    // Payload não-JSON: mantém o default.
  }

  evento.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Pedir som do sistema; `silent: true` silenciaria em várias plataformas.
      silent: false,
      // Custom sound: suportado de forma irregular (ver comentário no topo).
      sound: SOM_NOTIFICACAO,
      vibrate: [140, 80, 140],
      data: { url: dados.url },
    }),
  )
})

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const alvo = (evento.notification.data && evento.notification.data.url) || '/agenda'
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
      for (const cliente of clientes) {
        if ('focus' in cliente) {
          cliente.navigate(alvo)
          return cliente.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(alvo)
    }),
  )
})
