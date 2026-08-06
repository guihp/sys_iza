import { describe, expect, it } from 'vitest'
import {
  hashEmail,
  hashTelefone,
  normalizarTelefoneParaHash,
  normalizarTexto,
  sha256,
} from '@/domain/marketing/hash'
import { normalizarTelefone } from '@/lib/phone'

/**
 * Vetores fixos, conferidos fora do processo:
 *
 *   $ printf '5511987654321' | shasum -a 256
 *   $ printf 'izadora@clinica.com.br' | shasum -a 256
 *
 * Sem vetor fixo, o teste só provaria que o código concorda consigo mesmo — e o
 * sintoma de discordar da Meta não é erro, é EMQ despencando semanas depois.
 */
const HASH_DO_TELEFONE = '029c7290f14c4516673508635f0519db95f7daf42057fd0e4ad1de84c5408a66'
const HASH_DO_EMAIL = 'f1764629550bb65d48a8216a202423a932edee50b3c3ded021890cd4ee30c9da'

describe('sha256', () => {
  it('bate com o vetor conhecido, em hexadecimal minúsculo', () => {
    expect(sha256('5511987654321')).toBe(HASH_DO_TELEFONE)
    expect(sha256('5511987654321')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('normalizarTelefoneParaHash', () => {
  it('tira o "+" do E.164 e deixa só dígitos', () => {
    expect(normalizarTelefoneParaHash('+5511987654321')).toBe('5511987654321')
  })

  it('tira espaço, traço e parêntese que tenham sobrado', () => {
    expect(normalizarTelefoneParaHash('+55 (11) 98765-4321')).toBe('5511987654321')
  })
})

describe('normalizarTexto', () => {
  it('baixa a caixa e apara as bordas', () => {
    expect(normalizarTexto('  IZADORA@Clinica.COM.br ')).toBe('izadora@clinica.com.br')
  })

  it('não mexe em ponto nem em "+" do usuário — normalização de provedor não é nossa', () => {
    expect(normalizarTexto('Maria.Silva+ads@Gmail.com')).toBe('maria.silva+ads@gmail.com')
  })
})

describe('hashTelefone', () => {
  it('hasheia o E.164 sem o "+"', () => {
    expect(hashTelefone('+5511987654321')).toBe(HASH_DO_TELEFONE)
  })

  it('casa com o que normalizarTelefone() grava em patients.telefone', () => {
    // A ponta que importa: o telefone guardado no banco passa por
    // `normalizarTelefone`, e é ESSE valor que chega aqui. Se as duas funções
    // discordassem, o hash sairia de um número diferente do que a paciente usa
    // no WhatsApp e a Meta não casaria com ninguém.
    const doBanco = normalizarTelefone('(11) 98765-4321')
    expect(doBanco).toBe('+5511987654321')
    expect(hashTelefone(doBanco)).toBe(HASH_DO_TELEFONE)
  })

  it('devolve null sem telefone, em vez do hash de string vazia', () => {
    // O hash de '' é um valor válido de 64 caracteres. Mandá-lo seria dar à Meta
    // o mesmo identificador para toda paciente sem número cadastrado.
    expect(hashTelefone(null)).toBeNull()
    expect(hashTelefone(undefined)).toBeNull()
    expect(hashTelefone('')).toBeNull()
    expect(hashTelefone('   ')).toBeNull()
  })
})

describe('hashEmail', () => {
  it('normaliza antes de hashear', () => {
    expect(hashEmail('  IZADORA@Clinica.COM.br ')).toBe(HASH_DO_EMAIL)
  })

  it('devolve null sem e-mail', () => {
    expect(hashEmail(null)).toBeNull()
    expect(hashEmail('  ')).toBeNull()
  })
})
