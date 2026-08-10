'use client'

import Link from 'next/link'
import { useOptimistic, useState, useTransition, type DragEvent } from 'react'
import { Avatar } from '@/components/ui'
import { formatarTempoRelativo } from '@/lib/datetime'
import { moverEstagio } from './acoes'
import { agruparPorEstagio, ehEstagio, ESTAGIOS, ROTULOS, type PatientStage } from './estagios'
import { textoPotencialDaColuna, textoPrecoDoCartao } from './metricas'

export type PacienteDoFunil = {
  id: string
  nome_completo: string
  telefone: string | null
  lead_source: string | null
  stage: PatientStage
  criado_em?: string | null
  /** Centavos do procedimento de interesse (catálogo). */
  potencial_centavos?: number | null
  procedimento_interesse?: string | null
}

const TIPO_ARRASTO = 'text/plain'

export function Kanban({ pacientes }: { pacientes: PacienteDoFunil[] }) {
  /**
   * `useOptimistic` em vez de um `useState` espelhando props: o cartão pula de
   * coluna na hora e, quando a transição termina, o estado volta a ser o do
   * servidor. Se a Server Action falhar, essa volta é justamente o desfazer —
   * sem código de rollback para manter em dia.
   */
  const [otimistas, aplicarMovimento] = useOptimistic(
    pacientes,
    (atual, movimento: { id: string; estagio: PatientStage }) =>
      atual.map((p) => (p.id === movimento.id ? { ...p, stage: movimento.estagio } : p)),
  )
  const [, iniciarTransicao] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  /** Coluna sob o cursor durante o arrasto (só desktop), só para o destaque. */
  const [alvo, setAlvo] = useState<PatientStage | null>(null)
  /**
   * Abaixo de `lg` o board de 7 colunas vira abas: uma coluna por vez no
   * telefone; no tablet a mesma UX (mais legível que 2×282px apertados).
   */
  const [aba, setAba] = useState<PatientStage>('lead')

  const colunas = agruparPorEstagio(otimistas)

  function mover(id: string, estagio: PatientStage) {
    const paciente = otimistas.find((p) => p.id === id)
    if (!paciente || paciente.stage === estagio) return

    setErro(null)
    iniciarTransicao(async () => {
      const origem = paciente.stage
      aplicarMovimento({ id, estagio })
      // No mobile, ao mudar estágio pelo select o cartão some da aba atual —
      // acompanhar a paciente na coluna nova evita a sensação de "sumiu".
      setAba(estagio)
      try {
        await moverEstagio(id, estagio)
      } catch {
        setAba(origem)
        // A mensagem do servidor pode carregar detalhe de banco; não vai à tela.
        setErro(
          `Não foi possível mover ${paciente.nome_completo}. O cartão voltou para a coluna anterior.`,
        )
      }
    })
  }

  function soltar(evento: DragEvent<HTMLElement>, estagio: PatientStage) {
    evento.preventDefault()
    setAlvo(null)
    const id = evento.dataTransfer.getData(TIPO_ARRASTO)
    if (id) mover(id, estagio)
  }

  return (
    <div className="flex h-0 min-h-0 min-w-0 flex-1 flex-col gap-3 sm:gap-4">
      {erro && (
        <p role="alert" className="shrink-0 text-sm text-red-600">
          {erro}
        </p>
      )}

      {/* Telefone / tablet: pills de estágio — uma coluna por vez. */}
      <div className="min-w-0 shrink-0 lg:hidden">
        <div
          role="tablist"
          aria-label="Estágios do funil"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {ESTAGIOS.map((estagio) => {
            const ativa = aba === estagio
            const qtd = colunas[estagio].length
            return (
              <button
                key={estagio}
                type="button"
                role="tab"
                aria-selected={ativa}
                onClick={() => setAba(estagio)}
                className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[12.5px] tracking-[0.02em] transition-colors ${
                  ativa
                    ? 'border-acento bg-acento/10 text-texto'
                    : 'border-linha-2 bg-superficie-2 text-texto-suave'
                }`}
              >
                <span className="whitespace-nowrap">{ROTULOS[estagio]}</span>
                <span
                  className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] ${
                    ativa ? 'bg-acento/20 text-texto' : 'bg-linha-2 text-texto-mudo'
                  }`}
                >
                  {qtd}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Mobile: coluna única da aba ativa. */}
      <div className="flex h-0 min-h-0 min-w-0 flex-1 flex-col lg:hidden">
        <Coluna
          estagio={aba}
          lista={colunas[aba]}
          alvo={null}
          aoMover={mover}
          aoSoltar={soltar}
          aoArrastarSobre={() => {}}
          aoSairArrasto={() => {}}
          larga
        />
      </div>

      {/*
        Desktop `lg+`: largura confortável por coluna (`min-w-[280px]`); se não
        cabem as 7, scroll horizontal só neste board (shell `fixed` trava a página).
      */}
      <div className="hidden h-0 min-h-0 min-w-0 flex-1 items-stretch gap-3 overflow-x-auto pb-1 lg:flex">
        {ESTAGIOS.map((estagio) => (
          <Coluna
            key={estagio}
            estagio={estagio}
            lista={colunas[estagio]}
            alvo={alvo}
            aoMover={mover}
            aoSoltar={soltar}
            aoArrastarSobre={() => setAlvo(estagio)}
            aoSairArrasto={() => setAlvo((atual) => (atual === estagio ? null : atual))}
          />
        ))}
      </div>
    </div>
  )
}

function Coluna({
  estagio,
  lista,
  alvo,
  aoMover,
  aoSoltar,
  aoArrastarSobre,
  aoSairArrasto,
  larga = false,
}: {
  estagio: PatientStage
  lista: PacienteDoFunil[]
  alvo: PatientStage | null
  aoMover: (id: string, estagio: PatientStage) => void
  aoSoltar: (evento: DragEvent<HTMLElement>, estagio: PatientStage) => void
  aoArrastarSobre: () => void
  aoSairArrasto: () => void
  larga?: boolean
}) {
  return (
    <section
      aria-label={ROTULOS[estagio]}
      onDragOver={(evento) => {
        // Sem preventDefault no dragover o navegador não aceita o drop.
        evento.preventDefault()
        aoArrastarSobre()
      }}
      onDragLeave={aoSairArrasto}
      onDrop={(evento) => aoSoltar(evento, estagio)}
      className={`flex min-h-0 flex-col gap-3 rounded-2xl border bg-superficie p-3 shadow-[var(--shadow-painel)] transition-[border-color,box-shadow] sm:p-4 ${
        larga
          ? 'h-full w-full min-w-0'
          : 'h-full w-[280px] shrink-0'
      } ${alvo === estagio ? 'border-acento' : 'border-linha'}`}
    >
      <header className="flex shrink-0 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2.5">
          <h2 className="flex min-w-0 items-center gap-2.5 font-serif text-[17px] tracking-[0.01em] sm:text-[18px]">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-acento" />
            <span className="truncate">{ROTULOS[estagio]}</span>
          </h2>
          <span className="flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-linha-2 px-1.5 text-[11.5px] text-texto-suave">
            {lista.length}
          </span>
        </div>
        <p className="truncate text-[11px] tracking-[0.04em] text-texto-mudo">
          {textoPotencialDaColuna(lista.map((p) => p.potencial_centavos))}
        </p>
      </header>

      <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain">
        {lista.length === 0 && (
          <li className="flex items-center justify-center rounded-[13px] border border-dashed border-linha px-3 py-6 text-center text-[12.5px] text-texto-mudo">
            Nenhum paciente neste estágio
          </li>
        )}

        {lista.map((paciente) => (
          <Cartao key={paciente.id} paciente={paciente} aoMover={aoMover} />
        ))}
      </ul>
    </section>
  )
}

function Cartao({
  paciente,
  aoMover,
}: {
  paciente: PacienteDoFunil
  aoMover: (id: string, estagio: PatientStage) => void
}) {
  const quando = paciente.criado_em
    ? formatarTempoRelativo(new Date(paciente.criado_em))
    : null
  const procedimento = paciente.procedimento_interesse?.trim() || 'A definir'
  const origem = paciente.lead_source?.trim() || 'Sem origem'

  return (
    <li
      draggable
      onDragStart={(evento) => {
        evento.dataTransfer.setData(TIPO_ARRASTO, paciente.id)
        evento.dataTransfer.effectAllowed = 'move'
        evento.currentTarget.style.opacity = '0.45'
      }}
      onDragEnd={(evento) => {
        evento.currentTarget.style.opacity = '1'
      }}
      className="group flex cursor-grab flex-col gap-2.5 rounded-[13px] border border-linha-2 bg-superficie-2 p-3.5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-linha hover:shadow-[0_14px_28px_-18px_rgba(27,24,21,0.4)] active:cursor-grabbing sm:p-3.5"
    >
      {/*
        `draggable={false}` no link: âncora é arrastável por padrão no navegador,
        e o arrasto nativo do link roubaria o do cartão — o paciente pararia de
        trocar de coluna com o mouse.
      */}
      <div className="flex items-center gap-2.5">
        <Avatar nome={paciente.nome_completo} className="font-serif text-[13.5px]" />
        <div className="flex min-w-0 flex-col gap-px">
          <Link
            href={`/pacientes/${paciente.id}`}
            draggable={false}
            className="truncate text-[14px] tracking-[0.005em] hover:underline"
          >
            {paciente.nome_completo}
          </Link>
          <span className="truncate text-[11.5px] text-texto-mudo">{origem}</span>
        </div>
      </div>

      <p className="truncate font-serif text-[15.5px] leading-tight text-texto">{procedimento}</p>

      <div className="flex items-center justify-between gap-2 border-t border-linha-2 pt-2.5">
        <span className="text-[12.5px] tracking-[0.02em] text-texto-suave">
          {textoPrecoDoCartao(paciente.potencial_centavos)}
        </span>
        {quando ? <span className="text-[11px] text-texto-mudo">{quando}</span> : null}
      </div>

      {/*
        Arrastar não é a única forma de mover. A HTML Drag and Drop API não
        funciona em toque — no celular e no tablet o cartão simplesmente não sai
        do lugar — e não é operável por teclado. Este select é o caminho que
        sempre funciona; o arrasto é o atalho.
      */}
      <label className="block">
        <span className="sr-only">Mover {paciente.nome_completo} para</span>
        <select
          value={paciente.stage}
          onChange={(evento) => {
            const escolhido = evento.target.value
            if (ehEstagio(escolhido)) aoMover(paciente.id, escolhido)
          }}
          className="min-h-11 w-full rounded-md border border-linha-2 bg-transparent px-2.5 py-2 text-[12.5px] text-texto-suave sm:min-h-0 sm:py-1 sm:text-[11px] sm:text-texto-mudo"
        >
          {ESTAGIOS.map((estagio) => (
            <option key={estagio} value={estagio}>
              {ROTULOS[estagio]}
            </option>
          ))}
        </select>
      </label>
    </li>
  )
}
