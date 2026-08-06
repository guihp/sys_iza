// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ErroDeEnvio,
  classificarStatus,
  sanitizarMensagem,
} from '@/integrations/envio'

describe('classificarStatus', () => {
  it('401, 403 e 407 são credencial e não se resolvem repetindo', () => {
    for (const status of [401, 403, 407]) {
      expect(classificarStatus(status)).toBe('credencial')
      expect(new ErroDeEnvio('x', classificarStatus(status)).permanente).toBe(true)
    }
  })

  it('4xx de requisição é permanente', () => {
    for (const status of [400, 404, 409, 422]) {
      expect(classificarStatus(status)).toBe('requisicao')
      expect(new ErroDeEnvio('x', classificarStatus(status)).permanente).toBe(true)
    }
  })

  it('408, 425 e 429 são transitórios apesar de 4xx', () => {
    expect(classificarStatus(408)).toBe('timeout')
    expect(classificarStatus(425)).toBe('limite')
    expect(classificarStatus(429)).toBe('limite')
    for (const status of [408, 425, 429]) {
      expect(new ErroDeEnvio('x', classificarStatus(status)).permanente).toBe(false)
    }
  })

  it('5xx é indisponibilidade e vale retentar', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classificarStatus(status)).toBe('indisponivel')
      expect(new ErroDeEnvio('x', classificarStatus(status)).permanente).toBe(false)
    }
  })

  it('status inesperado fora de 4xx/5xx não é retentado às cegas', () => {
    expect(classificarStatus(302)).toBe('resposta')
    expect(new ErroDeEnvio('x', classificarStatus(302)).permanente).toBe(true)
  })
})

describe('ErroDeEnvio', () => {
  it('deriva permanente do motivo, sem deixar os dois se contradizerem', () => {
    expect(new ErroDeEnvio('x', 'rede').permanente).toBe(false)
    expect(new ErroDeEnvio('x', 'destinatario').permanente).toBe(true)
    expect(new ErroDeEnvio('x', 'requisicao', { status: 400 }).status).toBe(400)
    expect(new ErroDeEnvio('x', 'rede')).toBeInstanceOf(Error)
    expect(new ErroDeEnvio('x', 'rede').name).toBe('ErroDeEnvio')
  })
})

describe('sanitizarMensagem', () => {
  it('troca a chave literal por [oculto], em qualquer caixa', () => {
    const limpo = sanitizarMensagem('apikey ABC123SECRETO recusada (abc123secreto)', [
      'ABC123SECRETO',
    ])
    expect(limpo).not.toContain('ABC123SECRETO')
    expect(limpo).not.toContain('abc123secreto')
    expect(limpo).toContain('[oculto]')
  })

  it('mascara token no formato Bearer mesmo sem conhecer o segredo', () => {
    const limpo = sanitizarMensagem('Authorization: Bearer re_9fTq1xLpZzKw00', [])
    expect(limpo).not.toContain('re_9fTq1xLpZzKw00')
    expect(limpo).toContain('[oculto]')
  })

  it('mascara chave do Resend solta no corpo', () => {
    const limpo = sanitizarMensagem('{"message":"invalid key re_9fTq1xLpZzKw00"}', [])
    expect(limpo).not.toContain('re_9fTq1xLpZzKw00')
  })

  it('mascara apikey citada como campo JSON', () => {
    const limpo = sanitizarMensagem('{"apikey":"XyZ0123456789ab"}', [])
    expect(limpo).not.toContain('XyZ0123456789ab')
  })

  it('ignora segredo curto demais para não mascarar o texto inteiro', () => {
    expect(sanitizarMensagem('erro k qualquer', ['k'])).toBe('erro k qualquer')
    expect(sanitizarMensagem('erro qualquer', [''])).toBe('erro qualquer')
    expect(sanitizarMensagem('erro qualquer', [undefined])).toBe('erro qualquer')
  })

  it('trata a chave como texto literal, sem interpretá-la como regex', () => {
    const limpo = sanitizarMensagem('recusou a chave a.*c+xyz9 e o resto', ['a.*c+xyz9'])
    expect(limpo).toBe('recusou a chave [oculto] e o resto')
  })

  it('achata quebras de linha e corta o corpo gigante que iria para a tela', () => {
    const html = `<html>\n<body>\n${'x'.repeat(2000)}\n</body>\n</html>`
    const limpo = sanitizarMensagem(html, [])
    expect(limpo).not.toContain('\n')
    expect(limpo.length).toBeLessThanOrEqual(301)
    expect(limpo.endsWith('…')).toBe(true)
  })
})
