// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { criarEmailClient } from '@/integrations/email/resend'
import { ErroDeEnvio } from '@/integrations/envio'

const config = { apiKey: 're_teste_0123456789', remetente: 'contato@clinicaizadora.com.br' }

const mensagem = {
  para: 'paciente@exemplo.com',
  assunto: 'Sua consulta é amanhã',
  html: '<p>Olá!</p>',
}

function respostaOk(corpo: unknown) {
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) }
}

function respostaErro(status: number, corpo: string) {
  return {
    ok: false,
    status,
    text: async () => corpo,
    json: async () => {
      throw new SyntaxError('não é JSON')
    },
  }
}

/** Ver a nota em tests/integrations/evolution.test.ts. */
async function capturarErro(promessa: Promise<unknown>): Promise<ErroDeEnvio> {
  try {
    await promessa
  } catch (e) {
    if (e instanceof ErroDeEnvio) return e
    throw e
  }
  throw new Error('esperava um ErroDeEnvio, mas o envio foi aceito')
}

describe('EmailClient — caminho feliz', () => {
  it('posta no Resend com Bearer e devolve o id da mensagem', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ id: 'e1b2c3' }))
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const r = await client.enviar(mensagem)

    expect(r.providerMessageId).toBe('e1b2c3')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer re_teste_0123456789',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      from: 'contato@clinicaizadora.com.br',
      to: ['paciente@exemplo.com'],
      subject: 'Sua consulta é amanhã',
      html: '<p>Olá!</p>',
    })
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })
})

describe('EmailClient — erro permanente', () => {
  it('422 de e-mail recusado é permanente', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        respostaErro(422, '{"name":"validation_error","message":"Invalid `to` field"}'),
      )
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(client.enviar(mensagem))

    expect(erro.permanente).toBe(true)
    expect(erro.motivo).toBe('requisicao')
    expect(erro.status).toBe(422)
  })

  it('401 de chave errada é permanente e marcado como credencial', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(401, 'API key is invalid'))
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(client.enviar(mensagem))

    expect(erro.permanente).toBe(true)
    expect(erro.motivo).toBe('credencial')
  })

  it('endereço malformado falha antes de gastar uma requisição', async () => {
    const fetchMock = vi.fn()
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviar({ ...mensagem, para: 'paciente arroba exemplo' }),
    )

    expect(erro.permanente).toBe(true)
    expect(erro.motivo).toBe('destinatario')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('assunto ou corpo em branco falha antes de gastar uma requisição', async () => {
    const fetchMock = vi.fn()
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    await expect(client.enviar({ ...mensagem, assunto: '  ' })).rejects.toMatchObject({
      permanente: true,
      motivo: 'requisicao',
    })
    await expect(client.enviar({ ...mensagem, html: '' })).rejects.toMatchObject({
      permanente: true,
      motivo: 'requisicao',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('200 com corpo que não é JSON não é retentado, para não duplicar o e-mail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
      text: async () => 'ok',
    })
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(client.enviar(mensagem))

    expect(erro.motivo).toBe('resposta')
    expect(erro.permanente).toBe(true)
  })
})

describe('EmailClient — erro transitório', () => {
  it('429 é transitório', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(429, 'Too many requests'))
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(client.enviar(mensagem))

    expect(erro.permanente).toBe(false)
    expect(erro.motivo).toBe('limite')
  })

  it('503 é transitório', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(503, 'Service Unavailable'))
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    await expect(client.enviar(mensagem)).rejects.toMatchObject({
      permanente: false,
      motivo: 'indisponivel',
    })
  })

  it('erro de rede é transitório', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('EAI_AGAIN api.resend.com'))
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(client.enviar(mensagem))

    expect(erro).toBeInstanceOf(ErroDeEnvio)
    expect(erro.permanente).toBe(false)
    expect(erro.motivo).toBe('rede')
  })

  it('estouro de tempo é transitório', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(client.enviar(mensagem))

    expect(erro.permanente).toBe(false)
    expect(erro.motivo).toBe('timeout')
  })
})

describe('EmailClient — a chave nunca aparece no erro', () => {
  it('some do corpo ecoado pelo Resend', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respostaErro(401, 'API key re_teste_0123456789 is invalid'))
    const client = criarEmailClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(client.enviar(mensagem))

    expect(erro.message).not.toContain('re_teste_0123456789')
    expect(erro.message).toContain('[oculto]')
  })
})
