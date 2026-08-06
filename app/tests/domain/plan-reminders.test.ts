import { describe, expect, it } from 'vitest'
import {
  consentimentoDeContato,
  planejarLembretes,
  planejarLembretesPosAtendimento,
} from '@/domain/reminders/plan-reminders'
import { diaDeCalendario } from '@/lib/datetime'

/**
 * `agora` é sempre explícito nos testes. Sem isso a suíte passaria hoje e
 * quebraria sozinha em 20/08/2026, quando a consulta de referência virasse
 * passado e o descarte de lembrete vencido zerasse os resultados.
 */
const AGORA = new Date('2026-08-01T12:00:00Z')

const base = {
  appointmentId: 'ap-1',
  patientId: 'pa-1',
  inicio: new Date('2026-08-20T17:00:00Z'), // 14h em SP
  aceitaWhatsapp: true,
  aceitaEmail: true,
  agora: AGORA,
}

describe('consentimentoDeContato', () => {
  const contato = {
    aceitaWhatsapp: true,
    aceitaEmail: true,
    telefone: '+5511999998888',
    email: 'maria@exemplo.com',
  }

  it('libera os dois canais quando há consentimento e endereço', () => {
    expect(consentimentoDeContato(contato)).toEqual({ aceitaWhatsapp: true, aceitaEmail: true })
  })

  it('fecha o canal recusado pelo paciente', () => {
    expect(consentimentoDeContato({ ...contato, aceitaWhatsapp: false })).toEqual({
      aceitaWhatsapp: false,
      aceitaEmail: true,
    })
  })

  it('fecha o canal sem endereço, mesmo com consentimento', () => {
    expect(consentimentoDeContato({ ...contato, telefone: null, email: null })).toEqual({
      aceitaWhatsapp: false,
      aceitaEmail: false,
    })
  })

  it('trata string vazia como ausência de endereço', () => {
    expect(consentimentoDeContato({ ...contato, email: '  ' }).aceitaEmail).toBe(false)
  })
})

describe('planejarLembretes', () => {
  it('gera confirmação por whatsapp e por e-mail, e a véspera curta', () => {
    const jobs = planejarLembretes(base)
    const tipos = jobs.map((j) => `${j.kind}:${j.channel}`)
    expect(tipos).toContain('confirmacao:whatsapp')
    expect(tipos).toContain('confirmacao:email')
    expect(tipos).toContain('vespera_curta:whatsapp')
    expect(tipos).not.toContain('vespera_curta:email')
    expect(jobs).toHaveLength(3)
  })

  it('confirmação sai às 09:00 de São Paulo do dia anterior', () => {
    const job = planejarLembretes(base).find(
      (j) => j.kind === 'confirmacao' && j.channel === 'whatsapp',
    )!
    expect(job.agendadoPara.toISOString()).toBe('2026-08-19T12:00:00.000Z')
  })

  it('véspera curta sai 3 horas antes', () => {
    const job = planejarLembretes(base).find((j) => j.kind === 'vespera_curta')!
    expect(job.agendadoPara.toISOString()).toBe('2026-08-20T14:00:00.000Z')
  })

  it('respeita opt-out de e-mail', () => {
    const jobs = planejarLembretes({ ...base, aceitaEmail: false })
    expect(jobs.every((j) => j.channel !== 'email')).toBe(true)
  })

  it('respeita opt-out de whatsapp, e aí não há véspera curta nenhuma', () => {
    const jobs = planejarLembretes({ ...base, aceitaWhatsapp: false })
    expect(jobs.map((j) => `${j.kind}:${j.channel}`)).toEqual(['confirmacao:email'])
  })

  it('não gera nada quando o paciente recusou os dois canais', () => {
    expect(planejarLembretes({ ...base, aceitaEmail: false, aceitaWhatsapp: false })).toHaveLength(0)
  })

  it('chave de idempotência é única por consulta, tipo e canal', () => {
    const chaves = planejarLembretes(base).map((j) => j.chaveIdempotencia)
    expect(new Set(chaves).size).toBe(chaves.length)
    expect(chaves).toContain('ap-1:confirmacao:whatsapp')
    expect(chaves).toContain('ap-1:vespera_curta:whatsapp')
  })

  it('carrega o vínculo com a consulta e nenhum com atendimento', () => {
    for (const job of planejarLembretes(base)) {
      expect(job.appointmentId).toBe('ap-1')
      expect(job.attendanceId).toBeNull()
      expect(job.patientId).toBe('pa-1')
    }
  })

  describe('lembrete cujo instante já passou', () => {
    it('descarta a confirmação quando a consulta é para hoje', () => {
      // 11:00 em SP do próprio dia da consulta: as 09:00 de véspera já foram.
      const jobs = planejarLembretes({ ...base, agora: new Date('2026-08-20T14:00:00Z') })
      expect(jobs.map((j) => j.kind)).toEqual([])
    })

    it('mantém a véspera curta que ainda está no futuro', () => {
      // 10:00 em SP: a véspera curta (11:00 em SP) ainda não passou.
      const jobs = planejarLembretes({ ...base, agora: new Date('2026-08-20T13:00:00Z') })
      expect(jobs.map((j) => `${j.kind}:${j.channel}`)).toEqual(['vespera_curta:whatsapp'])
    })

    it('não gera nada para consulta marcada em cima da hora', () => {
      expect(planejarLembretes({ ...base, agora: new Date('2026-08-20T16:30:00Z') })).toHaveLength(0)
    })
  })

  describe('fuso', () => {
    it('a confirmação usa o dia de calendário da CLÍNICA, não o do UTC', () => {
      // 2026-08-20T02:00Z = 23:00 de 19/08 em SP. O dia da consulta é 19/08 na
      // clínica e 20/08 em UTC — a véspera é 18/08, não 19/08.
      const job = planejarLembretes({
        ...base,
        inicio: new Date('2026-08-20T02:00:00Z'),
      }).find((j) => j.kind === 'confirmacao')!
      expect(job.agendadoPara.toISOString()).toBe('2026-08-18T12:00:00.000Z')
    })

    it('sob horário de verão a confirmação sai às 09:00 locais (UTC-2)', () => {
      // 2018-02-14T16:00Z = 14:00 em SP sob horário de verão.
      const job = planejarLembretes({
        ...base,
        inicio: new Date('2018-02-14T16:00:00Z'),
        agora: new Date('2018-02-01T12:00:00Z'),
      }).find((j) => j.kind === 'confirmacao')!
      expect(job.agendadoPara.toISOString()).toBe('2018-02-13T11:00:00.000Z')
    })
  })
})

