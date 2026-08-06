import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  GATILHOS,
  VARIAVEIS_CONHECIDAS,
  avisosDeVariaveis,
  exemploDoGatilho,
  previaDoTemplate,
  validarTemplate,
} from '@/app/(app)/configuracoes/mensagens/mensagens'

/**
 * Estas regras existem para que o editor recuse antes do banco recusar.
 *
 * As três checagens de `validarTemplate` são as mesmas três constraints da
 * migration 0007 (`templates_corpo_nao_vazio` e `templates_email_tem_assunto`).
 * Se elas divergirem, a Dra. clica em Salvar e recebe um erro de Postgres em
 * inglês no lugar de uma frase que diz o que corrigir.
 */
describe('validarTemplate — o que o banco recusaria', () => {
  it('recusa corpo em branco', () => {
    const r = validarTemplate({
      kind: 'confirmacao',
      channel: 'whatsapp',
      assunto: null,
      corpo: '   \n  ',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/em branco/i)
  })

  it('recusa e-mail sem assunto', () => {
    const r = validarTemplate({
      kind: 'confirmacao',
      channel: 'email',
      assunto: '   ',
      corpo: 'Olá, {{nome}}!',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/assunto/i)
  })

  it('recusa e-mail com assunto nulo', () => {
    const r = validarTemplate({
      kind: 'retorno',
      channel: 'email',
      assunto: null,
      corpo: 'Olá, {{nome}}!',
    })
    expect(r.ok).toBe(false)
  })

  it('aceita e-mail com assunto e devolve os dois campos aparados', () => {
    const r = validarTemplate({
      kind: 'retorno',
      channel: 'email',
      assunto: '  Seu retorno está chegando  ',
      corpo: '  Olá, {{nome}}!  ',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.assunto).toBe('Seu retorno está chegando')
      expect(r.valor.corpo).toBe('Olá, {{nome}}!')
    }
  })

  it('zera o assunto no whatsapp: o banco exige nulo', () => {
    const r = validarTemplate({
      kind: 'vespera_curta',
      channel: 'whatsapp',
      assunto: 'assunto que não deveria existir',
      corpo: 'Oi, {{nome}}!',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor.assunto).toBeNull()
  })

  it('recusa par kind/channel que o planejador nunca produz', () => {
    // Não existe lembrete de véspera curta por e-mail (ver plan-reminders):
    // salvar um texto para ele criaria uma oitava linha que ninguém envia.
    const r = validarTemplate({
      kind: 'vespera_curta',
      channel: 'email',
      assunto: 'oi',
      corpo: 'Oi, {{nome}}!',
    })
    expect(r.ok).toBe(false)
  })
})

describe('avisosDeVariaveis', () => {
  it('não avisa nada quando o texto usa só o que o gatilho oferece', () => {
    expect(
      avisosDeVariaveis('Olá, {{nome}}! Sua consulta é {{data}} às {{hora}}.', 'confirmacao'),
    ).toEqual([])
  })

  it('aponta o erro de digitação como variável desconhecida', () => {
    expect(avisosDeVariaveis('Como foi seu {{procedimeto}}?', 'pos_procedimento')).toEqual([
      { nome: 'procedimeto', motivo: 'desconhecida' },
    ])
  })

  it('aponta variável real que este gatilho não alimenta', () => {
    // `data` e `hora` vêm da consulta; o pós-procedimento nasce do atendimento e
    // sairia com um buraco no meio da frase.
    expect(avisosDeVariaveis('Amanhã, {{data}}, às {{hora}}.', 'pos_procedimento')).toEqual([
      { nome: 'data', motivo: 'indisponivel' },
      { nome: 'hora', motivo: 'indisponivel' },
    ])
  })

  it('não repete a mesma variável citada duas vezes', () => {
    expect(avisosDeVariaveis('{{xyz}} e de novo {{xyz}}', 'avaliacao')).toEqual([
      { nome: 'xyz', motivo: 'desconhecida' },
    ])
  })

  it('data_retorno é legítima no gatilho de retorno', () => {
    expect(avisosDeVariaveis('Retorno em {{data_retorno}}', 'retorno')).toEqual([])
  })
})

describe('previaDoTemplate', () => {
  it('renderiza com o mesmo formato de data que o worker usa', () => {
    const previa = previaDoTemplate({
      kind: 'confirmacao',
      channel: 'email',
      assunto: 'Sua consulta é amanhã, {{data}}',
      corpo: 'Olá, {{nome}}! Às {{hora}}.',
    })
    expect(previa.assunto).toBe('Sua consulta é amanhã, 20 de agosto')
    expect(previa.corpo).toBe('Olá, Maria! Às 14:00.')
  })

  it('deixa em branco a variável que o gatilho não alimenta, como no envio real', () => {
    const previa = previaDoTemplate({
      kind: 'avaliacao',
      channel: 'whatsapp',
      assunto: null,
      corpo: 'Faz uma semana do seu {{procedimento}}. Consulta em {{data}}.',
    })
    expect(previa.corpo).toBe('Faz uma semana do seu Toxina botulínica. Consulta em .')
    expect(previa.assunto).toBeNull()
  })

  it('retorno mostra a data de retorno com ano', () => {
    const previa = previaDoTemplate({
      kind: 'retorno',
      channel: 'whatsapp',
      assunto: null,
      corpo: 'Seu retorno é em {{data_retorno}}.',
    })
    expect(previa.corpo).toBe('Seu retorno é em 18 de dezembro de 2026.')
  })
})

describe('catálogo de gatilhos', () => {
  it('descreve os sete pares que a migration semeia, nesta ordem', () => {
    expect(GATILHOS.flatMap((g) => g.canais.map((c) => `${g.kind}/${c}`))).toEqual([
      'confirmacao/whatsapp',
      'confirmacao/email',
      'vespera_curta/whatsapp',
      'pos_procedimento/whatsapp',
      'avaliacao/whatsapp',
      'retorno/whatsapp',
      'retorno/email',
    ])
  })

  it('toda variável de exemplo é uma variável conhecida', () => {
    for (const gatilho of GATILHOS) {
      for (const nome of Object.keys(exemploDoGatilho(gatilho.kind))) {
        expect(VARIAVEIS_CONHECIDAS).toContain(nome)
      }
    }
  })

  it('todo gatilho oferece ao menos o nome do paciente', () => {
    for (const gatilho of GATILHOS) {
      expect(gatilho.variaveis).toContain('nome')
    }
  })
})

/**
 * Checagem estática da autorização, no mesmo espírito de
 * `tests/integrations/isolamento-servidor.test.ts`.
 *
 * Renderizar uma página com `requireSessao` e `notFound` exigiria um mock do
 * Next inteiro para provar o que uma leitura do fonte já prova. O que importa
 * aqui é que a guarda não desapareça numa refatoração distraída — o menu já
 * esconde o link (ver `tests/components/app-shell.test.tsx`), e esconder link
 * não é autorização.
 */
describe('a tela de mensagens é da dra', () => {
  const pasta = path.resolve(process.cwd(), 'src/app/(app)/configuracoes/mensagens')
  const ler = (arquivo: string) => readFileSync(path.join(pasta, arquivo), 'utf8')

  it('a página some para quem não é dra', () => {
    const fonte = ler('page.tsx')
    expect(fonte).toMatch(/role !== 'dra'/)
    expect(fonte).toMatch(/notFound\(\)/)
  })

  it('toda Server Action exportada exige a dra antes de tocar no banco', () => {
    const fonte = ler('acoes.ts')
    expect(fonte.trimStart().startsWith("'use server'")).toBe(true)

    const nomes = [...fonte.matchAll(/export async function (\w+)/g)].map((m) => m[1])
    expect(nomes).toEqual(['salvarTemplate', 'alternarTemplate'])

    for (const nome of nomes) {
      const inicio = fonte.indexOf(`export async function ${nome}`)
      const proximo = nomes
        .map((outro) => fonte.indexOf(`export async function ${outro}`))
        .filter((posicao) => posicao > inicio)
      const corpo = fonte.slice(inicio, proximo.length > 0 ? Math.min(...proximo) : undefined)

      expect(corpo, nome).toMatch(/exigirDra\(/)
      // A guarda tem de vir antes do client do Supabase, não depois.
      expect(corpo.indexOf('exigirDra('), nome).toBeLessThan(corpo.indexOf('createServerClient('))
    }
  })
})
