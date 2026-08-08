'use client'

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'
import { Pilula, PilulaLink, RotuloMiudo } from '@/components/ui'
import { faixasDoDia, minutosDeHHMM } from '@/domain/scheduling/working-hours'
import {
  dataDaClinica,
  deslocarData,
  formatarDataExtensa,
  horaDaClinica,
  instanteDaClinica,
} from '@/lib/datetime'
import { agendarConsulta } from './acoes'
import {
  ALTURA_HORA_PX,
  ALTURA_PASSO_PX,
  FAIXAS,
  HORAS_ROTULO,
  PASSO_MINUTOS,
  ROTULOS_DOS_DIAS,
  estiloDoBlocoNaGrade,
  posicionarNaGrade,
  rotuloDoPeriodo,
} from './grade'
import { ROTULOS_DE_STATUS, type StatusDeConsulta } from './status'

export type ConsultaNaAgenda = {
  id: string
  /** Instantes em ISO com `Z`. Datas viram `Date` só aqui, na leitura. */
  inicio: string
  fim: string
  status: StatusDeConsulta
  paciente: string
  procedimento: string
  observacoes: string | null
}

export type OpcaoDePaciente = { id: string; nome: string }
export type OpcaoDeProcedimento = { id: string; nome: string; duracaoMinutos: number }

const CAMPO =
  'w-full rounded-cartao border border-linha bg-superficie px-3 py-2 text-[14px]'

/** A clínica atende nesse dia, nessa faixa de meia hora? */
function faixaAberta(dataISO: string, minutos: number): boolean {
  return faixasDoDia(dataISO).some(
    (faixa) => minutos >= minutosDeHHMM(faixa.de) && minutos < minutosDeHHMM(faixa.ate),
  )
}

function hhmm(minutosDoDia: number): string {
  const hora = Math.floor(minutosDoDia / 60)
  const minuto = minutosDoDia % 60
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
}

/** Horário que o formulário está prestes a marcar. */
type Escolha = { dataISO: string; minutos: number }

/**
 * Primeiro horário livre útil: hoje (se estiver na semana) senão o primeiro
 * dia aberto da grade. Usado pelo botão Nova consulta — a secretária não precisa
 * caçar célula vazia numa semana em branco.
 */
function sugestaoDeHorario(hoje: string, diasDaGrade: string[]): Escolha {
  const ordem = diasDaGrade.includes(hoje)
    ? [hoje, ...diasDaGrade.filter((dia) => dia !== hoje)]
    : diasDaGrade

  for (const dia of ordem) {
    for (const minutos of FAIXAS) {
      if (faixaAberta(dia, minutos)) return { dataISO: dia, minutos }
    }
  }

  return { dataISO: diasDaGrade[0] ?? hoje, minutos: 10 * 60 }
}

