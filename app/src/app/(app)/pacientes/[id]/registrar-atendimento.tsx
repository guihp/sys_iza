'use client'

import { useState, useTransition } from 'react'
import { calcularRetorno } from '@/domain/returns/compute-return'
import {
  dataDoDiaDeCalendario,
  diaDeCalendario,
  formatarDataExtensaComAno,
} from '@/lib/datetime'
import { registrarAtendimento } from './acoes'

export type OpcaoDeProcedimento = {
  id: string
  nome: string
  /** `default_return_interval_days` do catálogo. Nível 1 da precedência. */
  retornoPadraoDias: number | null
}

export type OpcaoDeConsulta = {
  id: string
  /** Já formatado no servidor: "10 de agosto · 14:00 · Toxina botulínica". */
  rotulo: string
}

const CAMPO = 'w-full rounded-lg border border-linha bg-transparent px-3 py-2 text-sm'
const BOTAO_PRINCIPAL = 'rounded-lg bg-acento px-4 py-2 text-sm text-white disabled:opacity-60'

/** Estado inicial dos campos de retorno para um procedimento. */
function padraoDoProcedimento(
  procedimentos: OpcaoDeProcedimento[],
  id: string,
): { padraoDias: number | null; dias: string } {
  const escolhido = procedimentos.find((procedimento) => procedimento.id === id)
  const padraoDias = escolhido?.retornoPadraoDias ?? null
  return { padraoDias, dias: padraoDias == null ? '' : String(padraoDias) }
}

/**
 * Registro de atendimento realizado.
 *
 * Client Component porque a prévia do retorno recalcula a cada tecla, e ver a
 * data por extenso antes de salvar é o que evita a Dra. descobrir só depois que
 * marcou o retorno para o ano errado.
 *
 * A prévia usa `calcularRetorno` — a mesma função pura que a Server Action usa
 * para gravar. Duas implementações da precedência divergiriam no primeiro ajuste
 * de regra, e a tela passaria a prometer uma data que o banco não guardaria.
 * Quem manda continua sendo o servidor: aqui é só previsão.
 *
 * Renderizado apenas para a Dra. — quem decide isso é a página, pelo papel da
 * sessão. Esconder o formulário não é a autorização, só a cortesia: quem barra a
 * secretária de verdade é a checagem na Server Action e a policy da 0006.
 */
