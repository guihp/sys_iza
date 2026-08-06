import { describe, expect, it, vi } from 'vitest'
import {
  MAX_TENTATIVAS,
  RECUO_BASE_MS,
  RECUO_MAXIMO_MS,
  despacharPendentes,
  recuoDaProximaTentativa,
  type Deps,
  type JobPendente,
} from '../../worker/dispatch'
import { ErroDeEnvio } from '@/integrations/envio'

/**
 * O despacho é a última porta antes de a mensagem chegar no celular da
 * paciente. Os testes abaixo cobrem, nesta ordem, as quatro coisas que só ele
 * pode garantir: que a mensagem sai, que ela não sai duas vezes, que ela não sai
 * de madrugada, e que uma falha isolada não leva a fila junto.
 *
 * Todos os instantes são escritos em UTC com a hora de São Paulo ao lado —
 * mesma convenção de `tests/domain/quiet-hours.test.ts`.
 */

const jobBase: JobPendente = {
  id: 'j1',
  kind: 'confirmacao',
  channel: 'whatsapp',
  telefone: '+5511987654321',
  email: null,
  assunto: null,
  corpo: 'Olá, Maria!',
  tentativas: 0,
}

function montarDeps(overrides: Partial<Deps> = {}): Deps & {
  reservarPendentes: ReturnType<typeof vi.fn>
  marcarEnviado: ReturnType<typeof vi.fn>
  marcarFalha: ReturnType<typeof vi.fn>
  reagendar: ReturnType<typeof vi.fn>
  whatsapp: { enviarTexto: ReturnType<typeof vi.fn> }
  email: { enviar: ReturnType<typeof vi.fn> }
} {
  return {
    reservarPendentes: vi.fn().mockResolvedValue([jobBase]),
    marcarEnviado: vi.fn().mockResolvedValue(undefined),
    marcarFalha: vi.fn().mockResolvedValue(undefined),
    reagendar: vi.fn().mockResolvedValue(undefined),
    whatsapp: { enviarTexto: vi.fn().mockResolvedValue({ providerMessageId: 'M1' }) },
    email: { enviar: vi.fn().mockResolvedValue({ providerMessageId: 'E1' }) },
    ...overrides,
  } as never
}

/** 14:00 em São Paulo — fora da janela de silêncio. */
const horarioLivre = new Date('2026-08-20T17:00:00Z')
/** 23:00 em São Paulo — dentro da janela de silêncio. */
const horarioSilencio = new Date('2026-08-21T02:00:00Z')

describe('despacharPendentes — envio', () => {
  it('envia pelo WhatsApp e marca como enviado', async () => {
    const deps = montarDeps()
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(deps.whatsapp.enviarTexto).toHaveBeenCalledWith({
      telefone: '+5511987654321',
      texto: 'Olá, Maria!',
    })
    expect(deps.marcarEnviado).toHaveBeenCalledWith('j1', 'M1')
    expect(deps.marcarFalha).not.toHaveBeenCalled()
    expect(resumo).toEqual({ enviados: 1, falhas: 0, desistidos: 0, reagendados: 0 })
  })

  it('envia por e-mail com assunto e corpo em HTML', async () => {
    const deps = montarDeps({
      reservarPendentes: vi.fn().mockResolvedValue([
        {
          ...jobBase,
          channel: 'email',
          email: 'maria@exemplo.com',
          assunto: 'Sua consulta é amanhã',
          corpo: 'Olá, Maria!\nAté amanhã.',
        },
      ]),
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.email.enviar).toHaveBeenCalledWith({
      para: 'maria@exemplo.com',
      assunto: 'Sua consulta é amanhã',
      html: '<p>Olá, Maria!<br>Até amanhã.</p>',
    })
    expect(deps.marcarEnviado).toHaveBeenCalledWith('j1', 'E1')
  })

  it('escapa HTML vindo do cadastro antes de montar o corpo do e-mail', async () => {
    // O nome do paciente entra no corpo pelo template. Um cadastro com `<b>` no
    // nome não pode virar marcação no e-mail de outra pessoa.
    const deps = montarDeps({
      reservarPendentes: vi.fn().mockResolvedValue([
        {
          ...jobBase,
          channel: 'email',
          email: 'maria@exemplo.com',
          assunto: 'Oi',
          corpo: 'Olá, <b>Maria</b> & cia!',
        },
      ]),
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.email.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<p>Olá, &lt;b&gt;Maria&lt;/b&gt; &amp; cia!</p>',
      }),
    )
  })

  it('usa o remetente da clínica quando o template de e-mail não tem assunto', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([
          { ...jobBase, channel: 'email', email: 'maria@exemplo.com', assunto: null },
        ]),
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.email.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ assunto: 'Clínica Dra. Izadora Barros' }),
    )
  })
})