export function AgendaSemanal({
  inicioDaSemanaISO,
  dias,
  hoje,
  consultas,
  pacientes,
  procedimentos,
}: {
  inicioDaSemanaISO: string
  dias: string[]
  hoje: string
  consultas: ConsultaNaAgenda[]
  pacientes: OpcaoDePaciente[]
  procedimentos: OpcaoDeProcedimento[]
}) {
  const [escolha, setEscolha] = useState<Escolha | null>(null)

  // Cancelada não entra na grade: ela pode sobrepor uma consulta viva — a
  // constraint do banco libera o horário justamente por estar cancelada — e dois
  // blocos empilhados na mesma célula não informariam nada. Vão para a lista
  // abaixo, onde continuam visíveis sem atrapalhar a leitura da semana.
  const naGrade = consultas.filter((consulta) => consulta.status !== 'cancelado')
  const canceladas = consultas.filter((consulta) => consulta.status === 'cancelado')

  const foraDaGrade: ConsultaNaAgenda[] = []
  const ocupadas = dias.map(() => new Set<number>())
  const blocos = dias.map(
    () =>
      [] as {
        consulta: ConsultaNaAgenda
        topPx: number
        heightPx: number
      }[],
  )

  for (const consulta of naGrade) {
    const intervalo = { inicio: new Date(consulta.inicio), fim: new Date(consulta.fim) }
    const indice = dias.findIndex((dia) => estiloDoBlocoNaGrade(intervalo, dia) !== null)
    if (indice === -1) {
      foraDaGrade.push(consulta)
      continue
    }
    const estilo = estiloDoBlocoNaGrade(intervalo, dias[indice])!
    blocos[indice].push({ consulta, topPx: estilo.topPx, heightPx: estilo.heightPx })

    const posicao = posicionarNaGrade(intervalo, dias[indice])
    if (posicao) {
      for (let n = 0; n < posicao.linhas; n += 1) ocupadas[indice].add(posicao.linhaInicial + n)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 sm:gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <PilulaLink
            href={`/agenda?semana=${deslocarData(inicioDaSemanaISO, -7)}`}
            variante="contorno"
            aria-label="Semana anterior"
            className="min-h-11 bg-superficie px-3 py-2.5 text-[12px] normal-case tracking-normal text-texto-suave sm:px-4 sm:text-[12.5px]"
          >
            <span className="sm:hidden">← Ant.</span>
            <span className="hidden sm:inline">← Semana anterior</span>
          </PilulaLink>
          <PilulaLink
            href="/agenda"
            variante="solida"
            className="min-h-11 px-4 py-2.5 text-[12px] tracking-[0.05em] sm:px-[18px] sm:text-[12.5px]"
          >
            Hoje
          </PilulaLink>
          <PilulaLink
            href={`/agenda?semana=${deslocarData(inicioDaSemanaISO, 7)}`}
            variante="contorno"
            aria-label="Próxima semana"
            className="min-h-11 bg-superficie px-3 py-2.5 text-[12px] normal-case tracking-normal text-texto-suave sm:px-4 sm:text-[12.5px]"
          >
            <span className="sm:hidden">Próx. →</span>
            <span className="hidden sm:inline">Próxima semana →</span>
          </PilulaLink>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <p className="font-serif text-[17px] text-texto-suave sm:text-[19px]">
            {rotuloDoPeriodo(inicioDaSemanaISO)}
          </p>
          <Pilula
            variante="solida"
            className="min-h-11 px-4 py-2.5 text-[12px] tracking-[0.05em] sm:px-[18px] sm:text-[12.5px]"
            onClick={() => setEscolha(sugestaoDeHorario(hoje, dias))}
          >
            Nova consulta
          </Pilula>
        </div>
      </div>

      {escolha && (
        <DialogoDeAgendamento
          escolha={escolha}
          diasDaGrade={dias}
          pacientes={pacientes}
          procedimentos={procedimentos}
          aoFechar={() => setEscolha(null)}
        />
      )}

      {/*
        Painel da grade — Agenda.dc.html: raio 18, sombra, cabeçalho sticky,
        coluna de horas 74px, linha de hora 88px, eventos em absolute.
      */}
      <div className="overflow-hidden rounded-[18px] border border-linha bg-superficie-2 shadow-[var(--shadow-painel)]">
        <div className="max-h-[620px] overflow-auto">
          <div
            className="sticky top-0 z-[2] grid min-w-[998px] border-b border-linha bg-superficie"
            style={{ gridTemplateColumns: '74px repeat(7, minmax(132px, 1fr))' }}
          >
            <div aria-hidden />
            {dias.map((dia, indice) => {
              const ehHoje = dia === hoje
              return (
                <div
                  key={`cabecalho-${dia}`}
                  className={`flex flex-col items-center gap-0.5 border-l border-linha-2 px-1.5 py-3.5 ${
                    ehHoje ? 'bg-acento-suave' : ''
                  }`}
                >
                  <span
                    className={`text-[9.5px] uppercase tracking-[0.2em] ${
                      ehHoje ? 'text-acento' : 'text-texto-suave'
                    }`}
                  >
                    {ROTULOS_DOS_DIAS[indice]}
                  </span>
                  <span
                    className={`font-serif text-[17px] ${
                      ehHoje ? 'text-acento' : 'text-texto-suave'
                    }`}
                  >
                    {formatarDataExtensa(dia)}
                  </span>
                </div>
              )
            })}
          </div>

          <div
            className="grid min-w-[998px]"
            style={{ gridTemplateColumns: '74px repeat(7, minmax(132px, 1fr))' }}
          >
            <div className="flex flex-col" aria-hidden>
              {HORAS_ROTULO.map((hora) => (
                <div
                  key={hora}
                  className="flex justify-end pt-1.5 pr-3 text-[11px] tracking-[0.06em] text-texto-mudo"
                  style={{ height: ALTURA_HORA_PX }}
                >
                  {hhmm(hora * 60)}
                </div>
              ))}
            </div>

            {dias.map((dia, indiceDoDia) => {
              const ehHoje = dia === hoje
              return (
                <div
                  key={`coluna-${dia}`}
                  className="relative border-l border-linha-2"
                >
                  {FAIXAS.map((minutos, linha) => {
                    if (ocupadas[indiceDoDia].has(linha)) {
                      return (
                        <div
                          key={`${dia}-${minutos}`}
                          aria-hidden
                          className="border-t border-linha-2"
                          style={{ height: ALTURA_PASSO_PX }}
                        />
                      )
                    }

                    const aberta = faixaAberta(dia, minutos)
                    if (!aberta) {
                      return (
                        <div
                          key={`${dia}-${minutos}`}
                          aria-hidden
                          className={`border-t border-linha-2 ${
                            ehHoje ? 'bg-acento-suave/40' : 'bg-acento-suave/50'
                          }`}
                          style={{ height: ALTURA_PASSO_PX }}
                        />
                      )
                    }

                    return (
                      <button
                        key={`${dia}-${minutos}`}
                        type="button"
                        onClick={() => setEscolha({ dataISO: dia, minutos })}
                        aria-label={`Marcar consulta em ${formatarDataExtensa(dia)} às ${hhmm(minutos)}`}
                        className="group flex w-full items-center justify-center border-t border-linha-2 text-[11.5px] tracking-[0.06em] text-transparent transition-colors hover:bg-linha-2 hover:text-texto-mudo focus:bg-linha-2 focus:text-texto-mudo focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-acento"
                        style={{ height: ALTURA_PASSO_PX }}
                      >
                        <span className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus:opacity-100">
                          + {hhmm(minutos)}
                        </span>
                      </button>
                    )
                  })}

                  <div className="pointer-events-none absolute inset-0">
                    {blocos[indiceDoDia].map(({ consulta, topPx, heightPx }) => (
                      <article
                        key={consulta.id}
                        style={{ top: topPx, height: heightPx }}
                        className="pointer-events-auto absolute right-[5px] left-[5px] flex cursor-default flex-col gap-0.5 overflow-hidden rounded-[11px] border border-acento bg-acento-suave px-2.5 py-2 transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0_12px_24px_-16px_rgba(27,24,21,0.45)]"
                      >
                        <span className="shrink-0 whitespace-nowrap text-[10px] tracking-[0.08em] text-acento">
                          {horaDaClinica(new Date(consulta.inicio))} –{' '}
                          {horaDaClinica(new Date(consulta.fim))}
                        </span>
                        <span className="shrink-0 truncate text-[13px] leading-tight text-texto">
                          {consulta.paciente}
                        </span>
                        <span className="truncate text-[11px] leading-tight text-texto-suave">
                          {consulta.procedimento}
                        </span>
                      </article>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <LegendaDaGrade />

      {foraDaGrade.length > 0 && (
        <ListaDeConsultas
          titulo="Fora do horário da grade"
          explicacao={`A grade mostra das ${hhmm(FAIXAS[0])} às ${hhmm(FAIXAS.at(-1)! + PASSO_MINUTOS)}. Estas consultas estão fora dessa faixa.`}
          consultas={foraDaGrade}
        />
      )}

      {canceladas.length > 0 && (
        <ListaDeConsultas
          titulo="Cancelamentos da semana"
          explicacao="Horário liberado para outra pessoa. O registro fica no histórico."
          consultas={canceladas}
        />
      )}
    </div>
  )
}

/** Três amostras — Agenda.dc.html no rodapé da grade. */
function LegendaDaGrade() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[12px] text-texto-mudo">
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-[3px] border border-acento bg-acento-suave"
        />
        Atendimento confirmado
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-linha-2" />
        Horário livre
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-acento-suave opacity-50" />
        Fora do expediente
      </li>
    </ul>
  )
}

function ListaDeConsultas({
  titulo,
  explicacao,
  consultas,
}: {
  titulo: string
  explicacao: string
  consultas: ConsultaNaAgenda[]
}) {
  return (
    <section className="rounded-[18px] border border-linha bg-superficie p-4 shadow-[var(--shadow-painel)]">
      <h2 className="font-serif text-[17px]">{titulo}</h2>
      <p className="mb-3 text-[12.5px] text-texto-suave">{explicacao}</p>
      <ul className="space-y-1 text-[13px]">
        {consultas.map((consulta) => (
          <li key={consulta.id} className="break-words text-texto-suave">
            {/* A data sai de `dataDaClinica`, não dos dez primeiros caracteres
                do ISO: uma consulta às 21:00 de Brasília já é o dia seguinte em
                UTC, e a lista mostraria a data errada. */}
            {formatarDataExtensa(dataDaClinica(new Date(consulta.inicio)))} ·{' '}
            {horaDaClinica(new Date(consulta.inicio))} · {consulta.paciente} ·{' '}
            {consulta.procedimento} · {ROTULOS_DE_STATUS[consulta.status]}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DialogoDeAgendamento({
  escolha: escolhaInicial,
  diasDaGrade,
  pacientes,
  procedimentos,
  aoFechar,
}: {
  escolha: Escolha
  diasDaGrade: string[]
  pacientes: OpcaoDePaciente[]
  procedimentos: OpcaoDeProcedimento[]
  aoFechar: () => void
}) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const [dataISO, setDataISO] = useState(escolhaInicial.dataISO)
  const [minutos, setMinutos] = useState(escolhaInicial.minutos)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciarTransicao] = useTransition()

  const semCadastro = pacientes.length === 0 || procedimentos.length === 0
  const horariosDoDia = FAIXAS.filter((faixa) => faixaAberta(dataISO, faixa))

  useEffect(() => {
    const el = dialogo.current
    if (!el) return
    if (!el.open) el.showModal()
  }, [])

  // Se o dia mudou e o horário atual não abre nele, cai no primeiro livre.
  useEffect(() => {
    const livres = FAIXAS.filter((faixa) => faixaAberta(dataISO, faixa))
    if (livres.length === 0) return
    if (!livres.includes(minutos)) setMinutos(livres[0])
  }, [dataISO, minutos])

  function fechar() {
    dialogo.current?.close()
    aoFechar()
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const campos = new FormData(evento.currentTarget)
    setErro(null)

    iniciarTransicao(async () => {
      const resultado = await agendarConsulta({
        pacienteId: String(campos.get('paciente') ?? ''),
        procedimentoId: String(campos.get('procedimento') ?? ''),
        // O instante é montado aqui, com o fuso da clínica explícito.
        // Um `new Date('2026-08-10T14:00')` usaria o fuso do navegador —
        // que é o de quem abriu a tela, não o da clínica.
        inicio: instanteDaClinica(dataISO, minutos).toISOString(),
      })

      if (resultado.ok) {
        fechar()
        return
      }
      setErro(resultado.erro)
    })
  }

  return (
    <dialog
      ref={dialogo}
      aria-labelledby="titulo-nova-consulta"
      onCancel={(evento) => {
        evento.preventDefault()
        fechar()
      }}
      className="m-auto w-[440px] max-w-[92vw] rounded-[18px] border border-linha bg-superficie p-6 text-texto shadow-[var(--shadow-painel)] backdrop:bg-black/40"
    >
      <div className="mb-4 space-y-1">
        <RotuloMiudo tom="acento">Agenda</RotuloMiudo>
        <h2 id="titulo-nova-consulta" className="font-serif text-[24px] leading-tight">
          Nova consulta
        </h2>
        <p className="text-[13px] leading-relaxed text-texto-suave">
          A duração vem do procedimento. Horário ocupado ou fora do expediente é
          recusado com o motivo.
        </p>
      </div>

      {erro && (
        <p
          role="alert"
          className="mb-4 rounded-cartao border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      {semCadastro ? (
        <div className="space-y-4">
          <p className="text-sm text-texto-suave">
            Cadastre ao menos um paciente no funil e um procedimento no catálogo antes de agendar.
          </p>
          <div className="flex justify-end">
            <Pilula type="button" variante="contorno" onClick={fechar}>
              Fechar
            </Pilula>
          </div>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <RotuloMiudo>Data</RotuloMiudo>
              <select
                value={dataISO}
                onChange={(evento) => setDataISO(evento.target.value)}
                className={CAMPO}
              >
                {diasDaGrade.map((dia) => (
                  <option key={dia} value={dia}>
                    {formatarDataExtensa(dia)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <RotuloMiudo>Horário</RotuloMiudo>
              {horariosDoDia.length === 0 ? (
                <p className="rounded-cartao border border-linha px-3 py-2 text-[13px] text-texto-mudo">
                  Sem expediente neste dia
                </p>
              ) : (
                <select
                  value={minutos}
                  onChange={(evento) => setMinutos(Number(evento.target.value))}
                  className={CAMPO}
                >
                  {horariosDoDia.map((faixa) => (
                    <option key={faixa} value={faixa}>
                      {hhmm(faixa)}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <label className="block space-y-1 sm:col-span-2">
              <RotuloMiudo>Paciente</RotuloMiudo>
              <select name="paciente" required defaultValue="" className={CAMPO}>
                <option value="" disabled>
                  Escolha o paciente
                </option>
                {pacientes.map((paciente) => (
                  <option key={paciente.id} value={paciente.id}>
                    {paciente.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1 sm:col-span-2">
              <RotuloMiudo>Procedimento</RotuloMiudo>
              <select name="procedimento" required defaultValue="" className={CAMPO}>
                <option value="" disabled>
                  Escolha o procedimento
                </option>
                {procedimentos.map((procedimento) => (
                  <option key={procedimento.id} value={procedimento.id}>
                    {procedimento.nome} · {procedimento.duracaoMinutos} min
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Pilula type="button" variante="contorno" onClick={fechar} disabled={pendente}>
              Cancelar
            </Pilula>
            <Pilula
              type="submit"
              variante="solida"
              disabled={pendente || horariosDoDia.length === 0}
            >
              {pendente ? 'Agendando…' : 'Agendar'}
            </Pilula>
          </div>
        </form>
      )}
    </dialog>
  )
}
