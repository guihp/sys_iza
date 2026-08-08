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
  /** Centavos do procedimento de interesse — ainda sem coluna no banco. */
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
  /** Coluna sob o cursor durante o arrasto, só para o destaque visual. */
  const [alvo, setAlvo] = useState<PatientStage | null>(null)

  const colunas = agruparPorEstagio(otimistas)

  function mover(id: string, estagio: PatientStage) {
    const paciente = otimistas.find((p) => p.id === id)
    if (!paciente || paciente.stage === estagio) return

    setErro(null)
    iniciarTransicao(async () => {
      aplicarMovimento({ id, estagio })
      try {
        await moverEstagio(id, estagio)
      } catch {
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {erro && (
        <p role="alert" className="shrink-0 text-sm text-red-600">
          {erro}
        </p>
      )}

      {/*
        `flex-1 min-h-0` preenche até o rodapé do `<main>`: a barra horizontal
        fica embaixo da tela, não grudada sob as colunas vazias.
      */}
      <div className="flex min-h-0 flex-1 items-stretch gap-4 overflow-x-auto pb-1">
        {ESTAGIOS.map((estagio) => {
          const lista = colunas[estagio]
          return (
            <section
              key={estagio}
              aria-label={ROTULOS[estagio]}
              onDragOver={(evento) => {
                // Sem preventDefault no dragover o navegador não aceita o drop.
                evento.preventDefault()
                setAlvo(estagio)
              }}
              onDragLeave={() => setAlvo((atual) => (atual === estagio ? null : atual))}
              onDrop={(evento) => soltar(evento, estagio)}
              className={`flex h-full min-h-0 w-[282px] shrink-0 flex-col gap-3 rounded-2xl border bg-superficie p-4 shadow-[var(--shadow-painel)] transition-[border-color,box-shadow] ${
                alvo === estagio ? 'border-acento' : 'border-linha'
              }`}
            >
              <header className="flex shrink-0 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2.5">
                  <h2 className="flex items-center gap-2.5 font-serif text-[18px] tracking-[0.01em]">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-acento" />
                    {ROTULOS[estagio]}
                  </h2>
                  <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-linha-2 px-1.5 text-[11.5px] text-texto-suave">
                    {lista.length}
                  </span>
                </div>
                <p className="text-[11px] tracking-[0.04em] text-texto-mudo">
                  {textoPotencialDaColuna(lista.map((p) => p.potencial_centavos))}
                </p>
              </header>

              <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
                {lista.length === 0 && (
                  <li className="flex items-center justify-center rounded-[13px] border border-dashed border-linha px-3 py-6 text-center text-[12.5px] text-texto-mudo">
                    Nenhum paciente neste estágio
                  </li>
                )}

                {lista.map((paciente) => (
                  <Cartao key={paciente.id} paciente={paciente} aoMover={mover} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
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
      className="group flex cursor-grab flex-col gap-2.5 rounded-[13px] border border-linha-2 bg-superficie-2 p-3.5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-linha hover:shadow-[0_14px_28px_-18px_rgba(27,24,21,0.4)] active:cursor-grabbing"
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

      <p className="font-serif text-[15.5px] leading-tight text-texto">{procedimento}</p>

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
          className="w-full rounded-md border border-linha-2 bg-transparent px-2 py-1 text-[11px] text-texto-mudo"
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
