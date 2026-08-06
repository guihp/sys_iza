import { describe, expect, it } from 'vitest'
import {
  type EntradaDoFunil,
  type EstagioFunil,
  chaveDaConversao,
  eventIdDaConversao,
  planejarConversoes,
} from '@/domain/marketing/plan-conversions'
import { hashTelefone } from '@/domain/marketing/hash'

const AGORA = new Date('2026-08-06T17:00:00Z')

const base: EntradaDoFunil = {
  patientId: 'pa-1',
  estagioAnterior: 'lead',
  estagioNovo: 'contato',
  consentimentoLgpdEm: new Date('2026-08-05T12:00:00Z'),
  ctwaClid: 'ARAaBBccDD-clid',
  telefoneE164: '+5511987654321',
  ocorridoEm: AGORA,
}

function eventos(entrada: Partial<EntradaDoFunil>) {
  return planejarConversoes({ ...base, ...entrada }).map((c) => c.evento)
}

// ---------------------------------------------------------------------------
// As duas travas
// ---------------------------------------------------------------------------

describe('trava de consentimento (LGPD art. 11)', () => {
  it('sem consentimento_lgpd_em, nenhum evento sai', () => {
    expect(planejarConversoes({ ...base, consentimentoLgpdEm: null })).toEqual([])
  })

  it('a trava vale para todo estágio, inclusive o mais raso', () => {
    for (const estagio of ['lead', 'contato', 'agendado', 'compareceu', 'paciente'] as const) {
      expect(
        planejarConversoes({
          ...base,
          estagioAnterior: null,
          estagioNovo: estagio,
          consentimentoLgpdEm: null,
        }),
      ).toEqual([])
    }
  })

  it('string ISO vazia ou só espaço não é consentimento', () => {
    expect(planejarConversoes({ ...base, consentimentoLgpdEm: '' })).toEqual([])
    expect(planejarConversoes({ ...base, consentimentoLgpdEm: '   ' })).toEqual([])
  })

  it('data inválida não é consentimento', () => {
    expect(planejarConversoes({ ...base, consentimentoLgpdEm: new Date('nada') })).toEqual([])
  })

  it('a string ISO que vem do Supabase vale como consentimento', () => {
    expect(eventos({ consentimentoLgpdEm: '2026-08-05T12:00:00+00:00' })).toEqual(['Contact'])
  })
})

describe('trava de atribuição', () => {
  it('sem ctwa_clid, nenhum evento sai', () => {
    expect(planejarConversoes({ ...base, ctwaClid: null })).toEqual([])
  })

  it('clid em branco não conta como atribuição', () => {
    expect(planejarConversoes({ ...base, ctwaClid: '   ' })).toEqual([])
  })

  it('a trava vale mesmo com consentimento em dia', () => {
    expect(
      planejarConversoes({
        ...base,
        estagioNovo: 'paciente',
        estagioAnterior: 'compareceu',
        valorCentavos: 180_000,
        ctwaClid: null,
      }),
    ).toEqual([])
  })

  it('o clid sai com as bordas aparadas', () => {
    const [conversao] = planejarConversoes({ ...base, ctwaClid: '  clid-x  ' })
    expect(conversao.ctwaClid).toBe('clid-x')
  })
})

// ---------------------------------------------------------------------------
// Mapa de estágios
// ---------------------------------------------------------------------------

describe('mapa de estágio → evento', () => {
  const casos: Array<[EstagioFunil, EstagioFunil, string[]]> = [
    ['lead', 'contato', ['Contact']],
    ['contato', 'agendado', ['Schedule']],
    ['agendado', 'compareceu', ['CompleteRegistration']],
    ['compareceu', 'paciente', ['Purchase']],
  ]

  it.each(casos)('%s → %s produz %j', (anterior, novo, esperado) => {
    expect(eventos({ estagioAnterior: anterior, estagioNovo: novo })).toEqual(esperado)
  })

  it('paciente nova cadastrada já como lead gera o Lead', () => {
    expect(eventos({ estagioAnterior: null, estagioNovo: 'lead' })).toEqual(['Lead'])
  })

  it('descartado não gera evento nenhum', () => {
    expect(eventos({ estagioAnterior: 'contato', estagioNovo: 'descartado' })).toEqual([])
  })

  it('retorno não gera evento — é retenção, não aquisição', () => {
    // O anúncio já foi creditado com o Purchase dela. Um segundo evento contaria
    // a mesma pessoa duas vezes na receita atribuída.
    expect(eventos({ estagioAnterior: 'paciente', estagioNovo: 'retorno' })).toEqual([])
  })

  it('sair de retorno para agendar acompanhamento não gera evento', () => {
    // `retorno` é lido como se fosse `paciente`, então isto é retrocesso.
    expect(eventos({ estagioAnterior: 'retorno', estagioNovo: 'agendado' })).toEqual([])
  })
})

