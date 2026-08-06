'use client'

import { useRef, useState, useTransition } from 'react'
import type { Canal, ReminderKind } from '@/domain/reminders/plan-reminders'
import {
  CLASSES_CARTAO,
  Cartao,
  Pilula,
  PilulaTexto,
  RotuloMiudo,
  juntar,
} from '@/components/ui'
import { alternarTemplate, salvarTemplate } from './acoes'
import {
  GATILHOS,
  NOME_DO_CANAL,
  avisosDeVariaveis,
  gatilhoEstaAtivo,
  inserirTrecho,
  previaDoTemplate,
  rotuloDosCanais,
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

const CAMPO =
  'w-full rounded-[12px] border border-linha bg-transparent px-3 py-2 text-sm text-texto outline-none focus:border-acento focus-visible:ring-1 focus-visible:ring-acento'

/**
 * Editor em duas colunas: gatilhos à esquerda, canais do selecionado à direita.
 *
 * A seleção vive em estado de cliente — a URL nunca carregou `?gatilho=`, e o
 * padrão da tela até aqui era estado local. Os cartões dos gatilhos fora de
 * foco ficam montados (`hidden`) para não perder rascunho ao trocar.
 */
export function EditorDeMensagens({ templates }: { templates: TemplateSalvo[] }) {
  const [selecionado, setSelecionado] = useState<ReminderKind>(GATILHOS[0].kind)
  const [ativos, setAtivos] = useState(() => mapaDeAtivos(templates))

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <RotuloMiudo>Gatilhos</RotuloMiudo>
        <ul className="space-y-2">
          {GATILHOS.map((item) => {
            const ativo = gatilhoEstaAtivo(
              item.kind,
              item.canais.map((canal) => ({
                kind: item.kind,
                channel: canal,
                ativo: ativos[chave(item.kind, canal)] ?? true,
              })),
            )
            const marcado = item.kind === selecionado
            return (
              <li key={item.kind}>
                <button
                  type="button"
                  onClick={() => setSelecionado(item.kind)}
                  aria-current={marcado ? 'true' : undefined}
                  className={juntar(
                    CLASSES_CARTAO,
                    'relative w-full p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento',
                    marcado ? 'border-acento bg-superficie' : 'hover:border-acento/50',
                  )}
                >
                  <RotuloMiudo tom="acento" className="absolute right-3.5 top-3.5">
                    {ativo ? 'Ativo' : 'Desligado'}
                  </RotuloMiudo>
                  <p className="pr-16 font-serif text-[17px] leading-snug">{item.titulo}</p>
                  <p className="mt-1.5 text-[12px] leading-snug text-texto-suave">
                    {item.quando}
                  </p>
                  <p className="mt-2 text-[11px] text-texto-suave">
                    {rotuloDosCanais(item.canais)}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <div className="min-w-0 space-y-4">
        {GATILHOS.map((item) => (
          <div
            key={item.kind}
            className={item.kind === selecionado ? 'space-y-4' : 'hidden'}
            aria-hidden={item.kind !== selecionado}
          >
            {item.canais.map((canal) => {
              const salvo = templates.find(
                (t) => t.kind === item.kind && t.channel === canal,
              )
              return (
                <CartaoDeTemplate
                  key={`${item.kind}:${canal}`}
                  gatilho={item}
                  canal={canal}
                  salvo={salvo}
                  ativo={ativos[chave(item.kind, canal)] ?? true}
                  aoAlternarAtivo={(desejado) =>
                    setAtivos((atual) => ({
                      ...atual,
                      [chave(item.kind, canal)]: desejado,
                    }))
                  }
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function chave(kind: ReminderKind, canal: Canal): string {
  return `${kind}:${canal}`
}

function mapaDeAtivos(templates: TemplateSalvo[]): Record<string, boolean> {
  const mapa: Record<string, boolean> = {}
  for (const item of GATILHOS) {
    for (const canal of item.canais) {
      const salvo = templates.find((t) => t.kind === item.kind && t.channel === canal)
      mapa[chave(item.kind, canal)] = salvo?.ativo ?? true
    }
  }
  return mapa
}

function CartaoDeTemplate({
  gatilho: gatilhoAtual,
  canal,
  salvo,
  ativo,
  aoAlternarAtivo,
}: {
  gatilho: Gatilho
  canal: Canal
  salvo: TemplateSalvo | undefined
  ativo: boolean
  aoAlternarAtivo: (desejado: boolean) => void
}) {
  const [assunto, setAssunto] = useState(salvo?.assunto ?? '')
  const [corpo, setCorpo] = useState(salvo?.corpo ?? '')
  // Baseline local: depois do Salvar o prop do servidor pode demorar um tick
  // (revalidatePath). Sem isso o rodapé ficaria em SALVAR com texto já gravado.
  const [baseline, setBaseline] = useState({
    assunto: salvo?.assunto ?? '',
    corpo: salvo?.corpo ?? '',
  })
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciarTransicao] = useTransition()
  const refAssunto = useRef<HTMLInputElement>(null)
  const refCorpo = useRef<HTMLTextAreaElement>(null)
  const [campoFocado, setCampoFocado] = useState<'assunto' | 'corpo'>('corpo')

  // Sem `useMemo`: é uma varredura de regex sobre um parágrafo, a cada tecla. O
  // custo de memoizar seria maior que o de recalcular, e as três derivações
  // precisam estar sempre coerentes com o que está na tela.
  const entrada = {
    kind: gatilhoAtual.kind,
    channel: canal,
    // O campo de assunto só existe no e-mail; no WhatsApp o banco exige nulo.
    assunto: canal === 'email' ? assunto : null,
    corpo,
  }

  const validacao = validarTemplate(entrada)
  const previa = previaDoTemplate(entrada)

  // O assunto entra na conta junto com o corpo: um `{{data}}` digitado errado na
  // linha de assunto vira "Sua consulta é amanhã, " no cabeçalho do e-mail.
  const avisos = avisosDeVariaveis(`${entrada.assunto ?? ''}\n${corpo}`, gatilhoAtual.kind)

  const alterado = corpo !== baseline.corpo || assunto !== baseline.assunto

  function salvar() {
    setErro(null)

    // A mesma checagem roda de novo na Server Action. Aqui ela existe para a
    // frase aparecer sob o campo, sem viagem ao servidor.
    if (!validacao.ok) {
      setErro(validacao.erro)
      return
    }

    const valor = validacao.valor

    iniciarTransicao(async () => {
      try {
        await salvarTemplate(valor)
        // O validador apara; alinhar o campo ao que foi gravado evita SALVAR
        // aceso por causa de espaço sobrando nas pontas.
        setAssunto(valor.assunto ?? '')
        setCorpo(valor.corpo)
        setBaseline({ assunto: valor.assunto ?? '', corpo: valor.corpo })
      } catch {
        // A mensagem do servidor pode carregar detalhe de banco; não vai à tela.
        setErro('Não foi possível salvar. Tente de novo.')
      }
    })
  }

  function alternar() {
    setErro(null)
    const desejado = !ativo

    iniciarTransicao(async () => {
      try {
        await alternarTemplate({ kind: gatilhoAtual.kind, channel: canal }, desejado)
        aoAlternarAtivo(desejado)
      } catch {
        setErro('Não foi possível alterar o envio deste lembrete.')
      }
    })
  }

  function inserirVariavel(nome: string) {
    const marcador = `{{${nome}}}`
    const alvo =
      canal === 'email' && campoFocado === 'assunto'
        ? { valor: assunto, setValor: setAssunto, ref: refAssunto }
        : { valor: corpo, setValor: setCorpo, ref: refCorpo }

    const el = alvo.ref.current
    const inicio = el?.selectionStart ?? alvo.valor.length
    const fim = el?.selectionEnd ?? alvo.valor.length
    const { texto, cursor } = inserirTrecho(alvo.valor, marcador, inicio, fim)
    alvo.setValor(texto)

    // Devolve o foco e a posição do cursor depois do React pintar o valor novo.
    queueMicrotask(() => {
      const campo = alvo.ref.current
      if (!campo) return
      campo.focus()
      campo.setSelectionRange(cursor, cursor)
    })
  }

  const idCorpo = `corpo-${gatilhoAtual.kind}-${canal}`
  const idAssunto = `assunto-${gatilhoAtual.kind}-${canal}`

  return (
    <Cartao className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-serif text-[20px] leading-none">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-acento" />
          {NOME_DO_CANAL[canal]}
        </h3>
        <Pilula onClick={alternar} disabled={pendente}>
          {ativo ? 'Desligar envio' : 'Ligar envio'}
        </Pilula>
      </div>

      {canal === 'email' && (
        <div className="space-y-1.5">
          <label htmlFor={idAssunto}>
            <RotuloMiudo>Assunto</RotuloMiudo>
          </label>
          <input
            id={idAssunto}
            ref={refAssunto}
            value={assunto}
            onChange={(evento) => setAssunto(evento.target.value)}
            onFocus={() => setCampoFocado('assunto')}
            className={CAMPO}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={idCorpo}>
          <RotuloMiudo>Mensagem</RotuloMiudo>
        </label>
        <textarea
          id={idCorpo}
          ref={refCorpo}
          value={corpo}
          onChange={(evento) => setCorpo(evento.target.value)}
          onFocus={() => setCampoFocado('corpo')}
          rows={5}
          className={`${CAMPO} leading-relaxed`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-texto-suave">Variáveis:</span>
        {gatilhoAtual.variaveis.map((nome) => (
          <button
            key={nome}
            type="button"
            onClick={() => inserirVariavel(nome)}
            className="rounded-full border border-linha bg-transparent px-2.5 py-1 text-[11px] text-texto-suave transition-colors hover:border-acento hover:text-acento focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-acento"
          >
            {`{{${nome}}}`}
          </button>
        ))}
      </div>

      {avisos.length > 0 && (
        <ul role="status" className="space-y-1 text-xs text-amber-700">
          {avisos.map((aviso) => (
            <li key={aviso.nome}>
              {aviso.motivo === 'desconhecida'
                ? `{{${aviso.nome}}} não é uma variável do sistema — confira se digitou certo. Vai sair em branco.`
                : `{{${aviso.nome}}} existe, mas este lembrete não sabe esse dado. Vai sair em branco.`}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-[12px] bg-acento-suave p-3.5">
        <RotuloMiudo>Como a paciente recebe</RotuloMiudo>
        {previa.assunto !== null && (
          <p className="text-sm font-medium text-texto">{previa.assunto}</p>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-texto/80">
          {previa.corpo}
        </p>
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

      <div className="flex flex-wrap items-center gap-3">
        {alterado ? (
          <Pilula
            variante="suave"
            onClick={salvar}
            // Sem validação passando não há o que salvar: o banco recusaria, e o
            // botão desligado diz isso antes do clique.
            disabled={pendente || !validacao.ok}
          >
            {pendente ? 'Salvando…' : 'Salvar'}
          </Pilula>
        ) : (
          <PilulaTexto role="status">Salvo</PilulaTexto>
        )}
        <p className="text-[11px] text-texto-suave">Texto sincronizado com os envios.</p>
      </div>
    </Cartao>
  )
}
