'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { Cartao, Pilula, RotuloMiudo } from '@/components/ui'
import type { MarcaDaClinica } from '@/lib/marca'
import { removerFotoDoLogin, removerLogo, salvarFotoDoLogin, salvarLogo } from './acoes'

/**
 * Formulário de marca — foto do login e logo.
 * Upload local; prévia imediata depois do save (revalidate).
 */

export function FormularioDaMarca({ marcaInicial }: { marcaInicial: MarcaDaClinica }) {
  const [marca, setMarca] = useState(marcaInicial)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  function enviar(
    evento: FormEvent<HTMLFormElement>,
    acao: (dados: FormData) => Promise<{ ok: true; marca: MarcaDaClinica } | { ok: false; erro: string }>,
    sucesso: string,
  ) {
    evento.preventDefault()
    const dados = new FormData(evento.currentTarget)
    setErro(null)
    setAviso(null)
    iniciar(async () => {
      const resposta = await acao(dados)
      if (!resposta.ok) {
        setErro(resposta.erro)
        return
      }
      setMarca(resposta.marca)
      setAviso(sucesso)
      evento.currentTarget.reset()
    })
  }

  function remover(
    acao: () => Promise<{ ok: true; marca: MarcaDaClinica } | { ok: false; erro: string }>,
    sucesso: string,
  ) {
    setErro(null)
    setAviso(null)
    iniciar(async () => {
      const resposta = await acao()
      if (!resposta.ok) {
        setErro(resposta.erro)
        return
      }
      setMarca(resposta.marca)
      setAviso(sucesso)
    })
  }

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

        <div className="overflow-hidden rounded-cartao border border-linha bg-superficie-2">
          {marca.heroUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL local de upload
            <img src={marca.heroUrl} alt="Foto atual do login" className="h-48 w-full object-cover" />
          ) : (
            <p className="px-4 py-16 text-center text-[13px] text-texto-suave">
              Nenhuma foto ainda — o login usa só o fundo cream.
            </p>
          )}
        </div>

        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(evento) => enviar(evento, salvarFotoDoLogin, 'Foto do login salva.')}
        >
          <input
            type="file"
            name="arquivo"
            accept="image/jpeg,image/png,image/webp"
            required
            className="text-[13px] text-texto-suave file:mr-3 file:rounded-full file:border file:border-linha file:bg-superficie file:px-4 file:py-2 file:text-[11px] file:uppercase file:tracking-[0.1em]"
          />
          <Pilula type="submit" variante="solida" disabled={pendente}>
            {pendente ? 'Salvando…' : 'Salvar foto'}
          </Pilula>
          {marca.heroUrl ? (
            <Pilula
              type="button"
              variante="contorno"
              disabled={pendente}
              onClick={() => remover(removerFotoDoLogin, 'Foto do login removida.')}
            >
              Remover
            </Pilula>
          ) : null}
        </form>
      </Cartao>

      <Cartao className="space-y-4 p-6">
        <div className="space-y-1">
          <RotuloMiudo tom="acento">Logo</RotuloMiudo>
          <h2 className="font-serif text-[22px] leading-tight">Identidade</h2>
          <p className="text-[13px] text-texto-suave">
            Aparece no login (ao lado do nome) e na barra lateral do sistema.
          </p>
        </div>

        <div className="flex h-28 items-center justify-center rounded-cartao border border-linha bg-superficie-2">
          {marca.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={marca.logoUrl} alt="Logo atual" className="max-h-20 max-w-[200px] object-contain" />
          ) : (
            <p className="text-[13px] text-texto-suave">Nenhuma logo ainda.</p>
          )}
        </div>

        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(evento) => enviar(evento, salvarLogo, 'Logo salva.')}
        >
          <input
            type="file"
            name="arquivo"
            accept="image/jpeg,image/png,image/webp"
            required
            className="text-[13px] text-texto-suave file:mr-3 file:rounded-full file:border file:border-linha file:bg-superficie file:px-4 file:py-2 file:text-[11px] file:uppercase file:tracking-[0.1em]"
          />
          <Pilula type="submit" variante="solida" disabled={pendente}>
            {pendente ? 'Salvando…' : 'Salvar logo'}
          </Pilula>
          {marca.logoUrl ? (
            <Pilula
              type="button"
              variante="contorno"
              disabled={pendente}
              onClick={() => remover(removerLogo, 'Logo removida.')}
            >
              Remover
            </Pilula>
          ) : null}
        </form>
      </Cartao>
    </div>
  )
}
