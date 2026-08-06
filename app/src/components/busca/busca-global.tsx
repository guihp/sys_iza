'use client'

import Link from 'next/link'
import { useId, useRef, useState, useTransition, type FocusEvent } from 'react'
import { formatarPreco } from '@/app/(app)/configuracoes/procedimentos/formatacao'
import { formatarTelefone } from '@/lib/phone'
import { Avatar, RotuloMiudo } from '@/components/ui'
import { buscarGlobal } from './acoes'
import { MINIMO_DE_CARACTERES, type ResultadoDaBusca } from './consulta'

/** Espera entre a última tecla e a consulta. Curto o bastante para parecer vivo. */
const ESPERA_MS = 250

const VAZIO: ResultadoDaBusca = { termo: '', pacientes: [], procedimentos: [] }

/**
 * Busca global da barra superior.
 *
 * Procura em três frentes: nome de paciente, telefone de paciente e nome de
 * procedimento. O telefone é o caso que dá trabalho — o cadastro guarda E.164
 * (`+5511987654321`) e a secretária digita `(11) 98765-4321`. Os dois lados são
 * normalizados em `interpretarBusca`, então as duas grafias acham a mesma
 * pessoa, e um pedaço do número (`98765`) também acha.
 *
 * O resultado sai num painel flutuante abaixo do campo, agrupado por tipo. Sem
 * resultado, o painel diz o que foi procurado em vez de sumir — com o banco
 * vazio, esse é o estado normal da tela, e sumir pareceria defeito.
 */
export function BuscaGlobal() {
  const idDoPainel = useId()
  const [termo, setTermo] = useState('')
  const [resultado, setResultado] = useState<ResultadoDaBusca>(VAZIO)
  const [aberto, setAberto] = useState(false)
  const [pendente, iniciarBusca] = useTransition()

  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Contador de requisições. Digitar rápido dispara várias buscas, e elas não
   * voltam necessariamente na ordem em que saíram: sem este selo, a resposta de
   * "ma" chegando depois da de "maria" repintaria o painel com o resultado
   * antigo.
   */
  const rodada = useRef(0)

  function digitar(valor: string) {
    setTermo(valor)
    setAberto(true)
    if (temporizador.current) clearTimeout(temporizador.current)

    if (valor.trim().length < MINIMO_DE_CARACTERES) {
      rodada.current += 1
      setResultado(VAZIO)
      return
    }

    temporizador.current = setTimeout(() => {
      rodada.current += 1
      const minha = rodada.current
      iniciarBusca(async () => {
        const resposta = await buscarGlobal(valor)
        if (rodada.current === minha) setResultado(resposta)
      })
    }, ESPERA_MS)
  }

  function fechar() {
    setAberto(false)
  }

  /**
   * Fecha ao sair do bloco inteiro, e não ao sair do campo: o painel tem links,
   * e um `onBlur` no `<input>` fecharia o painel antes do clique chegar ao link.
   * `relatedTarget` nulo (clique fora da janela, por exemplo) também fecha.
   */
  function sairDoBloco(evento: FocusEvent<HTMLDivElement>) {
    if (!evento.currentTarget.contains(evento.relatedTarget)) fechar()
  }

  const buscou = termo.trim().length >= MINIMO_DE_CARACTERES && resultado.termo === termo.trim()
  const semResultado =
    buscou && resultado.pacientes.length === 0 && resultado.procedimentos.length === 0

  return (
    <div className="relative" onBlur={sairDoBloco} role="search">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 size-3 -translate-y-1/2 rounded-full border border-texto-suave"
      />
      <input
        type="search"
        value={termo}
        onChange={(evento) => digitar(evento.target.value)}
        onFocus={() => setAberto(true)}
        onKeyDown={(evento) => {
          if (evento.key === 'Escape') fechar()
        }}
        placeholder="Buscar paciente, telefone ou procedimento"
        aria-label="Buscar paciente, telefone ou procedimento"
        aria-expanded={aberto}
        aria-controls={idDoPainel}
        className="w-[290px] max-w-full rounded-full border border-linha bg-superficie py-2.5 pl-10 pr-4 text-[13px] placeholder:text-texto-suave [&::-webkit-search-cancel-button]:appearance-none"
      />

      {aberto && termo.trim().length >= MINIMO_DE_CARACTERES ? (
        <div
          id={idDoPainel}
          aria-live="polite"
          className="absolute left-0 top-[calc(100%+8px)] z-30 w-[360px] max-w-[90vw] overflow-hidden rounded-cartao border border-linha bg-superficie"
        >
          {semResultado ? (
            <p className="px-4 py-5 text-[13px] text-texto-suave">
              Nada encontrado para “{resultado.termo}”.
            </p>
          ) : !buscou ? (
            <p className="px-4 py-5 text-[13px] text-texto-suave">
              {pendente ? 'Procurando…' : 'Digite para procurar.'}
            </p>
          ) : (
            <>
              {resultado.pacientes.length > 0 ? (
                <section className="border-b border-linha last:border-b-0">
                  <RotuloMiudo className="block px-4 pb-1 pt-3">Pacientes</RotuloMiudo>
                  <ul>
                    {resultado.pacientes.map((paciente) => (
                      <li key={paciente.id}>
                        <Link
                          href={`/pacientes/${paciente.id}`}
                          onClick={fechar}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-superficie-2"
                        >
                          <Avatar nome={paciente.nome} />
                          <span className="min-w-0">
                            <span className="block truncate font-serif text-[15px]">
                              {paciente.nome}
                            </span>
                            <span className="block text-[11px] text-texto-suave">
                              {formatarTelefone(paciente.telefone)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {resultado.procedimentos.length > 0 ? (
                <section>
                  <RotuloMiudo className="block px-4 pb-1 pt-3">Procedimentos</RotuloMiudo>
                  <ul className="pb-2">
                    {resultado.procedimentos.map((procedimento) => (
                      <li key={procedimento.id} className="px-4 py-2">
                        <span className="block font-serif text-[15px]">{procedimento.nome}</span>
                        <span className="block text-[11px] text-texto-suave">
                          {procedimento.duracaoMinutos} min ·{' '}
                          {formatarPreco(procedimento.precoCentavos)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
