'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export type ResultadoAutosave = { ok: true } | { ok: false; erro: string }

const ATRASO_PADRAO_MS = 400

/**
 * Debounce + gravação quieta, com fila (não sobrepõe saves) e `flush`.
 * Ignora o valor inicial. Não chama router.refresh — quem precisa atualizar
 * lista faz isso ao sair da tela.
 *
 * "Salvo" só após `save` retornar `{ ok: true }` com o valor mais recente
 * (sem dirty pendente). Erro do servidor ou throw → status `error`.
 */
export function useAutosave<T>({
  value,
  save,
  enabled = true,
  delayMs = ATRASO_PADRAO_MS,
}: {
  value: T
  save: (value: T) => Promise<ResultadoAutosave>
  enabled?: boolean
  delayMs?: number
}): {
  status: AutosaveStatus
  erro: string | null
  flush: () => Promise<ResultadoAutosave>
} {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [erro, setErro] = useState<string | null>(null)
  const vistoInicialRef = useRef(false)
  const valorAnteriorRef = useRef(value)
  const saveRef = useRef(save)
  const valueRef = useRef(value)
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const cadeiaRef = useRef(Promise.resolve<ResultadoAutosave>({ ok: true }))
  const habilitadoRef = useRef(enabled)

  saveRef.current = save
  valueRef.current = value
  habilitadoRef.current = enabled

  const limparTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const executarSave = useCallback(async (): Promise<ResultadoAutosave> => {
    if (!habilitadoRef.current) return { ok: true }

    dirtyRef.current = false
    setStatus('saving')
    setErro(null)

    try {
      const resultado = await saveRef.current(valueRef.current)
      // Mais edições chegaram enquanto gravava — a cadeia roda de novo.
      if (dirtyRef.current) {
        if (!resultado.ok) {
          setErro(resultado.erro)
          setStatus('error')
        } else {
          setStatus('dirty')
        }
        return resultado
      }
      if (!resultado.ok) {
        setErro(resultado.erro)
        setStatus('error')
        return resultado
      }
      setStatus('saved')
      setErro(null)
      return resultado
    } catch {
      const falha: ResultadoAutosave = {
        ok: false,
        erro: 'Não foi possível salvar. Tente de novo.',
      }
      if (dirtyRef.current) {
        setStatus('dirty')
        return falha
      }
      setErro(falha.erro)
      setStatus('error')
      return falha
    }
  }, [])

  const enfileirarSave = useCallback((): Promise<ResultadoAutosave> => {
    const proxima = cadeiaRef.current.then(executarSave, executarSave)
    // Mantém a cadeia viva mesmo se um save rejeitar (não deve, mas…).
    cadeiaRef.current = proxima.then(
      () => ({ ok: true as const }),
      () => ({ ok: true as const }),
    )
    return proxima
  }, [executarSave])

  const enfileirarSaveRef = useRef(enfileirarSave)
  enfileirarSaveRef.current = enfileirarSave
  const delayRef = useRef(delayMs)
  delayRef.current = delayMs

  const agendarSave = useCallback(() => {
    limparTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void enfileirarSaveRef.current().then(async (primeiro) => {
        // Drena dirty acumulado durante o save (edição + stamp de id).
        while (dirtyRef.current && habilitadoRef.current) {
          const seguinte = await enfileirarSaveRef.current()
          if (!seguinte.ok) return
        }
        return primeiro
      })
    }, delayRef.current)
  }, [])

  // Strict Mode reexecuta o effect com o MESMO value — não pode marcar dirty.
  // Só grava quando a referência de `value` muda de verdade.
  useEffect(() => {
    if (!enabled) {
      vistoInicialRef.current = false
      limparTimer()
      return
    }

    if (!vistoInicialRef.current) {
      vistoInicialRef.current = true
      valorAnteriorRef.current = value
      return
    }

    if (Object.is(valorAnteriorRef.current, value)) return
    valorAnteriorRef.current = value

    dirtyRef.current = true
    setStatus('dirty')
    setErro(null)
    agendarSave()

    return limparTimer
  }, [value, enabled, agendarSave])

  const flush = useCallback(async (): Promise<ResultadoAutosave> => {
    if (!habilitadoRef.current) return { ok: true }
    limparTimer()

    if (!dirtyRef.current) {
      // Aguarda save em voo, se houver.
      await cadeiaRef.current
      return { ok: true }
    }

    let ultimo: ResultadoAutosave = { ok: true }
    do {
      ultimo = await enfileirarSave()
      if (!ultimo.ok) return ultimo
    } while (dirtyRef.current)

    return ultimo
  }, [enfileirarSave])

  // Ao desmontar (troca de aba / Voltar sem flush explícito): dispara o
  // valor mais recente. Fire-and-forget — server action ainda completa.
  useEffect(() => {
    return () => {
      limparTimer()
      if (habilitadoRef.current && dirtyRef.current) {
        dirtyRef.current = false
        void saveRef.current(valueRef.current)
      }
    }
  }, [])

  return { status, erro, flush }
}

/** Contador de alterações em formulário uncontrolled (FormData na hora do save). */
export function useAutosaveForm({
  save,
  enabled = true,
  delayMs = ATRASO_PADRAO_MS,
}: {
  save: () => Promise<ResultadoAutosave>
  enabled?: boolean
  delayMs?: number
}): {
  status: AutosaveStatus
  erro: string | null
  marcarAlterado: () => void
  flush: () => Promise<ResultadoAutosave>
} {
  const [versao, setVersao] = useState(0)
  const saveRef = useRef(save)
  saveRef.current = save

  // `versao` começa em 0 e o useAutosave ignora o valor inicial; a 1ª
  // `marcarAlterado` sobe para 1 e dispara o debounce.
  const { status, erro, flush } = useAutosave({
    value: versao,
    enabled,
    delayMs,
    save: async () => saveRef.current(),
  })

  return {
    status,
    erro,
    flush,
    marcarAlterado: () => setVersao((v) => v + 1),
  }
}
