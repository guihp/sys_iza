'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
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
  FAIXAS,
  PASSO_MINUTOS,
  ROTULOS_DOS_DIAS,
  posicionarNaGrade,
  rotuloDoPeriodo,
} from './grade'
import { CORES_DE_STATUS, ROTULOS_DE_STATUS, type StatusDeConsulta } from './status'

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

const CAMPO = 'w-full rounded-lg border border-linha bg-transparent px-3 py-2 text-sm'
const BOTAO_PRINCIPAL = 'rounded-lg bg-acento px-4 py-2 text-sm text-white disabled:opacity-60'
const BOTAO_DISCRETO = 'rounded-lg border border-linha px-3 py-1.5 text-sm hover:bg-superficie'

/** Altura de uma linha da grade. Meia hora tem que caber um nome e um horário. */
const ALTURA_DA_LINHA = '3.25rem'

function hhmm(minutosDoDia: number): string {
  const hora = Math.floor(minutosDoDia / 60)
  const minuto = minutosDoDia % 60
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
}

/** A clínica atende nesse dia, nessa faixa de meia hora? */
function faixaAberta(dataISO: string, minutos: number): boolean {
  return faixasDoDia(dataISO).some(
    (faixa) => minutos >= minutosDeHHMM(faixa.de) && minutos < minutosDeHHMM(faixa.ate),
  )
}

