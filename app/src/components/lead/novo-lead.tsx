'use client'

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'
import { Pilula, RotuloMiudo } from '@/components/ui'
import { criarLead, listarProcedimentosParaLead } from './acoes'
import type { ProcedimentoParaLead } from './tipos'

const CAMPO =
  'w-full rounded-cartao border border-linha bg-superficie px-3 py-2.5 text-[14px] placeholder:text-texto-suave'

/**
 * NOVO LEAD — o botão sólido da direita da barra superior.
 *
 * Abre o cadastro mínimo de paciente: nome, telefone, origem e procedimento de
 * interesse. É o formulário do balcão, não a ficha completa — quem atende o
 * telefone precisa registrar a pessoa em poucos campos e voltar a falar com ela.
 *
 * `<dialog>` nativo em vez de uma div com `position: fixed`: ele já entrega
 * fechar no Esc, foco preso dentro do modal e o resto da página inerte, tudo
 * exigido pela seção 6 do spec e tudo fácil de errar na mão. O `showModal()`
 * sai de um manipulador de evento, e não de um `useEffect` — nenhum estado é
 * ajustado depois da renderização.
 */
export function NovoLead() {
  const dialogo = useRef<HTMLDialogElement>(null)
  const formulario = useRef<HTMLFormElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, iniciar] = useTransition()
  const [procedimentos, setProcedimentos] = useState<ProcedimentoParaLead[] | null>(null)

  useEffect(() => {
    let cancelado = false
    void listarProcedimentosParaLead().then((lista) => {
      if (!cancelado) setProcedimentos(lista)
    })
    return () => {
      cancelado = true
    }
  }, [])

  function abrir() {
    setErro(null)
    dialogo.current?.showModal()
  }

  function fechar() {
    dialogo.current?.close()
    formulario.current?.reset()
    setErro(null)
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const dados = new FormData(evento.currentTarget)
    setErro(null)

    iniciar(async () => {
      const resposta = await criarLead(dados)
      if (!resposta.ok) {
        setErro(resposta.erro)
        return
      }
      // Sem `router.refresh()`: quem revalida é a própria Server Action, com
      // `revalidatePath('/', 'layout')`. A resposta da action já traz o RSC
      // novo, e é isso que faz o contador do Funil na lateral subir junto com
      // o cartão aparecendo na coluna.
      fechar()
    })
  }

  return (
    <>
      <Pilula
        variante="solida"
        onClick={abrir}
        aria-label="Novo lead"
        className="min-h-11 px-4 text-[10px] tracking-[0.08em] sm:px-5 sm:text-[11px] sm:tracking-[0.1em]"
      >
        <span className="sm:hidden" aria-hidden="true">
          Lead
        </span>
        <span className="hidden sm:inline">Novo lead</span>
      </Pilula>

      <dialog
        ref={dialogo}
        aria-labelledby="titulo-novo-lead"
        onCancel={(evento) => {
          // O Esc dispara `cancel` e fecha sozinho; interceptar é o que permite
          // limpar o formulário junto, para o próximo lead não herdar o anterior.
          evento.preventDefault()
          fechar()
        }}
        className="m-auto w-[380px] max-w-[92vw] rounded-cartao border border-linha bg-superficie p-6 text-texto backdrop:bg-black/40"
      >
        <form ref={formulario} onSubmit={enviar} className="space-y-4">
          <div className="space-y-1">
            <RotuloMiudo tom="acento">Cadastro rápido</RotuloMiudo>
            <h2 id="titulo-novo-lead" className="font-serif text-[24px] leading-tight">
              Novo lead
            </h2>
            <p className="text-[12px] text-texto-suave">
              Entra no funil em Lead. O resto da ficha pode ser preenchido depois.
            </p>
          </div>

          <label className="block space-y-1">
            <RotuloMiudo className="block">Nome completo</RotuloMiudo>
            <input name="nome" required maxLength={120} autoComplete="off" className={CAMPO} />
          </label>

          <label className="block space-y-1">
            <RotuloMiudo className="block">Telefone</RotuloMiudo>
            <input
              name="telefone"
              type="tel"
              inputMode="tel"
              maxLength={40}
              autoComplete="off"
              placeholder="(11) 98765-4321"
              className={CAMPO}
            />
          </label>

          <label className="block space-y-1">
            <RotuloMiudo className="block">Como me conheceu</RotuloMiudo>
            <input
              name="origem"
              maxLength={80}
              autoComplete="off"
              placeholder="Instagram, indicação…"
              className={CAMPO}
            />
          </label>

          <label className="block space-y-1">
            <RotuloMiudo className="block">Procedimento de interesse</RotuloMiudo>
            <select name="procedimento_interesse_id" defaultValue="" className={CAMPO}>
              <option value="">A definir</option>
              {(procedimentos ?? []).map((procedimento) => (
                <option key={procedimento.id} value={procedimento.id}>
                  {procedimento.nome}
                </option>
              ))}
            </select>
          </label>

          {erro ? (
            <p role="alert" className="text-[12px] text-alerta">
              {erro}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Pilula onClick={fechar} disabled={enviando}>
              Cancelar
            </Pilula>
            <Pilula type="submit" variante="solida" disabled={enviando}>
              {enviando ? 'Salvando…' : 'Cadastrar'}
            </Pilula>
          </div>
        </form>
      </dialog>
    </>
  )
}