describe('despacharPendentes — janela de silêncio', () => {
  it('não envia nada dentro da janela de silêncio e reagenda para as 09:00', async () => {
    const deps = montarDeps()
    const resumo = await despacharPendentes(deps, horarioSilencio)

    expect(deps.whatsapp.enviarTexto).not.toHaveBeenCalled()
    expect(deps.email.enviar).not.toHaveBeenCalled()
    expect(deps.reagendar).toHaveBeenCalledOnce()
    // 23:00 de 20/08 em SP → 09:00 de 21/08 em SP = 12:00 UTC.
    expect(deps.reagendar.mock.calls[0][1].toISOString()).toBe('2026-08-21T12:00:00.000Z')
    expect(resumo.reagendados).toBe(1)
    expect(resumo.enviados).toBe(0)
  })

  it('reagendar que falha em um job não impede o reagendamento dos outros', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([{ ...jobBase, id: 'j1' }, { ...jobBase, id: 'j2' }]),
      reagendar: vi
        .fn()
        .mockRejectedValueOnce(new Error('conexão caiu'))
        .mockResolvedValueOnce(undefined),
    })
    const resumo = await despacharPendentes(deps, horarioSilencio)

    expect(deps.reagendar).toHaveBeenCalledTimes(2)
    expect(resumo.reagendados).toBe(1)
    expect(resumo.falhas).toBe(1)
  })
})

describe('despacharPendentes — retentativa', () => {
  it('erro permanente marca falha definitiva sem nova tentativa', async () => {
    const deps = montarDeps({
      whatsapp: {
        enviarTexto: vi
          .fn()
          .mockRejectedValue(new ErroDeEnvio('numero invalido', 'destinatario')),
      },
    })
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', {
      erro: expect.stringContaining('numero invalido'),
      definitiva: true,
      proximaTentativa: null,
      tentativas: 1,
    })
    expect(resumo).toEqual({ enviados: 0, falhas: 1, desistidos: 1, reagendados: 0 })
  })

  it('erro transitório mantém o job pendente e recua a próxima tentativa', async () => {
    const deps = montarDeps({
      whatsapp: {
        enviarTexto: vi
          .fn()
          .mockRejectedValue(new ErroDeEnvio('Evolution API respondeu 502', 'indisponivel')),
      },
    })
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', {
      erro: expect.stringContaining('502'),
      definitiva: false,
      // tentativas 0 → esta foi a 1ª: recuo de RECUO_BASE_MS.
      proximaTentativa: new Date(horarioLivre.getTime() + RECUO_BASE_MS),
      tentativas: 1,
    })
    expect(resumo).toEqual({ enviados: 0, falhas: 1, desistidos: 0, reagendados: 0 })
  })

  it('o recuo dobra a cada tentativa já gasta', async () => {
    const deps = montarDeps({
      reservarPendentes: vi.fn().mockResolvedValue([{ ...jobBase, tentativas: 1 }]),
      whatsapp: {
        enviarTexto: vi.fn().mockRejectedValue(new ErroDeEnvio('timeout', 'timeout')),
      },
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.marcarFalha).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({
        definitiva: false,
        proximaTentativa: new Date(horarioLivre.getTime() + RECUO_BASE_MS * 2),
        tentativas: 2,
      }),
    )
  })

  it('desiste ao esgotar o teto de tentativas, mesmo em erro transitório', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([{ ...jobBase, tentativas: MAX_TENTATIVAS - 1 }]),
      whatsapp: {
        enviarTexto: vi.fn().mockRejectedValue(new ErroDeEnvio('502', 'indisponivel')),
      },
    })
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', {
      erro: expect.stringContaining(`${MAX_TENTATIVAS} tentativas`),
      definitiva: true,
      proximaTentativa: null,
      tentativas: MAX_TENTATIVAS,
    })
    expect(resumo.desistidos).toBe(1)
  })

  it('exceção que não é ErroDeEnvio é tratada como transitória', async () => {
    const deps = montarDeps({
      whatsapp: { enviarTexto: vi.fn().mockRejectedValue(new TypeError('boom')) },
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.marcarFalha).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({ definitiva: false, erro: expect.stringContaining('boom') }),
    )
  })

  it('recuoDaProximaTentativa dobra e respeita o teto', () => {
    expect(recuoDaProximaTentativa(1)).toBe(RECUO_BASE_MS)
    expect(recuoDaProximaTentativa(2)).toBe(RECUO_BASE_MS * 2)
    expect(recuoDaProximaTentativa(3)).toBe(RECUO_BASE_MS * 4)
    expect(recuoDaProximaTentativa(50)).toBe(RECUO_MAXIMO_MS)
  })
})

