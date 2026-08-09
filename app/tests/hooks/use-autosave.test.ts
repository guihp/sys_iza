import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAutosave, useAutosaveForm } from '@/hooks/use-autosave'

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('não grava o valor inicial', async () => {
    const save = vi.fn(async () => ({ ok: true as const }))
    renderHook(({ value }) => useAutosave({ value, save, delayMs: 400 }), {
      initialProps: { value: 'a' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('não grava se o effect rodar de novo com a mesma referência (Strict Mode)', async () => {
    const save = vi.fn(async () => ({ ok: true as const }))
    const valor = { texto: 'a' }
    const { rerender } = renderHook(
      ({ value }) => useAutosave({ value, save, delayMs: 400 }),
      { initialProps: { value: valor } },
    )
    // Simula reexecução do effect sem mudar a referência.
    rerender({ value: valor })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('debounca ~400ms e grava só a última alteração', async () => {
    const save = vi.fn(async () => ({ ok: true as const }))
    const { rerender, result } = renderHook(
      ({ value }) => useAutosave({ value, save, delayMs: 400 }),
      { initialProps: { value: 'a' } },
    )

    rerender({ value: 'b' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(result.current.status).toBe('dirty')
    expect(save).not.toHaveBeenCalled()

    rerender({ value: 'c' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('c')
    expect(result.current.status).toBe('saved')
  })

  it('propaga erro do save e não marca Salvo', async () => {
    const save = vi.fn(async () => ({ ok: false as const, erro: 'falhou' }))
    const { rerender, result } = renderHook(
      ({ value }) => useAutosave({ value, save, delayMs: 100 }),
      { initialProps: { value: 1 } },
    )
    rerender({ value: 2 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(result.current.status).toBe('error')
    expect(result.current.erro).toBe('falhou')
  })

  it('flush grava imediatamente sem esperar o debounce', async () => {
    const save = vi.fn(async () => ({ ok: true as const }))
    const { rerender, result } = renderHook(
      ({ value }) => useAutosave({ value, save, delayMs: 5_000 }),
      { initialProps: { value: 'a' } },
    )

    rerender({ value: 'b' })
    expect(result.current.status).toBe('dirty')

    await act(async () => {
      const out = await result.current.flush()
      expect(out).toEqual({ ok: true })
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('b')
    expect(result.current.status).toBe('saved')
  })

  it('serializa saves sobrepostos (usa valor mais recente)', async () => {
    let liberar!: () => void
    const barreira = new Promise<void>((resolve) => {
      liberar = resolve
    })
    const save = vi.fn(async (v: string) => {
      if (v === 'primeiro') await barreira
      return { ok: true as const }
    })

    const { rerender, result } = renderHook(
      ({ value }) => useAutosave({ value, save, delayMs: 50 }),
      { initialProps: { value: 'inicio' } },
    )

    rerender({ value: 'primeiro' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(save).toHaveBeenCalledTimes(1)

    rerender({ value: 'segundo' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    await act(async () => {
      liberar()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(save.mock.calls.some((c) => c[0] === 'segundo')).toBe(true)
    expect(result.current.status === 'saved' || result.current.status === 'dirty').toBe(true)
  })
})

describe('useAutosaveForm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('só ativa depois de marcarAlterado', async () => {
    const save = vi.fn(async () => ({ ok: true as const }))
    const { result } = renderHook(() => useAutosaveForm({ save, delayMs: 200 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(save).not.toHaveBeenCalled()

    act(() => {
      result.current.marcarAlterado()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('saved')
  })
})
