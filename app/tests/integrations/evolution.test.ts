// @vitest-environment node
//
// Ambiente `node` de propósito: o adaptador se recusa a rodar onde `window`
// existe (ver tests/integrations/isolamento-servidor.test.ts, que prova a
// recusa no jsdom).
import { describe, expect, it, vi } from 'vitest'
import { criarEvolutionClient, ErroDeEnvio } from '@/integrations/evolution/client'

const config = { url: 'http://evolution:8080', apiKey: 'k', instancia: 'clinica' }

/** Resposta de sucesso da Evolution: 200 com o id da mensagem em `key.id`. */
function respostaOk(corpo: unknown) {
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) }
}

/** Resposta de falha: o corpo vem como texto porque nem sempre é JSON. */
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

/**
 * Captura o `ErroDeEnvio` de uma promessa que precisa falhar.
 *
 * Um `.catch((e) => e)` devolveria a união "resultado ou erro" e cada asserção
 * teria de conviver com o tipo do sucesso. Além disso este helper falha quando o
 * envio dá certo — sem ele, um adaptador que parasse de lançar faria o teste
 * passar em silêncio.
 */
async function capturarErro(promessa: Promise<unknown>): Promise<ErroDeEnvio> {
  try {
    await promessa
  } catch (e) {
    if (e instanceof ErroDeEnvio) return e
    throw e
  }
  throw new Error('esperava um ErroDeEnvio, mas o envio foi aceito')
}

describe('EvolutionClient — caminho feliz', () => {
  it('chama o endpoint correto com o número sem o mais', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: 'MSG123' } }))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const r = await client.enviarTexto({ telefone: '+5511987654321', texto: 'Olá' })

    expect(r.providerMessageId).toBe('MSG123')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://evolution:8080/message/sendText/clinica')
    expect((init as RequestInit).headers).toMatchObject({ apikey: 'k' })
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      number: '5511987654321',
      text: 'Olá',
    })
  })

  it('normaliza o telefone pelo lib/phone antes de mandar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: 'MSG9' } }))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    await client.enviarTexto({ telefone: '(11) 98765-4321', texto: 'Olá' })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string).number).toBe('5511987654321')
  })

  it('não duplica a barra quando a url vem com barra no fim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: 'MSG9' } }))
    const client = criarEvolutionClient(
      { ...config, url: 'http://evolution:8080/' },
      fetchMock as unknown as typeof fetch,
    )

    await client.enviarTexto({ telefone: '+5511987654321', texto: 'Olá' })

    expect(fetchMock.mock.calls[0][0]).toBe('http://evolution:8080/message/sendText/clinica')
  })

  it('resposta sem key.id ainda é sucesso, com id vazio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({}))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    await expect(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'Olá' }),
    ).resolves.toEqual({ providerMessageId: '' })
  })

  it('manda um AbortSignal para o envio não ficar pendurado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: 'MSG1' } }))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    await client.enviarTexto({ telefone: '+5511987654321', texto: 'x' })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('EvolutionClient — erro permanente', () => {
  it('trata 400 como erro permanente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(400, 'numero invalido'))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    await expect(client.enviarTexto({ telefone: '+55119', texto: 'x' })).rejects.toMatchObject({
      permanente: true,
    })
  })

  it('número que não existe no WhatsApp é permanente', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        respostaErro(
          400,
          '{"response":{"message":["O número 5511999999999 não existe no WhatsApp"]}}',
        ),
      )
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511999999999', texto: 'x' }),
    )

    expect(erro.permanente).toBe(true)
    expect(erro.motivo).toBe('requisicao')
    expect(erro.status).toBe(400)
    expect(erro.message).toContain('não existe no WhatsApp')
  })

  it('401 de chave errada é permanente e marcado como credencial', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(401, 'Unauthorized'))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.permanente).toBe(true)
    expect(erro.motivo).toBe('credencial')
  })

  it('404 de instância inexistente é permanente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(404, 'instance not found'))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.permanente).toBe(true)
    expect(erro.motivo).toBe('requisicao')
  })

  it('telefone impossível falha antes de gastar uma requisição', async () => {
    const fetchMock = vi.fn()
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(client.enviarTexto({ telefone: '123', texto: 'x' }))

    expect(erro.permanente).toBe(true)
    expect(erro.motivo).toBe('destinatario')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('texto em branco falha antes de gastar uma requisição', async () => {
    const fetchMock = vi.fn()
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: '   ' }),
    )

    expect(erro.permanente).toBe(true)
    expect(erro.motivo).toBe('requisicao')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('200 com corpo que não é JSON não é retentado, para não duplicar a mensagem', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
      text: async () => '<html>ok</html>',
    })
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.motivo).toBe('resposta')
    expect(erro.permanente).toBe(true)
    expect(erro.message).toContain('não será reenviada')
  })
})

