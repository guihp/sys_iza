'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { desativarProcedimento, salvarProcedimento } from './acoes'
import {
  descreverRetorno,
  formatarPreco,
  precoParaCampo,
  reaisParaCentavos,
} from './formatacao'

export type Procedimento = {
  id: string
  nome: string
  duracao_minutos: number
  preco_centavos: number
  default_return_interval_days: number | null
}

const CAMPO = 'w-full rounded-lg border border-linha bg-transparent px-3 py-2 text-sm'
const BOTAO_PRINCIPAL = 'rounded-lg bg-acento px-4 py-2 text-sm text-white disabled:opacity-60'
const BOTAO_DISCRETO = 'rounded-lg border border-linha px-3 py-1.5 text-sm hover:bg-superficie'

export function TabelaDeProcedimentos({
  procedimentos,
  podeEditar,
}: {
  procedimentos: Procedimento[]
  podeEditar: boolean
}) {
  /** `null` = ninguém em edição; `'novo'` = formulário de cadastro aberto. */
  const [emEdicao, setEmEdicao] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Procedimentos ativos, com duração, preço e intervalo de retorno padrão
        </caption>
        <thead>
          <tr className="border-b border-linha text-left text-xs uppercase tracking-wide text-texto/50">
            <th scope="col" className="py-2 pr-4 font-normal">
              Procedimento
            </th>
            <th scope="col" className="py-2 pr-4 font-normal">
              Duração
            </th>
            <th scope="col" className="py-2 pr-4 font-normal">
              Preço
            </th>
            <th scope="col" className="py-2 pr-4 font-normal">
              Retorno
            </th>
            {podeEditar && (
              <th scope="col" className="py-2 font-normal">
                <span className="sr-only">Ações</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {procedimentos.length === 0 && (
            <tr>
              <td colSpan={podeEditar ? 5 : 4} className="py-6 text-texto/60">
                Nenhum procedimento ativo no catálogo.
              </td>
            </tr>
          )}

          {procedimentos.map((procedimento) =>
            emEdicao === procedimento.id ? (
              <tr key={procedimento.id} className="border-b border-linha">
                <td colSpan={5} className="py-4">
                  <Formulario
                    procedimento={procedimento}
                    aoFechar={() => setEmEdicao(null)}
                  />
                </td>
              </tr>
            ) : (
              <tr key={procedimento.id} className="border-b border-linha">
                <td className="py-3 pr-4">{procedimento.nome}</td>
                <td className="py-3 pr-4 text-texto/70">{procedimento.duracao_minutos} min</td>
                <td className="py-3 pr-4 text-texto/70">
                  {formatarPreco(procedimento.preco_centavos)}
                </td>
                <td className="py-3 pr-4 text-texto/70">
                  {descreverRetorno(procedimento.default_return_interval_days)}
                </td>
                {podeEditar && (
                  <td className="py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className={BOTAO_DISCRETO}
                        onClick={() => setEmEdicao(procedimento.id)}
                      >
                        Editar
                      </button>
                      <BotaoDesativar procedimento={procedimento} />
                    </div>
                  </td>
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>

      {podeEditar &&
        (emEdicao === 'novo' ? (
          <div className="rounded-xl border border-linha p-4">
            <h2 className="mb-4 font-serif text-lg">Novo procedimento</h2>
            <Formulario aoFechar={() => setEmEdicao(null)} />
          </div>
        ) : (
          <button type="button" className={BOTAO_PRINCIPAL} onClick={() => setEmEdicao('novo')}>
            Novo procedimento
          </button>
        ))}
    </div>
  )
}

function Formulario({
  procedimento,
  aoFechar,
}: {
  procedimento?: Procedimento
  aoFechar: () => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciarTransicao] = useTransition()

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // Ler o FormData antes da transição: o formulário some assim que fecha.
    const campos = new FormData(evento.currentTarget)

    const precoCentavos = reaisParaCentavos(String(campos.get('preco') ?? ''))
    if (precoCentavos === null) {
      setErro('Informe um preço válido, por exemplo 1.800,00. Use 0 para cortesia.')
      return
    }

    const retorno = String(campos.get('retorno') ?? '').trim()
    setErro(null)

    iniciarTransicao(async () => {
      try {
        await salvarProcedimento({
          id: procedimento?.id,
          nome: String(campos.get('nome') ?? ''),
          duracaoMinutos: Number(campos.get('duracao')),
          precoCentavos,
          // Campo vazio significa "não gera retorno" — vira null, nunca 0.
          retornoDias: retorno === '' ? null : Number(retorno),
        })
        aoFechar()
      } catch {
        // A mensagem do servidor pode carregar detalhe de banco; não vai à tela.
        setErro('Não foi possível salvar. Confira os campos e tente de novo.')
      }
    })
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block space-y-1 lg:col-span-2">
          <span className="text-sm text-texto/80">Nome</span>
          <input
            name="nome"
            required
            minLength={2}
            defaultValue={procedimento?.nome ?? ''}
            className={CAMPO}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Duração (minutos)</span>
          <input
            name="duracao"
            type="number"
            required
            min={5}
            max={480}
            step={5}
            defaultValue={procedimento?.duracao_minutos ?? 60}
            className={CAMPO}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Preço (R$)</span>
          <input
            name="preco"
            inputMode="decimal"
            required
            defaultValue={procedimento ? precoParaCampo(procedimento.preco_centavos) : ''}
            placeholder="1.800,00"
            className={CAMPO}
          />
        </label>

        <label className="block space-y-1 lg:col-span-2">
          <span className="text-sm text-texto/80">Retorno padrão (dias)</span>
          <input
            name="retorno"
            type="number"
            min={1}
            defaultValue={procedimento?.default_return_interval_days ?? ''}
            placeholder="Deixe vazio para não gerar retorno"
            className={CAMPO}
          />
        </label>
      </div>

      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pendente} className={BOTAO_PRINCIPAL}>
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={aoFechar} disabled={pendente} className={BOTAO_DISCRETO}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function BotaoDesativar({ procedimento }: { procedimento: Procedimento }) {
  const [pendente, iniciarTransicao] = useTransition()
  const [erro, setErro] = useState(false)

  return (
    <button
      type="button"
      disabled={pendente}
      className={BOTAO_DISCRETO}
      onClick={() =>
        iniciarTransicao(async () => {
          try {
            await desativarProcedimento(procedimento.id)
          } catch {
            setErro(true)
          }
        })
      }
      title={`Tirar ${procedimento.nome} do catálogo`}
    >
      {erro ? 'Erro ao desativar' : pendente ? 'Desativando…' : 'Desativar'}
    </button>
  )
}
