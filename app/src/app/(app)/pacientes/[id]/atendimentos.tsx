'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatarMoeda } from '@/app/(app)/marketing/formatacao'
import {
  dataDaClinica,
  formatarDataCurta,
  formatarDataExtensaComAno,
} from '@/lib/datetime'
import { EstadoVazio } from '@/components/ui'
import { BOTAO_PRINCIPAL } from '../campos'
import {
  rotuloStatusExecucao,
  textoResumoCobranca,
} from './atendimento-lista'
import type { AtendimentoCompleto } from './atendimento-tipos'
import {
  RegistrarAtendimento,
  type OpcaoDeConsulta,
  type OpcaoDeProcedimento,
  type PlanoBotoxOpcao,
  type PlanoFillerOpcao,
} from './registrar-atendimento'

/**
 * Aba Atendimentos: galeria de registros + editor (criar / abrir).
 * Mesmo padrão de Planos (`visao: galeria | editor`).
 */
export function FormularioAtendimentos({
  pacienteId,
  atendimentos,
  hojeISO,
  procedimentos,
  consultas,
  planosBotox,
  planosFiller,
  somenteLeitura,
  erroCarregar,
}: {
  pacienteId: string
  atendimentos: AtendimentoCompleto[]
  hojeISO: string
  procedimentos: OpcaoDeProcedimento[]
  consultas: OpcaoDeConsulta[]
  planosBotox: PlanoBotoxOpcao[]
  planosFiller: PlanoFillerOpcao[]
  somenteLeitura: boolean
  erroCarregar?: boolean
}) {
  const router = useRouter()
  const [visao, setVisao] = useState<'galeria' | 'editor'>('galeria')
  const [selecionado, setSelecionado] = useState<AtendimentoCompleto | null>(null)

  function abrirNovo() {
    setSelecionado(null)
    setVisao('editor')
  }

  function abrirExistente(atendimento: AtendimentoCompleto) {
    setSelecionado(atendimento)
    setVisao('editor')
  }

  function voltarGaleria() {
    setVisao('galeria')
    setSelecionado(null)
    router.refresh()
  }

  if (visao === 'editor') {
    return (
      <RegistrarAtendimento
        pacienteId={pacienteId}
        hojeISO={hojeISO}
        procedimentos={procedimentos}
        consultas={consultas}
        planosBotox={planosBotox}
        planosFiller={planosFiller}
        atendimentoInicial={selecionado}
        somenteLeitura={somenteLeitura}
        onVoltar={voltarGaleria}
        onSalvo={voltarGaleria}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg">Atendimentos</h2>
          <p className="text-sm text-texto/60">
            Histórico do que foi feito, execução do plano e pagamento
          </p>
        </div>
        {!somenteLeitura ? (
          <button type="button" className={BOTAO_PRINCIPAL} onClick={abrirNovo}>
            Novo atendimento
          </button>
        ) : (
          <p className="text-xs text-texto/50">Somente leitura</p>
        )}
      </div>

      {erroCarregar ? (
        <p role="alert" className="text-sm text-red-600">
          Não foi possível carregar os atendimentos. Tente recarregar a página.
        </p>
      ) : atendimentos.length === 0 ? (
        <EstadoVazio
          mensagem="Nenhum atendimento ainda"
          explicacao={
            somenteLeitura
              ? 'A Dra. registra os atendimentos nesta aba. Aqui você consulta o histórico.'
              : 'Registre o que foi feito hoje, o retorno e a cobrança, se houver.'
          }
          acao={
            !somenteLeitura ? (
              <button type="button" className={BOTAO_PRINCIPAL} onClick={abrirNovo}>
                Novo atendimento
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {atendimentos.map((atendimento) => {
            const realizado = formatarDataCurta(
              dataDaClinica(new Date(atendimento.realizado_em)),
            )
            const execRotulo = rotuloStatusExecucao(atendimento.execucao_status)
            const pagTexto = textoResumoCobranca(atendimento.cobranca, formatarMoeda)
            const retornoTexto = atendimento.retorno_vencimento
              ? `Retorno ${formatarDataExtensaComAno(atendimento.retorno_vencimento)}`
              : atendimento.sem_retorno
                ? 'Sem retorno'
                : 'Retorno não previsto'

            return (
              <li key={atendimento.id}>
                <button
                  type="button"
                  onClick={() => abrirExistente(atendimento)}
                  className="w-full rounded-xl border border-linha p-4 text-left transition hover:border-acento"
                >
                  <p className="text-sm font-medium">
                    {atendimento.procedures?.nome ?? 'Procedimento removido'}
                  </p>
                  <p className="mt-1 text-xs text-texto/60">{realizado}</p>
                  {execRotulo ? (
                    <p className="mt-2">
                      <span
                        className={
                          atendimento.execucao_status === 'completo'
                            ? 'rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300'
                            : 'rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-300'
                        }
                      >
                        {execRotulo}
                      </span>
                    </p>
                  ) : null}
                  {pagTexto ? (
                    <p className="mt-2 text-xs text-texto/70">{pagTexto}</p>
                  ) : (
                    <p className="mt-2 text-xs text-texto/50">Sem cobrança registrada</p>
                  )}
                  <p className="mt-2 text-xs text-texto/50">{retornoTexto}</p>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {somenteLeitura && atendimentos.length > 0 ? (
        <p className="text-xs text-texto/50">
          O prontuário é registrado somente pela Dra. Abra um card para consultar.
        </p>
      ) : null}
    </div>
  )
}