describe('EvolutionClient — erro transitório', () => {
  it('trata 500 como erro temporário', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(500, 'indisponivel'))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    await expect(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    ).rejects.toMatchObject({ permanente: false })
  })

  it('429 é transitório mesmo sendo 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(429, 'rate limit'))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.permanente).toBe(false)
    expect(erro.motivo).toBe('limite')
  })

  it('502 com página HTML de proxy não quebra a leitura do corpo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        respostaErro(502, '<html><head><title>502 Bad Gateway</title></head></html>'),
      )
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.permanente).toBe(false)
    expect(erro.motivo).toBe('indisponivel')
    expect(erro.message).toContain('502')
  })

  it('erro de rede é temporário', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro).toBeInstanceOf(ErroDeEnvio)
    expect(erro.permanente).toBe(false)
    expect(erro.motivo).toBe('rede')
    expect(erro.message).toContain('ECONNREFUSED')
  })

  it('desembrulha a causa real do fetch, que vem envelopada', async () => {
    const envelopado = Object.assign(new Error('fetch failed'), {
      cause: new Error('getaddrinfo ENOTFOUND evolution'),
    })
    const fetchMock = vi.fn().mockRejectedValue(envelopado)
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.motivo).toBe('rede')
    expect(erro.message).toContain('ENOTFOUND')
  })

  it('estouro de tempo é temporário', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    })
    const fetchMock = vi.fn().mockRejectedValue(timeout)
    const client = criarEvolutionClient(
      { ...config, timeoutMs: 2_000 },
      fetchMock as unknown as typeof fetch,
    )

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.permanente).toBe(false)
    expect(erro.motivo).toBe('timeout')
    expect(erro.message).toContain('2000')
  })
})

describe('EvolutionClient — a chave nunca aparece no erro', () => {
  const chave = 'evo-Sup3rS3cr3t-9911'
  const comChave = { ...config, apiKey: chave }

  it('some do corpo ecoado pelo provedor', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respostaErro(403, `apikey ${chave} não autorizada para esta instância`))
    const client = criarEvolutionClient(comChave, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.message).not.toContain(chave)
    expect(erro.message).toContain('[oculto]')
  })

  it('some da mensagem de erro de rede', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error(`connect ECONNREFUSED (apikey=${chave})`))
    const client = criarEvolutionClient(comChave, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.message).not.toContain(chave)
  })

  it('o erro não carrega a exceção original, que traria a requisição inteira junto', async () => {
    const original = Object.assign(new Error('fetch failed'), {
      cause: new Error(`headers: apikey ${chave}`),
    })
    const fetchMock = vi.fn().mockRejectedValue(original)
    const client = criarEvolutionClient(comChave, fetchMock as unknown as typeof fetch)

    const erro = await capturarErro(
      client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }),
    )

    expect(erro.cause).toBeUndefined()
    expect(JSON.stringify(erro, Object.getOwnPropertyNames(erro))).not.toContain(chave)
  })
})