describe('despacharPendentes — destinatário ausente', () => {
  it('job de e-mail sem endereço falha permanentemente e não chama o provedor', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([{ ...jobBase, channel: 'email', email: null, assunto: 'Oi' }]),
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.email.enviar).not.toHaveBeenCalled()
    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', {
      erro: expect.stringContaining('sem e-mail'),
      definitiva: true,
      proximaTentativa: null,
      tentativas: 1,
    })
  })

  it('template ausente ou desligado falha permanentemente sem chamar o provedor', async () => {
    const deps = montarDeps({
      reservarPendentes: vi.fn().mockResolvedValue([{ ...jobBase, corpo: '   ' }]),
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.whatsapp.enviarTexto).not.toHaveBeenCalled()
    expect(deps.marcarFalha).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({
        erro: expect.stringContaining('template de confirmacao/whatsapp'),
        definitiva: true,
      }),
    )
  })

  it('job de WhatsApp sem telefone falha permanentemente e não chama o provedor', async () => {
    const deps = montarDeps({
      reservarPendentes: vi.fn().mockResolvedValue([{ ...jobBase, telefone: null }]),
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.whatsapp.enviarTexto).not.toHaveBeenCalled()
    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', {
      erro: expect.stringContaining('sem telefone'),
      definitiva: true,
      proximaTentativa: null,
      tentativas: 1,
    })
  })
})

describe('despacharPendentes — isolamento entre jobs', () => {
  it('uma falha não impede o envio dos outros jobs', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([{ ...jobBase, id: 'j1' }, { ...jobBase, id: 'j2' }]),
      whatsapp: {
        enviarTexto: vi
          .fn()
          .mockRejectedValueOnce(new ErroDeEnvio('502', 'indisponivel'))
          .mockResolvedValueOnce({ providerMessageId: 'M2' }),
      },
    })
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(deps.marcarEnviado).toHaveBeenCalledWith('j2', 'M2')
    expect(resumo.enviados).toBe(1)
    expect(resumo.falhas).toBe(1)
  })

  it('marcarFalha que também falha não derruba o restante da fila', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([{ ...jobBase, id: 'j1' }, { ...jobBase, id: 'j2' }]),
      whatsapp: {
        enviarTexto: vi
          .fn()
          .mockRejectedValueOnce(new ErroDeEnvio('502', 'indisponivel'))
          .mockResolvedValueOnce({ providerMessageId: 'M2' }),
      },
      marcarFalha: vi.fn().mockRejectedValue(new Error('banco fora do ar')),
    })
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(deps.marcarEnviado).toHaveBeenCalledWith('j2', 'M2')
    expect(resumo.enviados).toBe(1)
  })

  it('falha ao gravar o envio NÃO reagenda o job — a mensagem já saiu', async () => {
    // O pior erro possível deste sistema é a paciente receber duas vezes. Se o
    // provedor aceitou e o banco recusou a gravação, o job não pode voltar para
    // a fila: ele fica reservado até alguém olhar.
    const deps = montarDeps({
      marcarEnviado: vi.fn().mockRejectedValue(new Error('banco fora do ar')),
    })
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(deps.whatsapp.enviarTexto).toHaveBeenCalledOnce()
    expect(deps.marcarFalha).not.toHaveBeenCalled()
    expect(resumo.enviados).toBe(0)
    expect(resumo.falhas).toBe(1)
  })

  it('fila vazia não chama provedor nenhum', async () => {
    const deps = montarDeps({ reservarPendentes: vi.fn().mockResolvedValue([]) })
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(resumo).toEqual({ enviados: 0, falhas: 0, desistidos: 0, reagendados: 0 })
    expect(deps.whatsapp.enviarTexto).not.toHaveBeenCalled()
  })

  it('cada job é despachado uma única vez por ciclo', async () => {
    const deps = montarDeps({
      reservarPendentes: vi
        .fn()
        .mockResolvedValue([
          { ...jobBase, id: 'j1' },
          { ...jobBase, id: 'j2' },
          { ...jobBase, id: 'j3' },
        ]),
    })
    await despacharPendentes(deps, horarioLivre)

    expect(deps.whatsapp.enviarTexto).toHaveBeenCalledTimes(3)
    expect(deps.marcarEnviado.mock.calls.map((c) => c[0])).toEqual(['j1', 'j2', 'j3'])
  })
})
