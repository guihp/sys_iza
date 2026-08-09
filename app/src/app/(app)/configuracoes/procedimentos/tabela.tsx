'use client'

import { useState, useTransition, type FormEvent } from 'react'
import {
  Cartao,
  EstadoVazio,
  Pilula,
  RotuloMiudo,
  Tabela,
  TabelaCabecalho,
  TabelaCelula,
  TabelaColuna,
  TabelaCorpo,
  TabelaLinha,
} from '@/components/ui'
import { desativarProcedimento, salvarProcedimento } from './acoes'
import {
  descreverRetorno,
  formatarDuracao,
  formatarPreco,
  mascararMoedaAoDigitar,
  precoParaCampo,
  reaisParaCentavos,
} from './formatacao'

export type Procedimento = {
  id: string
  nome: string
  duracao_minutos: number
  preco_centavos: number
  default_return_interval_days: number | null
  /** Opcional até a migration `0009_procedures_categoria.sql` ser aplicada. */
  categoria?: string | null
}

const CAMPO =
  'w-full rounded-[12px] border border-linha bg-transparent px-3 py-2 text-sm text-texto outline-none focus:border-acento'

/**
 * Tabela do catálogo clínico — dentro de um cartão, com rodapé de criação.
 *
 * `emEdicao`: `null` ninguém; id de um procedimento; `'novo'` formulário de
 * cadastro no rodapé. A autorização de verdade está na Server Action / RLS;
 * `podeEditar` só esconde os controles da secretária.
 */
export function TabelaDeProcedimentos({
  procedimentos,
  podeEditar,
}: {
  procedimentos: Procedimento[]
  podeEditar: boolean
}) {
  const [emEdicao, setEmEdicao] = useState<string | null>(null)

  return (
    <Cartao className="overflow-hidden">
      {procedimentos.length === 0 && emEdicao !== 'novo' ? (
        <EstadoVazio
          mensagem="Nenhum procedimento ativo no catálogo."
          explicacao="Cadastre o primeiro para ele aparecer no funil e na agenda."
        />
      ) : procedimentos.length > 0 ? (
        <div className="px-4">
          <Tabela>
            <caption className="sr-only">
              Procedimentos ativos, com duração, preço e intervalo de retorno padrão
            </caption>
            <TabelaCabecalho>
              <TabelaLinha>
                <TabelaColuna>Procedimento</TabelaColuna>
                <TabelaColuna>Duração</TabelaColuna>
                <TabelaColuna>Preço</TabelaColuna>
                <TabelaColuna>Retorno</TabelaColuna>
                {podeEditar ? (
                  <TabelaColuna>
                    <span className="sr-only">Ações</span>
                  </TabelaColuna>
                ) : null}
              </TabelaLinha>
            </TabelaCabecalho>
            <TabelaCorpo>
              {procedimentos.map((procedimento) =>
                emEdicao === procedimento.id ? (
                  <TabelaLinha key={procedimento.id}>
                    <TabelaCelula colSpan={podeEditar ? 5 : 4} className="py-5">
                      <Formulario
                        procedimento={procedimento}
                        aoFechar={() => setEmEdicao(null)}
                      />
                    </TabelaCelula>
                  </TabelaLinha>
                ) : (
                  <LinhaDeProcedimento
                    key={procedimento.id}
                    procedimento={procedimento}
                    podeEditar={podeEditar}
                    aoEditar={() => setEmEdicao(procedimento.id)}
                  />
                ),
              )}
            </TabelaCorpo>
          </Tabela>
        </div>
      ) : null}

      {podeEditar ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-linha px-4 py-4">
          {emEdicao === 'novo' ? (
            <div className="w-full space-y-4">
              <p className="font-serif text-[17px]">Novo procedimento</p>
              <Formulario aoFechar={() => setEmEdicao(null)} />
            </div>
          ) : (
            <>
              <p className="text-[12px] text-texto-suave">
                Novos procedimentos aparecem no funil e na agenda imediatamente.
              </p>
              <Pilula variante="solida" onClick={() => setEmEdicao('novo')}>
                Novo procedimento
              </Pilula>
            </>
          )}
        </div>
      ) : null}
    </Cartao>
  )
}

