import type { MetadataRoute } from 'next'
import { carregarMarca } from '@/lib/marca'

/**
 * Manifest PWA dinâmico: se houver logo em Configurações → Marca, ela vira o
 * ícone do app; senão cai nos PNGs estáticos em /icons.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const marca = await carregarMarca()
  const icone = marca.logoUrl ?? '/icons/icon-192.png'
  const iconeGrande = marca.logoUrl ?? '/icons/icon-512.png'

  return {
    name: 'Clínica Izadora',
    short_name: 'Clínica Izadora',
    description: 'Sistema de atendimento da clínica',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f1ec',
    theme_color: '#a17c4b',
    lang: 'pt-BR',
    icons: [
      {
        src: icone,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: iconeGrande,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: icone,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: iconeGrande,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
