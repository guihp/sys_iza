'use client'

import { useOptimistic, useState, useTransition, type DragEvent } from 'react'
import { formatarTelefone } from '@/lib/phone'
import { moverEstagio } from './acoes'
import { agruparPorEstagio, ehEstagio, ESTAGIOS, ROTULOS, type PatientStage } from './estagios'

export type PacienteDoFunil = {
  id: string
  nome_completo: string
  telefone: string | null
  lead_source: string | null
  stage: PatientStage
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
    <div className="space-y-4">
      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}

      {/* Rolagem horizontal: sete colunas não cabem em tela de notebook. */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {ESTAGIOS.map((estagio) => (
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
            className={`flex w-64 shrink-0 flex-col rounded-xl border p-3 transition-colors ${
              alvo === estagio ? 'border-acento bg-superficie' : 'border-linha'
            }`}
          >
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="font-serif text-sm">{ROTULOS[estagio]}</h2>
              <span className="text-xs text-texto/50">{colunas[estagio].length}</span>
            </header>

            <ul className="space-y-2">
              {colunas[estagio].length === 0 && (
                <li className="rounded-lg border border-dashed border-linha px-3 py-6 text-center text-xs text-texto/50">
                  Nenhum paciente neste estágio
                </li>
              )}

              {colunas[estagio].map((paciente) => (
                <Cartao key={paciente.id} paciente={paciente} aoMover={mover} />
              ))}
            </ul>
          </section>
        ))}
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
  return (
    <li
      draggable
      onDragStart={(evento) => {
        evento.dataTransfer.setData(TIPO_ARRASTO, paciente.id)
        evento.dataTransfer.effectAllowed = 'move'
      }}
      className="cursor-grab rounded-lg border border-linha bg-superficie p-3 active:cursor-grabbing"
    >
      <p className="text-sm">{paciente.nome_completo}</p>
      <p className="text-xs text-texto/60">{formatarTelefone(paciente.telefone)}</p>
      {paciente.lead_source && (
        <p className="mt-1 text-xs text-texto/50">Veio de: {paciente.lead_source}</p>
      )}

      {/*
        Arrastar não é a única forma de mover. A HTML Drag and Drop API não
        funciona em toque — no celular e no tablet o cartão simplesmente não sai
        do lugar — e não é operável por teclado. Este select é o caminho que
        sempre funciona; o arrasto é o atalho.
      */}
      <label className="mt-2 block">
        <span className="sr-only">Mover {paciente.nome_completo} para</span>
        <select
          value={paciente.stage}
          onChange={(evento) => {
            const escolhido = evento.target.value
            if (ehEstagio(escolhido)) aoMover(paciente.id, escolhido)
          }}
          className="w-full rounded-md border border-linha bg-transparent px-2 py-1 text-xs"
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