describe('planejarLembretesPosAtendimento', () => {
  const pos = {
    attendanceId: 'at-1',
    patientId: 'pa-1',
    realizadoEm: new Date('2026-08-20T17:00:00Z'),
    retornoVencimento: new Date('2026-12-18T12:00:00Z') as Date | null,
    aceitaWhatsapp: true,
    aceitaEmail: true,
    agora: new Date('2026-08-20T17:00:00Z'),
  }

  it('agenda cuidados em 24h e avaliação em 7 dias', () => {
    const jobs = planejarLembretesPosAtendimento(pos)
    const cuidados = jobs.find((j) => j.kind === 'pos_procedimento')!
    const avaliacao = jobs.find((j) => j.kind === 'avaliacao')!
    expect(cuidados.agendadoPara.toISOString()).toBe('2026-08-21T17:00:00.000Z')
    expect(avaliacao.agendadoPara.toISOString()).toBe('2026-08-27T17:00:00.000Z')
  })

  it('cuidados e avaliação são só por whatsapp', () => {
    const jobs = planejarLembretesPosAtendimento(pos)
    for (const job of jobs) {
      if (job.kind === 'pos_procedimento' || job.kind === 'avaliacao') {
        expect(job.channel).toBe('whatsapp')
      }
    }
    expect(jobs.filter((j) => j.kind === 'pos_procedimento')).toHaveLength(1)
    expect(jobs.filter((j) => j.kind === 'avaliacao')).toHaveLength(1)
  })

  it('agenda o retorno 7 dias antes do vencimento, às 09:00 locais', () => {
    const retorno = planejarLembretesPosAtendimento(pos).filter((j) => j.kind === 'retorno')
    expect(retorno.map((j) => j.channel).sort()).toEqual(['email', 'whatsapp'])
    expect(retorno[0].agendadoPara.toISOString()).toBe('2026-12-11T12:00:00.000Z')
  })

  it('lê o vencimento como dia de calendário, do jeito que diaDeCalendario ancora', () => {
    const retorno = planejarLembretesPosAtendimento({
      ...pos,
      retornoVencimento: diaDeCalendario('2026-12-18'),
    }).find((j) => j.kind === 'retorno')!
    expect(retorno.agendadoPara.toISOString()).toBe('2026-12-11T12:00:00.000Z')
  })

  it('sem vencimento não gera lembrete de retorno', () => {
    const jobs = planejarLembretesPosAtendimento({ ...pos, retornoVencimento: null })
    expect(jobs.some((j) => j.kind === 'retorno')).toBe(false)
    expect(jobs).toHaveLength(2)
  })

  it('descarta o retorno de um vencimento perto demais para caber a antecedência', () => {
    // Vencimento em 3 dias: as "7 dias antes" caem no passado.
    const jobs = planejarLembretesPosAtendimento({
      ...pos,
      retornoVencimento: diaDeCalendario('2026-08-23'),
    })
    expect(jobs.some((j) => j.kind === 'retorno')).toBe(false)
  })

  it('respeita opt-out de whatsapp: sobra só o retorno por e-mail', () => {
    const jobs = planejarLembretesPosAtendimento({ ...pos, aceitaWhatsapp: false })
    expect(jobs.map((j) => `${j.kind}:${j.channel}`)).toEqual(['retorno:email'])
  })

  it('não gera nada quando o paciente recusou os dois canais', () => {
    expect(
      planejarLembretesPosAtendimento({ ...pos, aceitaWhatsapp: false, aceitaEmail: false }),
    ).toHaveLength(0)
  })

  it('chave de idempotência é única por atendimento, tipo e canal', () => {
    const chaves = planejarLembretesPosAtendimento(pos).map((j) => j.chaveIdempotencia)
    expect(new Set(chaves).size).toBe(chaves.length)
    expect(chaves).toContain('at-1:pos_procedimento:whatsapp')
    expect(chaves).toContain('at-1:avaliacao:whatsapp')
    expect(chaves).toContain('at-1:retorno:email')
  })

  it('carrega o vínculo com o atendimento e nenhum com a agenda', () => {
    for (const job of planejarLembretesPosAtendimento(pos)) {
      expect(job.attendanceId).toBe('at-1')
      expect(job.appointmentId).toBeNull()
    }
  })
})
