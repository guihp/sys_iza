import { describe, expect, it } from 'vitest'
import { formatarTelefone, normalizarTelefone } from '@/lib/phone'

describe('normalizarTelefone', () => {
  it('normaliza celular com DDD e máscara', () => {
    expect(normalizarTelefone('(11) 98765-4321')).toBe('+5511987654321')
  })

  it('aceita número já em E.164', () => {
    expect(normalizarTelefone('+5511987654321')).toBe('+5511987654321')
  })

  it('aceita fixo de 10 dígitos', () => {
    expect(normalizarTelefone('1132654321')).toBe('+551132654321')
  })

  it('remove o zero do DDD', () => {
    expect(normalizarTelefone('011 98765-4321')).toBe('+5511987654321')
  })

  it('devolve null para entrada curta demais', () => {
    expect(normalizarTelefone('98765')).toBeNull()
  })

  // --- casos difíceis, além do roteiro ---

  it('aceita fixo já em E.164 com 12 dígitos', () => {
    expect(normalizarTelefone('+55 (11) 3265-4321')).toBe('+551132654321')
  })

  it('remove o zero da operadora depois do código do país', () => {
    expect(normalizarTelefone('+55 011 98765-4321')).toBe('+5511987654321')
  })

  it('não confunde o DDD 55 com o código do país', () => {
    // Santa Maria/RS: DDD 55 + celular de 9 dígitos = 11 dígitos nacionais.
    // O corte do "55" só vale a partir de 12 dígitos, que é o mínimo de um
    // número brasileiro já internacionalizado.
    expect(normalizarTelefone('(55) 99999-8888')).toBe('+5555999998888')
    expect(normalizarTelefone('+55 55 99999-8888')).toBe('+5555999998888')
    expect(normalizarTelefone('(55) 3226-1234')).toBe('+555532261234')
  })

  it('ignora texto ao redor dos dígitos', () => {
    expect(normalizarTelefone('  Tel: 11 98765.4321 (WhatsApp) ')).toBe('+5511987654321')
  })

  it('devolve null para string vazia ou só com lixo', () => {
    expect(normalizarTelefone('')).toBeNull()
    expect(normalizarTelefone('não tem')).toBeNull()
  })

  it('devolve null para número longo demais', () => {
    expect(normalizarTelefone('11987654321987')).toBeNull()
  })

  it('devolve null para 9 dígitos sem DDD', () => {
    // Celular sem DDD é irrecuperável: não dá para adivinhar a cidade.
    expect(normalizarTelefone('987654321')).toBeNull()
  })
})

describe('formatarTelefone', () => {
  it('formata celular E.164 no padrão brasileiro', () => {
    expect(formatarTelefone('+5511987654321')).toBe('(11) 98765-4321')
  })

  it('formata fixo E.164 no padrão brasileiro', () => {
    expect(formatarTelefone('+551132654321')).toBe('(11) 3265-4321')
  })

  it('devolve traço quando não há telefone', () => {
    expect(formatarTelefone(null)).toBe('—')
    expect(formatarTelefone('')).toBe('—')
  })

  it('devolve o valor original quando não reconhece o formato', () => {
    expect(formatarTelefone('+13125550123')).toBe('+13125550123')
  })
})