describe('pulo de estágio', () => {
  it('lead → agendado gera os intermediários', () => {
    // A pessoa manda mensagem pelo anúncio e marca na mesma conversa: a
    // secretária toca o cartão uma vez só. Sem os intermediários o Gerenciador
    // mostraria mais agendamentos do que contatos.
    expect(eventos({ estagioAnterior: 'lead', estagioNovo: 'agendado' })).toEqual([
      'Contact',
      'Schedule',
    ])
  })

  it('cadastro direto em paciente gera a escada inteira, na ordem', () => {
    expect(eventos({ estagioAnterior: null, estagioNovo: 'paciente' })).toEqual([
      'Lead',
      'Contact',
      'Schedule',
      'CompleteRegistration',
      'Purchase',
    ])
  })

  it('lead descartado que volta sobe a escada do zero', () => {
    expect(eventos({ estagioAnterior: 'descartado', estagioNovo: 'agendado' })).toEqual([
      'Lead',
      'Contact',
      'Schedule',
    ])
  })

  it('todos os eventos do pulo carregam o mesmo instante', () => {
    const conversoes = planejarConversoes({
      ...base,
      estagioAnterior: null,
      estagioNovo: 'paciente',
    })
    for (const conversao of conversoes) {
      expect(conversao.ocorridoEm).toBe(AGORA)
    }
  })
})

describe('retrocesso', () => {
  it('agendado → contato não gera evento', () => {
    expect(eventos({ estagioAnterior: 'agendado', estagioNovo: 'contato' })).toEqual([])
  })

  it('paciente → lead não gera evento', () => {
    expect(eventos({ estagioAnterior: 'paciente', estagioNovo: 'lead' })).toEqual([])
  })

  it('ficar no mesmo estágio não gera evento', () => {
    expect(eventos({ estagioAnterior: 'agendado', estagioNovo: 'agendado' })).toEqual([])
  })

  it('voltar e avançar de novo replaneja a mesma chave — o banco vira no-op', () => {
    // O módulo é sem memória de propósito: quem impede a duplicata é o `unique`
    // de meta_conversion_jobs.chave_idempotencia, não uma checagem daqui.
    const entrada: EntradaDoFunil = { ...base, estagioAnterior: 'contato', estagioNovo: 'agendado' }
    const primeira = planejarConversoes(entrada)
    expect(eventos({ estagioAnterior: 'agendado', estagioNovo: 'contato' })).toEqual([])
    const segunda = planejarConversoes(entrada)

    expect(segunda[0].chaveIdempotencia).toBe(primeira[0].chaveIdempotencia)
    expect(segunda[0].eventId).toBe(primeira[0].eventId)
  })
})

// ---------------------------------------------------------------------------
// Identidade do evento
// ---------------------------------------------------------------------------

describe('chave e event_id', () => {
  it('a chave é legível e sai de (patient_id, evento)', () => {
    const [conversao] = planejarConversoes({ ...base, estagioNovo: 'contato' })
    expect(conversao.chaveIdempotencia).toBe('pa-1:Contact')
    expect(conversao.chaveIdempotencia).toBe(chaveDaConversao('pa-1', 'Contact'))
  })

  it('o event_id é o SHA-256 da chave — estável e opaco', () => {
    const [conversao] = planejarConversoes({ ...base, estagioNovo: 'contato' })
    expect(conversao.eventId).toBe(eventIdDaConversao('pa-1', 'Contact'))
    expect(conversao.eventId).toMatch(/^[0-9a-f]{64}$/)
    // O uuid interno da paciente não atravessa para o terceiro.
    expect(conversao.eventId).not.toContain('pa-1')
  })

  it('é determinístico: replanejar devolve o mesmo id', () => {
    const primeiro = planejarConversoes({ ...base, ocorridoEm: new Date('2026-01-01T00:00:00Z') })
    const segundo = planejarConversoes({ ...base, ocorridoEm: new Date('2026-12-31T23:59:59Z') })
    // O instante muda; a identidade do evento, não — é o que faz a Meta
    // deduplicar a retentativa.
    expect(segundo[0].eventId).toBe(primeiro[0].eventId)
  })

  it('eventos diferentes da mesma paciente têm ids diferentes', () => {
    const conversoes = planejarConversoes({
      ...base,
      estagioAnterior: null,
      estagioNovo: 'paciente',
    })
    const ids = new Set(conversoes.map((c) => c.eventId))
    expect(ids.size).toBe(conversoes.length)
  })

  it('pacientes diferentes no mesmo evento têm ids diferentes', () => {
    const [uma] = planejarConversoes({ ...base, patientId: 'pa-1' })
    const [outra] = planejarConversoes({ ...base, patientId: 'pa-2' })
    expect(uma.eventId).not.toBe(outra.eventId)
  })
})

// ---------------------------------------------------------------------------
// Identificadores e valor
// ---------------------------------------------------------------------------

describe('identificadores', () => {
  it('o telefone sai com hash, nunca em claro', () => {
    const [conversao] = planejarConversoes(base)
    expect(conversao.telefoneHash).toBe(hashTelefone('+5511987654321'))
    expect(JSON.stringify(conversao)).not.toContain('5511987654321')
    expect(JSON.stringify(conversao)).not.toContain('987654321')
  })

  it('sem telefone cadastrado o campo vem null, não hash de vazio', () => {
    const [conversao] = planejarConversoes({ ...base, telefoneE164: null })
    expect(conversao.telefoneHash).toBeNull()
  })
})

