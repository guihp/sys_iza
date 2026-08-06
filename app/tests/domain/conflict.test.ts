import { describe, expect, it } from 'vitest'
import { detectarConflito, type Slot } from '@/domain/scheduling/conflict'

const slot = (inicio: string, fim: string, id?: string): Slot => ({
  id,
  inicio: new Date(inicio),
  fim: new Date(fim),
})

describe('detectarConflito', () => {
  const existentes = [slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', 'a')]

  it('não acusa conflito em horário livre', () => {
    expect(
      detectarConflito(slot('2026-08-10T16:00:00Z', '2026-08-10T17:00:00Z'), existentes),
    ).toBeNull()
  })

  it('não acusa conflito com a agenda vazia', () => {
    expect(detectarConflito(slot('2026-08-10T16:00:00Z', '2026-08-10T17:00:00Z'), [])).toBeNull()
  })

  it('acusa sobreposição parcial no início', () => {
    const achado = detectarConflito(slot('2026-08-10T14:30:00Z', '2026-08-10T15:30:00Z'), existentes)
    expect(achado?.id).toBe('a')
  })

  it('acusa sobreposição parcial no fim', () => {
    // O novo começa antes e termina no meio do existente — o espelho do caso
    // anterior. Uma implementação que só compare um dos lados passa em um e
    // falha no outro.
    const achado = detectarConflito(slot('2026-08-10T13:30:00Z', '2026-08-10T14:30:00Z'), existentes)
    expect(achado?.id).toBe('a')
  })

  it('acusa quando o novo engloba o existente', () => {
    const achado = detectarConflito(slot('2026-08-10T13:00:00Z', '2026-08-10T16:00:00Z'), existentes)
    expect(achado?.id).toBe('a')
  })

  it('acusa quando o novo cabe dentro do existente', () => {
    const achado = detectarConflito(slot('2026-08-10T14:15:00Z', '2026-08-10T14:45:00Z'), existentes)
    expect(achado?.id).toBe('a')
  })

  it('acusa horário idêntico', () => {
    const achado = detectarConflito(slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z'), existentes)
    expect(achado?.id).toBe('a')
  })

  it('encostar no fim não é conflito', () => {
    // Intervalo semiaberto [inicio, fim): a consulta das 15:00 começa no
    // instante em que a das 14:00 termina. Isso é agenda cheia, não conflito.
    expect(
      detectarConflito(slot('2026-08-10T15:00:00Z', '2026-08-10T16:00:00Z'), existentes),
    ).toBeNull()
  })

  it('encostar no início não é conflito', () => {
    expect(
      detectarConflito(slot('2026-08-10T13:00:00Z', '2026-08-10T14:00:00Z'), existentes),
    ).toBeNull()
  })

  it('ignora o próprio agendamento ao remarcar', () => {
    const remarcado = slot('2026-08-10T14:15:00Z', '2026-08-10T15:15:00Z', 'a')
    expect(detectarConflito(remarcado, existentes)).toBeNull()
  })

  it('ao remarcar, ainda acusa conflito com os outros', () => {
    const agenda = [
      slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', 'a'),
      slot('2026-08-10T15:00:00Z', '2026-08-10T16:00:00Z', 'b'),
    ]
    // Empurrar 'a' meia hora para frente esbarra em 'b'.
    const achado = detectarConflito(slot('2026-08-10T14:30:00Z', '2026-08-10T15:30:00Z', 'a'), agenda)
    expect(achado?.id).toBe('b')
  })

  it('agendamento cancelado não ocupa o horário', () => {
    const agenda = [
      { ...slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', 'a'), cancelado: true },
    ]
    expect(
      detectarConflito(slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z'), agenda),
    ).toBeNull()
  })

  it('pula o cancelado e acha o conflito real depois dele', () => {
    const agenda = [
      { ...slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', 'a'), cancelado: true },
      slot('2026-08-10T14:30:00Z', '2026-08-10T15:30:00Z', 'b'),
    ]
    const achado = detectarConflito(slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z'), agenda)
    expect(achado?.id).toBe('b')
  })

  it('devolve o primeiro conflito na ordem da lista', () => {
    const agenda = [
      slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', 'a'),
      slot('2026-08-10T14:30:00Z', '2026-08-10T15:30:00Z', 'b'),
    ]
    const achado = detectarConflito(slot('2026-08-10T14:15:00Z', '2026-08-10T14:45:00Z'), agenda)
    expect(achado?.id).toBe('a')
  })

  it('agendamento em outro dia não conflita', () => {
    expect(
      detectarConflito(slot('2026-08-11T14:00:00Z', '2026-08-11T15:00:00Z'), existentes),
    ).toBeNull()
  })

  it('novo sem id não é confundido com existente sem id', () => {
    // `novo.id` indefinido nunca pode fazer a regra do "próprio agendamento"
    // disparar — senão remarcar viraria sinônimo de ignorar toda a agenda.
    const agenda = [slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z')]
    expect(
      detectarConflito(slot('2026-08-10T14:30:00Z', '2026-08-10T15:30:00Z'), agenda),
    ).not.toBeNull()
  })
})
