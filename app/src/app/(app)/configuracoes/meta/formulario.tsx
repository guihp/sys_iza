'use client'

import { useId, useState, useTransition } from 'react'
import { Cartao, RotuloMiudo } from '@/components/ui'
import {
  mascararMoedaAoDigitar,
  precoParaCampo,
} from '@/app/(app)/configuracoes/procedimentos/formatacao'
import { formatarValorRedondo } from '@/lib/meta'
import { salvarMetaDoMes } from './acoes'

type Props = {
  metaInicialCentavos: number
  /** Nome do mês no calendário da clínica, ex. `agosto`. */
  nomeDoMesAtual: string
}

/**
 * Formulário da meta do mês corrente — um campo, um botão.
 * O valor grande abaixo confirma o que ficou gravado.
 */
export function FormularioDaMeta({ metaInicialCentavos, nomeDoMesAtual }: Props) {
  const id = useId()
  const [campo, setCampo] = useState(precoParaCampo(metaInicialCentavos))
  const [salva, setSalva] = useState(metaInicialCentavos)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const dados = new FormData(evento.currentTarget)
    setErro(null)
    setAviso(null)

    iniciar(async () => {
      const resultado = await salvarMetaDoMes(dados)
      if (!resultado.ok) {
        setErro(resultado.erro)
        return
      }
      setSalva(resultado.metaCentavos)
      setCampo(precoParaCampo(resultado.metaCentavos))
      setAviso('Meta salva. O cartão da lateral usa este valor.')
    })
  }

  return (
    <Cartao className="max-w-md space-y-5 p-5">
      <form onSubmit={enviar} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor={id} className="block">
            <RotuloMiudo>Meta do mês de {nomeDoMesAtual} (R$)</RotuloMiudo>
          </label>
          <input
            id={id}
            name="meta"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={campo}
            onChange={(evento) => {
              setCampo(mascararMoedaAoDigitar(evento.target.value))
              setErro(null)
              setAviso(null)
            }}
            className="w-full rounded-cartao border border-linha bg-fundo px-3 py-2.5 text-sm text-texto outline-none focus:border-acento"
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${id}-erro` : aviso ? `${id}-aviso` : undefined}
          />
          <p className="text-[12px] text-texto-suave">
            Valor alvo de faturamento deste mês. Digite só números — a máscara monta{' '}
            <span className="text-texto">45.000,00</span>.
          </p>
        </div>

        <button
          type="submit"
          disabled={pendente}
          className="inline-flex min-h-11 items-center justify-center rounded-cartao bg-acento px-4 text-sm font-medium text-fundo disabled:opacity-60"
        >
          {pendente ? 'Salvando…' : 'Salvar meta'}
        </button>
      </form>

      {erro ? (
        <p id={`${id}-erro`} role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p id={`${id}-aviso`} className="text-sm text-texto-suave">
          {aviso}
        </p>
      ) : null}

      <p className="border-t border-linha pt-4 text-[13px] text-texto-suave">
        Meta de {nomeDoMesAtual}:{' '}
        <span className="font-serif text-[18px] text-texto">{formatarValorRedondo(salva)}</span>
      </p>
    </Cartao>
  )
}