describe('valor do Purchase', () => {
  it('só o Purchase carrega valor e moeda', () => {
    const conversoes = planejarConversoes({
      ...base,
      estagioAnterior: null,
      estagioNovo: 'paciente',
      valorCentavos: 184_700,
    })

    for (const conversao of conversoes) {
      if (conversao.evento === 'Purchase') {
        expect(conversao.valor).toBe(1_800)
        expect(conversao.moeda).toBe('BRL')
      } else {
        expect(conversao.valor).toBeNull()
        expect(conversao.moeda).toBeNull()
      }
    }
  })

  it('o valor sai arredondado à centena, não exato', () => {
    // O preço exato do catálogo identificaria o procedimento para quem tem a
    // tabela de preços. É a mitigação da restrição legal do plano.
    const [purchase] = planejarConversoes({
      ...base,
      estagioAnterior: 'compareceu',
      estagioNovo: 'paciente',
      valorCentavos: 184_700,
    })
    expect(purchase.valor).toBe(1_800)
    expect(purchase.valor).not.toBe(1_847)
  })

  it('sem valor conhecido o Purchase sai com zero, e não deixa de sair', () => {
    const [purchase] = planejarConversoes({
      ...base,
      estagioAnterior: 'compareceu',
      estagioNovo: 'paciente',
    })
    expect(purchase.evento).toBe('Purchase')
    expect(purchase.valor).toBe(0)
    expect(purchase.moeda).toBe('BRL')
  })

  it('valor e moeda andam juntos — nunca um sem o outro', () => {
    const conversoes = planejarConversoes({
      ...base,
      estagioAnterior: null,
      estagioNovo: 'paciente',
      valorCentavos: 250_000,
    })
    for (const conversao of conversoes) {
      expect(conversao.valor === null).toBe(conversao.moeda === null)
    }
  })
})

// ---------------------------------------------------------------------------
// A prova de que nada de prontuário vaza
// ---------------------------------------------------------------------------

describe('nada de prontuário no evento', () => {
  /** O que existiria no cadastro e no prontuário e não pode chegar à Meta. */
  const CONTRABANDO = {
    procedimento: 'Toxina Botulínica',
    observacoes: 'Paciente relatou hematoma na região frontal',
    anamnese: 'Nega alergias; uso contínuo de anticoncepcional',
    nomeCompleto: 'Maria Aparecida de Souza',
    telefoneE164Bruto: '+5511987654321',
    cpf: '123.456.789-00',
    diagnostico: 'melasma',
  }

  it('a entrada sequer aceita campo de prontuário — e o que passar por cima não sai', () => {
    // O `as` é o cenário de pior caso: alguém futuramente montando a entrada a
    // partir de um spread da linha inteira do banco. O tipo já recusaria isso em
    // compilação; este teste garante que, mesmo forçado, nada disso atravessa.
    const conversoes = planejarConversoes({
      ...base,
      ...CONTRABANDO,
      estagioAnterior: null,
      estagioNovo: 'paciente',
      valorCentavos: 184_700,
    } as unknown as EntradaDoFunil)

    expect(conversoes.length).toBe(5)

    const serializado = JSON.stringify(conversoes)
    for (const valor of Object.values(CONTRABANDO)) {
      expect(serializado).not.toContain(valor)
    }
  })

  it('o evento tem exatamente os campos previstos, e nenhum a mais', () => {
    // Trava contra o crescimento silencioso do payload: acrescentar um campo ao
    // tipo obriga a passar por aqui e a justificá-lo.
    const [conversao] = planejarConversoes({ ...base, estagioNovo: 'contato' })
    expect(Object.keys(conversao).sort()).toEqual(
      [
        'chaveIdempotencia',
        'ctwaClid',
        'eventId',
        'evento',
        'moeda',
        'ocorridoEm',
        'patientId',
        'telefoneHash',
        'valor',
      ].sort(),
    )
  })

  it('nenhum campo de texto livre atravessa: só id, hash, número e data', () => {
    const [conversao] = planejarConversoes({
      ...base,
      estagioAnterior: 'compareceu',
      estagioNovo: 'paciente',
      valorCentavos: 184_700,
    })

    // Os únicos textos são identificadores: o uuid da paciente (que fica em
    // casa — ver a chave), o nome do evento, a moeda, o clid e o hash.
    expect(conversao.evento).toBe('Purchase')
    expect(conversao.moeda).toBe('BRL')
    expect(typeof conversao.valor).toBe('number')
    expect(conversao.ocorridoEm).toBeInstanceOf(Date)
    expect(conversao.telefoneHash).toMatch(/^[0-9a-f]{64}$/)
    expect(conversao.eventId).toMatch(/^[0-9a-f]{64}$/)
  })
})
