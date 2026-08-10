'use client'

import {
  estiloImagemDaLogo,
  tamanhoQuadroDaLogo,
  type EnquadramentoDaLogo,
} from '@/lib/marca'

/**
 * Quadro de tamanho fixo: zoom escala a imagem por dentro (não empurra o menu).
 */
export function LogoEnquadrada({
  src,
  alt,
  enquadramento,
  alturaPx,
  larguraPx,
  className = '',
}: {
  src: string
  alt: string
  enquadramento: EnquadramentoDaLogo
  alturaPx: number
  larguraPx: number
  className?: string
}) {
  const quadro = tamanhoQuadroDaLogo({ alturaPx, larguraPx })
  const img = estiloImagemDaLogo(enquadramento)

  return (
    <div
      className={`overflow-hidden rounded-cartao ${className}`}
      style={{ width: quadro.width, height: quadro.height, maxWidth: '100%' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} draggable={false} style={img} />
    </div>
  )
}
