'use client'

import { useEffect, useId, useRef, useState, useTransition, type ChangeEvent } from 'react'
import { Cartao, Pilula, RotuloMiudo } from '@/components/ui'
import type { MarcaDaClinica } from '@/lib/marca'
import { removerFotoDoLogin, removerLogo, salvarFotoDoLogin, salvarLogo } from './acoes'

/**
 * Formulário de marca — foto do login e logo.
 *
 * O `<input type="file">` nativo **sempre** volta a "Nenhum arquivo escolhido"
 * depois do reload (o browser não deixa pré-preencher). Por isso o status real
 * mora no texto ao lado ("Foto salva", "Prévia…"), não no input.
 */

type Resultado =
  | { ok: true; marca: MarcaDaClinica }
  | { ok: false; erro: string }

function nomeDoArquivo(url: string | null): string | null {
  if (!url) return null
  const pedaco = url.split('/').pop()
  return pedaco && pedaco.length > 0 ? pedaco : null
}

export function FormularioDaMarca({ marcaInicial }: { marcaInicial: MarcaDaClinica }) {
  const [marca, setMarca] = useState(marcaInicial)
  const [previaHero, setPreviaHero] = useState<string | null>(null)
  const [arquivoHero, setArquivoHero] = useState<File | null>(null)
  const [previaLogo, setPreviaLogo] = useState<string | null>(null)
  const [arquivoLogo, setArquivoLogo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const inputHero = useRef<HTMLInputElement>(null)
  const inputLogo = useRef<HTMLInputElement>(null)
  const idHero = useId()
  const idLogo = useId()

  useEffect(() => {
    setMarca(marcaInicial)
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
      setMarca(resposta.marca)
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
      setMarca(resposta.marca)
      setAviso(sucesso)
      limparLocal()
    })
  }

  const heroVisivel = previaHero ?? marca.heroUrl
  const logoVisivel = previaLogo ?? marca.logoUrl

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
            Aparece no login (ao lado do nome) e na barra lateral do sistema.
          </p>
        </div>

        <div className="relative flex h-28 items-center justify-center rounded-cartao border border-linha bg-superficie-2">
          {logoVisivel ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoVisivel}
              alt={previaLogo ? 'Prévia da logo' : 'Logo salva'}
              className="max-h-20 max-w-[200px] object-contain"
            />
          ) : (
            <p className="text-[13px] text-texto-suave">Nenhuma logo ainda.</p>
          )}
          {previaLogo ? (
            <span className="absolute left-3 top-3 rounded-full bg-solido px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-solido-texto">
              Prévia
            </span>
          ) : marca.logoUrl ? (
            <span className="absolute left-3 top-3 rounded-full bg-acento-suave px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-acento">
              Salva
            </span>
          ) : null}
        </div>

        <p className="text-[13px] text-texto-suave">
          {arquivoLogo
            ? `Nova imagem: ${arquivoLogo.name} — clique em Salvar para gravar.`
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
            variante="solida"
            disabled={pendente || !arquivoLogo}
            onClick={() => salvar(arquivoLogo, salvarLogo, 'Logo salva.', limparLogoLocal)}
          >
            {pendente ? 'Salvando…' : 'Salvar logo'}
          </Pilula>
          {marca.logoUrl || previaLogo ? (
            <Pilula
              type="button"
              variante="contorno"
              disabled={pendente}
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