/** Horário que o formulário está prestes a marcar. */
type Escolha = { dataISO: string; minutos: number }

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

  // Uma passada só: para cada dia, onde cada consulta entra e quais linhas ela
  // ocupa. O que não couber na grade (madrugada, ou consulta que atravessa a
  // borda) fica de fora e é listado à parte.
  const foraDaGrade: ConsultaNaAgenda[] = []
  const posicionadas = dias.map(() => [] as { consulta: ConsultaNaAgenda; linha: number; linhas: number }[])
  const ocupadas = dias.map(() => new Set<number>())

  for (const consulta of naGrade) {
    const intervalo = { inicio: new Date(consulta.inicio), fim: new Date(consulta.fim) }
    const indice = dias.findIndex((dia) => posicionarNaGrade(intervalo, dia) !== null)
    if (indice === -1) {
      foraDaGrade.push(consulta)
      continue
    }
    const posicao = posicionarNaGrade(intervalo, dias[indice])!
    posicionadas[indice].push({ consulta, linha: posicao.linhaInicial, linhas: posicao.linhas })
    for (let n = 0; n < posicao.linhas; n += 1) ocupadas[indice].add(posicao.linhaInicial + n)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/agenda?semana=${deslocarData(inicioDaSemanaISO, -7)}`}
            className={BOTAO_DISCRETO}
          >
            ← Semana anterior
          </Link>
          <Link href="/agenda" className={BOTAO_DISCRETO}>
            Hoje
          </Link>
          <Link
            href={`/agenda?semana=${deslocarData(inicioDaSemanaISO, 7)}`}
            className={BOTAO_DISCRETO}
          >
            Próxima semana →
          </Link>
        </div>
        <p className="text-sm text-texto/60">{rotuloDoPeriodo(inicioDaSemanaISO)}</p>
      </div>

      {escolha && (
        <FormularioDeAgendamento
          escolha={escolha}
          pacientes={pacientes}
          procedimentos={procedimentos}
          aoFechar={() => setEscolha(null)}
        />
      )}

      {/* Sete colunas de horário não cabem em tela de notebook. */}
      <div className="overflow-x-auto pb-2">
        <div
          className="grid min-w-[56rem] gap-px"
          style={{
            gridTemplateColumns: '4.5rem repeat(7, minmax(9rem, 1fr))',
            gridTemplateRows: `auto repeat(${FAIXAS.length}, ${ALTURA_DA_LINHA})`,
          }}
        >
          {dias.map((dia, indice) => (
            <div
              key={`cabecalho-${dia}`}
              style={{ gridColumn: indice + 2, gridRow: 1 }}
              className={`border-b border-linha px-2 pb-2 text-center ${
                dia === hoje ? 'text-acento' : 'text-texto/70'
              }`}
            >
              <p className="text-xs uppercase tracking-wide">{ROTULOS_DOS_DIAS[indice]}</p>
              <p className="text-sm">{formatarDataExtensa(dia)}</p>
            </div>
          ))}

          {FAIXAS.map((minutos, linha) => (
            <div
              key={`hora-${minutos}`}
              style={{ gridColumn: 1, gridRow: linha + 2 }}
              className="pr-2 text-right text-xs text-texto/50"
            >
              {/* Só as horas cheias recebem rótulo: a grade fica legível. */}
              {minutos % 60 === 0 ? hhmm(minutos) : ''}
            </div>
          ))}

          {dias.map((dia, indiceDoDia) =>
            FAIXAS.map((minutos, linha) => {
              if (ocupadas[indiceDoDia].has(linha)) return null

              const aberta = faixaAberta(dia, minutos)
              const chave = `${dia}-${minutos}`
              const posicao = { gridColumn: indiceDoDia + 2, gridRow: linha + 2 }

              if (!aberta) {
                return (
                  <div
                    key={chave}
                    style={posicao}
                    aria-hidden="true"
                    className="border-b border-linha/40 bg-linha/20"
                  />
                )
              }

              return (
                <button
                  key={chave}
                  type="button"
                  style={posicao}
                  onClick={() => setEscolha({ dataISO: dia, minutos })}
                  aria-label={`Marcar consulta em ${formatarDataExtensa(dia)} às ${hhmm(minutos)}`}
                  className="border-b border-linha/40 text-xs text-transparent hover:bg-superficie hover:text-texto/50 focus:bg-superficie focus:text-texto/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-acento"
                >
                  + {hhmm(minutos)}
                </button>
              )
            }),
          )}

          {posicionadas.map((doDia, indiceDoDia) =>
            doDia.map(({ consulta, linha, linhas }) => (
              <article
                key={consulta.id}
                style={{
                  gridColumn: indiceDoDia + 2,
                  gridRow: `${linha + 2} / span ${linhas}`,
                }}
                className={`overflow-hidden rounded-lg border px-2 py-1 text-xs ${
                  CORES_DE_STATUS[consulta.status]
                }`}
              >
                <p className="font-medium">
                  {horaDaClinica(new Date(consulta.inicio))} –{' '}
                  {horaDaClinica(new Date(consulta.fim))}
                </p>
                <p className="truncate">{consulta.paciente}</p>
                <p className="truncate text-texto/60">{consulta.procedimento}</p>
                <p className="truncate text-texto/50">{ROTULOS_DE_STATUS[consulta.status]}</p>
                {consulta.observacoes && (
                  <p className="truncate text-texto/50" title={consulta.observacoes}>
                    {consulta.observacoes}
                  </p>
                )}
              </article>
            )),
          )}
        </div>
      </div>

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
    <section className="rounded-xl border border-linha p-4">
      <h2 className="font-serif text-sm">{titulo}</h2>
      <p className="mb-3 text-xs text-texto/50">{explicacao}</p>
      <ul className="space-y-1 text-sm">
        {consultas.map((consulta) => (
          <li key={consulta.id} className="text-texto/70">
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

function FormularioDeAgendamento({
  escolha,
  pacientes,
  procedimentos,
  aoFechar,
}: {
  escolha: Escolha
  pacientes: OpcaoDePaciente[]
  procedimentos: OpcaoDeProcedimento[]
  aoFechar: () => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciarTransicao] = useTransition()

  const semCadastro = pacientes.length === 0 || procedimentos.length === 0

  return (
    <section className="rounded-xl border border-linha p-4">
      <h2 className="mb-1 font-serif text-lg">Nova consulta</h2>
      <p className="mb-4 text-sm text-texto/60">
        {formatarDataExtensa(escolha.dataISO)} às {hhmm(escolha.minutos)}. A duração vem do
        procedimento escolhido.
      </p>

      {/* O alerta fica acima do formulário, e não some ao trocar de campo: é
          nele que aparece o conflito de horário devolvido pela Server Action. */}
      {erro && (
        <p role="alert" className="mb-4 rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {erro}
        </p>
      )}

      {semCadastro ? (
        <p className="text-sm text-texto/60">
          Cadastre ao menos um paciente no funil e um procedimento no catálogo antes de agendar.
        </p>
      ) : (
        <form
          onSubmit={(evento) => {
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
                inicio: instanteDaClinica(escolha.dataISO, escolha.minutos).toISOString(),
              })

              if (resultado.ok) {
                aoFechar()
                return
              }
              setErro(resultado.erro)
            })
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Paciente</span>
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

            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Procedimento</span>
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

          <div className="flex gap-2">
            <button type="submit" disabled={pendente} className={BOTAO_PRINCIPAL}>
              {pendente ? 'Agendando…' : 'Agendar'}
            </button>
            <button type="button" onClick={aoFechar} disabled={pendente} className={BOTAO_DISCRETO}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