export function RegistrarAtendimento({
  pacienteId,
  hojeISO,
  procedimentos,
  consultas,
}: {
  pacienteId: string
  /** Dia de calendário de hoje **na clínica**, resolvido no servidor. */
  hojeISO: string
  procedimentos: OpcaoDeProcedimento[]
  consultas: OpcaoDeConsulta[]
}) {
  const [procedimentoId, setProcedimentoId] = useState('')
  const [consultaId, setConsultaId] = useState('')
  const [regiaoTratada, setRegiaoTratada] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [observacoes, setObservacoes] = useState('')

  // Os três controles de retorno, na ordem de precedência.
  const [dias, setDias] = useState('')
  const [data, setData] = useState('')
  const [semRetorno, setSemRetorno] = useState(false)

  const [erro, setErro] = useState<string | null>(null)
  const [confirmacao, setConfirmacao] = useState<string | null>(null)
  const [pendente, iniciarTransicao] = useTransition()

  const { padraoDias } = padraoDoProcedimento(procedimentos, procedimentoId)

  const diasDigitados = dias.trim() === '' ? null : Number(dias)
  const ajusteDias = diasDigitados !== null && Number.isFinite(diasDigitados) && diasDigitados > 0
    ? diasDigitados
    : null

  // `hojeISO` vem do servidor, não de `new Date()` no browser: o relógio de quem
  // abriu a tela pode estar em outro fuso, e a prévia mostraria uma data
  // diferente da que a Server Action vai gravar.
  const previsto = calcularRetorno({
    realizadoEm: diaDeCalendario(hojeISO),
    padraoDias,
    ajusteDias: semRetorno ? null : ajusteDias,
    ajusteData: semRetorno || !data ? null : diaDeCalendario(data),
    semRetorno,
  })

  function limpar() {
    setProcedimentoId('')
    setConsultaId('')
    setRegiaoTratada('')
    setQuantidade('')
    setObservacoes('')
    setDias('')
    setData('')
    setSemRetorno(false)
  }

  if (procedimentos.length === 0) {
    return (
      <section className="rounded-xl border border-linha p-4">
        <h2 className="mb-1 font-serif text-lg">Registrar atendimento</h2>
        <p className="text-sm text-texto/60">
          Cadastre ao menos um procedimento ativo no catálogo antes de registrar atendimento.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-linha p-4">
      <h2 className="mb-1 font-serif text-lg">Registrar atendimento</h2>
      <p className="mb-4 text-sm text-texto/60">
        O que foi feito hoje e quando esta paciente volta. Só você registra e edita o prontuário.
      </p>

      {erro && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          {erro}
        </p>
      )}

      {confirmacao && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
        >
          {confirmacao}
        </p>
      )}

      <form
        onSubmit={(evento) => {
          evento.preventDefault()
          setErro(null)
          setConfirmacao(null)

          iniciarTransicao(async () => {
            const resultado = await registrarAtendimento({
              pacienteId,
              procedimentoId,
              consultaId: consultaId || null,
              regiaoTratada,
              quantidade,
              observacoes,
              // O número já derivado, não o texto cru do campo: é exatamente o
              // que a prévia acima usou. Mandar a string faria "0" virar erro de
              // validação no servidor enquanto a tela mostrava o padrão do
              // catálogo — prévia e gravação têm que contar a mesma história.
              ajusteDias: semRetorno ? null : ajusteDias,
              ajusteData: semRetorno || !data ? null : data,
              semRetorno,
            })

            if (!resultado.ok) {
              setErro(resultado.erro)
              return
            }

            setConfirmacao(
              resultado.vencimento
                ? `Atendimento registrado. Retorno previsto para ${formatarDataExtensaComAno(resultado.vencimento)}.`
                : 'Atendimento registrado. Esta paciente não tem retorno previsto.',
            )
            limpar()
          })
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Procedimento realizado</span>
            <select
              name="procedimento"
              required
              value={procedimentoId}
              onChange={(evento) => {
                const id = evento.target.value
                setProcedimentoId(id)
                // O campo de dias já nasce com o padrão do catálogo: é o nível 1
                // aparecendo na tela como sugestão, não como imposição. Mexer
                // nele é o nível 2a; apagá-lo devolve a decisão ao catálogo.
                setDias(padraoDoProcedimento(procedimentos, id).dias)
              }}
              className={CAMPO}
            >
              <option value="" disabled>
                Escolha o procedimento
              </option>
              {procedimentos.map((procedimento) => (
                <option key={procedimento.id} value={procedimento.id}>
                  {procedimento.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Consulta da agenda (opcional)</span>
            <select
              name="consulta"
              value={consultaId}
              onChange={(evento) => setConsultaId(evento.target.value)}
              className={CAMPO}
            >
              <option value="">Sem vínculo com a agenda</option>
              {consultas.map((consulta) => (
                <option key={consulta.id} value={consulta.id}>
                  {consulta.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Região tratada</span>
            <input
              name="regiao"
              value={regiaoTratada}
              onChange={(evento) => setRegiaoTratada(evento.target.value)}
              placeholder="Terço superior, malar direito…"
              className={CAMPO}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Quantidade</span>
            <input
              name="quantidade"
              value={quantidade}
              onChange={(evento) => setQuantidade(evento.target.value)}
              placeholder="20 U, 1,5 ml…"
              className={CAMPO}
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Observações da evolução</span>
          <textarea
            name="observacoes"
            rows={3}
            value={observacoes}
            onChange={(evento) => setObservacoes(evento.target.value)}
            className={CAMPO}
          />
        </label>

        <fieldset className="space-y-3 rounded-lg border border-linha p-3">
          <legend className="px-1 text-sm text-texto/80">Retorno</legend>
          <p className="text-xs text-texto/50">
            Os controles valem de baixo para cima: a data escolhida vence o intervalo em dias, e
            &ldquo;não precisa de retorno&rdquo; vence os dois.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Retornar em (dias)</span>
              <input
                name="dias"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={dias}
                disabled={semRetorno}
                onChange={(evento) => setDias(evento.target.value)}
                className={`${CAMPO} disabled:opacity-50`}
              />
              <span className="block text-xs text-texto/50">
                {padraoDias == null
                  ? 'Este procedimento não tem retorno padrão no catálogo.'
                  : `Padrão do catálogo: ${padraoDias} dias.`}
              </span>
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Ou escolher a data</span>
              <input
                name="data"
                type="date"
                value={data}
                disabled={semRetorno}
                onChange={(evento) => setData(evento.target.value)}
                className={`${CAMPO} disabled:opacity-50`}
              />
              <span className="block text-xs text-texto/50">
                Preenchida, esta data vence o intervalo em dias.
              </span>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-texto/80">
            <input
              name="semRetorno"
              type="checkbox"
              checked={semRetorno}
              onChange={(evento) => setSemRetorno(evento.target.checked)}
              className="size-4 accent-acento"
            />
            Esta paciente não precisa de retorno
          </label>

          <p aria-live="polite" className="text-sm">
            {previsto ? (
              <>
                Retorno previsto:{' '}
                <strong className="font-medium">
                  {formatarDataExtensaComAno(dataDoDiaDeCalendario(previsto))}
                </strong>
              </>
            ) : (
              <span className="text-texto/60">Sem retorno previsto — não entra na fila.</span>
            )}
          </p>
        </fieldset>

        <button type="submit" disabled={pendente || !procedimentoId} className={BOTAO_PRINCIPAL}>
          {pendente ? 'Registrando…' : 'Registrar atendimento'}
        </button>
      </form>
    </section>
  )
}
