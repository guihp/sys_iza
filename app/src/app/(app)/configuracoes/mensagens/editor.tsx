'use client'

import { useState, useTransition } from 'react'
import type { Canal, ReminderKind } from '@/domain/reminders/plan-reminders'
import { alternarTemplate, salvarTemplate } from './acoes'
import {
  GATILHOS,
  avisosDeVariaveis,
  previaDoTemplate,
  validarTemplate,
  type Gatilho,
} from './mensagens'

export type TemplateSalvo = {
  kind: ReminderKind
  channel: Canal
  assunto: string | null
  corpo: string
  ativo: boolean
}

const CAMPO = 'w-full rounded-lg border border-linha bg-transparent px-3 py-2 text-sm'
const BOTAO_PRINCIPAL = 'rounded-lg bg-acento px-4 py-2 text-sm text-white disabled:opacity-50'
const BOTAO_DISCRETO = 'rounded-lg border border-linha px-3 py-1.5 text-sm hover:bg-superficie'

const NOME_DO_CANAL: Record<Canal, string> = { whatsapp: 'WhatsApp', email: 'E-mail' }

export function EditorDeMensagens({ templates }: { templates: TemplateSalvo[] }) {
  return (
    <div className="space-y-8">
      {GATILHOS.map((gatilho) => (
        <section key={gatilho.kind} className="space-y-3">
          <header className="space-y-1">
            <h2 className="font-serif text-lg">{gatilho.titulo}</h2>
            <p className="text-sm text-texto/55">{gatilho.quando}</p>
          </header>

          {gatilho.canais.map((canal) => {
            const salvo = templates.find((t) => t.kind === gatilho.kind && t.channel === canal)
            return (
              <CartaoDeTemplate
                key={`${gatilho.kind}:${canal}`}
                gatilho={gatilho}
                canal={canal}
                salvo={salvo}
              />
            )
          })}
        </section>
      ))}
    </div>
  )
}

function CartaoDeTemplate({
  gatilho,
  canal,
  salvo,
}: {
  gatilho: Gatilho
  canal: Canal
  salvo: TemplateSalvo | undefined
}) {
  const [assunto, setAssunto] = useState(salvo?.assunto ?? '')
  const [corpo, setCorpo] = useState(salvo?.corpo ?? '')
  const [ativo, setAtivo] = useState(salvo?.ativo ?? true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvoAgora, setSalvoAgora] = useState(false)
  const [pendente, iniciarTransicao] = useTransition()

  // Sem `useMemo`: é uma varredura de regex sobre um parágrafo, a cada tecla. O
  // custo de memoizar seria maior que o de recalcular, e as três derivações
  // precisam estar sempre coerentes com o que está na tela.
  const entrada = {
    kind: gatilho.kind,
    channel: canal,
    // O campo de assunto só existe no e-mail; no WhatsApp o banco exige nulo.
    assunto: canal === 'email' ? assunto : null,
    corpo,
  }

  const validacao = validarTemplate(entrada)
  const previa = previaDoTemplate(entrada)

  // O assunto entra na conta junto com o corpo: um `{{data}}` digitado errado na
  // linha de assunto vira "Sua consulta é amanhã, " no cabeçalho do e-mail.
  const avisos = avisosDeVariaveis(`${entrada.assunto ?? ''}\n${corpo}`, gatilho.kind)

  const alterado = corpo !== (salvo?.corpo ?? '') || assunto !== (salvo?.assunto ?? '')

  function salvar() {
    setErro(null)
    setSalvoAgora(false)

    // A mesma checagem roda de novo na Server Action. Aqui ela existe para a
    // frase aparecer sob o campo, sem viagem ao servidor.
    if (!validacao.ok) {
      setErro(validacao.erro)
      return
    }

    iniciarTransicao(async () => {
      try {
        await salvarTemplate(validacao.valor)
        setSalvoAgora(true)
      } catch {
        // A mensagem do servidor pode carregar detalhe de banco; não vai à tela.
        setErro('Não foi possível salvar. Tente de novo.')
      }
    })
  }

  function alternar() {
    setErro(null)
    setSalvoAgora(false)
    const desejado = !ativo

    iniciarTransicao(async () => {
      try {
        await alternarTemplate({ kind: gatilho.kind, channel: canal }, desejado)
        setAtivo(desejado)
      } catch {
        setErro('Não foi possível alterar o envio deste lembrete.')
      }
    })
  }

  const idCorpo = `corpo-${gatilho.kind}-${canal}`
  const idAssunto = `assunto-${gatilho.kind}-${canal}`

  return (
    <article className="space-y-4 rounded-xl border border-linha p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {NOME_DO_CANAL[canal]}
          {!ativo && <span className="ml-2 text-xs text-texto/50">(desligado)</span>}
        </h3>
        <button type="button" onClick={alternar} disabled={pendente} className={BOTAO_DISCRETO}>
          {ativo ? 'Desligar envio' : 'Religar envio'}
        </button>
      </div>

      {canal === 'email' && (
        <div className="space-y-1">
          <label htmlFor={idAssunto} className="block text-sm text-texto/80">
            Assunto
          </label>
          <input
            id={idAssunto}
            value={assunto}
            onChange={(evento) => setAssunto(evento.target.value)}
            className={CAMPO}
          />
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor={idCorpo} className="block text-sm text-texto/80">
          Mensagem
        </label>
        <textarea
          id={idCorpo}
          value={corpo}
          onChange={(evento) => setCorpo(evento.target.value)}
          rows={4}
          className={`${CAMPO} leading-relaxed`}
        />
        <p className="text-xs text-texto/50">
          Variáveis deste lembrete:{' '}
          {gatilho.variaveis.map((nome) => `{{${nome}}}`).join(', ')}
        </p>
      </div>

      {avisos.length > 0 && (
        <ul role="status" className="space-y-1 text-xs text-amber-600">
          {avisos.map((aviso) => (
            <li key={aviso.nome}>
              {aviso.motivo === 'desconhecida'
                ? `{{${aviso.nome}}} não é uma variável do sistema — confira se digitou certo. Vai sair em branco.`
                : `{{${aviso.nome}}} existe, mas este lembrete não sabe esse dado. Vai sair em branco.`}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1 rounded-lg bg-superficie p-3">
        <p className="text-xs uppercase tracking-wide text-texto/45">
          Como a paciente recebe
        </p>
        {previa.assunto !== null && (
          <p className="text-sm font-medium">{previa.assunto}</p>
        )}
        <p className="whitespace-pre-wrap text-sm text-texto/80">{previa.corpo}</p>
      </div>

      {!validacao.ok && (
        <p role="alert" className="text-sm text-red-600">
          {validacao.erro}
        </p>
      )}

      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          // Sem validação passando não há o que salvar: o banco recusaria, e o
          // botão desligado diz isso antes do clique.
          disabled={pendente || !validacao.ok || !alterado}
          className={BOTAO_PRINCIPAL}
        >
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
        {salvoAgora && !alterado && <span className="text-sm text-texto/55">Salvo.</span>}
      </div>
    </article>
  )
}