function LinhaDeProcedimento({
  procedimento,
  podeEditar,
  aoEditar,
}: {
  procedimento: Procedimento
  podeEditar: boolean
  aoEditar: () => void
}) {
  const temRetorno = procedimento.default_return_interval_days != null
  const categoria = procedimento.categoria?.trim()

  return (
    <TabelaLinha>
      <TabelaCelula>
        <p className="font-serif text-[17px] leading-tight">{procedimento.nome}</p>
        {categoria ? (
          <p className="mt-0.5">
            <RotuloMiudo>{categoria}</RotuloMiudo>
          </p>
        ) : null}
      </TabelaCelula>

      <TabelaCelula>
        <p className="text-[13px] text-texto-suave">
          {formatarDuracao(procedimento.duracao_minutos)}
        </p>
      </TabelaCelula>

      <TabelaCelula>
        <p className="text-[13px] text-texto-suave">
          {formatarPreco(procedimento.preco_centavos)}
        </p>
      </TabelaCelula>

      <TabelaCelula>
        <p
          className={
            temRetorno
              ? 'flex items-center gap-2 text-[13px] text-texto'
              : 'flex items-center gap-2 text-[13px] text-texto-suave'
          }
        >
          <span
            aria-hidden="true"
            className={
              temRetorno
                ? 'size-1.5 shrink-0 rounded-full bg-acento'
                : 'size-1.5 shrink-0 rounded-full bg-texto-suave/40'
            }
          />
          {descreverRetorno(procedimento.default_return_interval_days)}
        </p>
      </TabelaCelula>

      {podeEditar ? (
        <TabelaCelula>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Pilula variante="contorno" onClick={aoEditar}>
              Editar
            </Pilula>
            <BotaoDesativar procedimento={procedimento} />
          </div>
        </TabelaCelula>
      ) : null}
    </TabelaLinha>
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
  const [preco, setPreco] = useState(
    procedimento ? precoParaCampo(procedimento.preco_centavos) : '',
  )

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // Ler o FormData antes da transição: o formulário some assim que fecha.
    const campos = new FormData(evento.currentTarget)

    const precoCentavos = reaisParaCentavos(preco)
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
        <label className="block space-y-1.5 lg:col-span-2">
          <RotuloMiudo>Nome</RotuloMiudo>
          <input
            name="nome"
            required
            minLength={2}
            defaultValue={procedimento?.nome ?? ''}
            className={CAMPO}
          />
        </label>

        <label className="block space-y-1.5">
          <RotuloMiudo>Duração (minutos)</RotuloMiudo>
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

        <label className="block space-y-1.5">
          <RotuloMiudo>Preço (R$)</RotuloMiudo>
          <input
            name="preco"
            inputMode="decimal"
            required
            value={preco}
            onChange={(evento) => setPreco(mascararMoedaAoDigitar(evento.target.value))}
            placeholder="1.800,00"
            className={CAMPO}
          />
        </label>

        <label className="block space-y-1.5 lg:col-span-2">
          <RotuloMiudo>Retorno padrão (dias)</RotuloMiudo>
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

      {erro ? (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Pilula type="submit" variante="solida" disabled={pendente}>
          {pendente ? 'Salvando…' : 'Salvar'}
        </Pilula>
        <Pilula variante="contorno" onClick={aoFechar} disabled={pendente}>
          Cancelar
        </Pilula>
      </div>
    </form>
  )
}

function BotaoDesativar({ procedimento }: { procedimento: Procedimento }) {
  const [pendente, iniciarTransicao] = useTransition()
  const [erro, setErro] = useState(false)

  return (
    <Pilula
      variante="contorno"
      disabled={pendente}
      title={`Tirar ${procedimento.nome} do catálogo`}
      onClick={() =>
        iniciarTransicao(async () => {
          try {
            await desativarProcedimento(procedimento.id)
          } catch {
            setErro(true)
          }
        })
      }
    >
      {erro ? 'Erro ao desativar' : pendente ? 'Desativando…' : 'Desativar'}
    </Pilula>
  )
}
