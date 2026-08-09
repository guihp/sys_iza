import { describe, expect, it } from 'vitest'
import {
  ABAS_DE_CONFIGURACOES,
  abaAtiva,
  abasParaPapel,
} from '@/app/(app)/configuracoes/abas'
import {
  CATALOGO_ERROS_API,
  ENDPOINTS_DA_API,
  ESTAGIOS_DA_API,
  NAV_DO_PAINEL_API,
  endpointsDaSecao,
  montarCurlDoEndpoint,
} from '@/app/(app)/configuracoes/api/conteudo'

describe('ABAS_DE_CONFIGURACOES', () => {
  it('expõe Meta, Marca, Mensagens, Procedimentos, Notificações, Google e API nesta ordem', () => {
    expect(ABAS_DE_CONFIGURACOES.map((aba) => aba.rotulo)).toEqual([
      'Meta',
      'Marca',
      'Mensagens',
      'Procedimentos',
      'Notificações',
      'Google Agenda',
      'API',
    ])
  })
})

describe('abasParaPapel', () => {
  it('dá à dra todas as abas', () => {
    expect(abasParaPapel('dra').map((a) => a.rotulo)).toEqual([
      'Meta',
      'Marca',
      'Mensagens',
      'Procedimentos',
      'Notificações',
      'Google Agenda',
      'API',
    ])
  })

  it('dá à secretária Notificações e API', () => {
    expect(abasParaPapel('secretaria').map((a) => a.rotulo)).toEqual([
      'Notificações',
      'API',
    ])
  })
})

describe('abaAtiva', () => {
  it('acende a aba do caminho exato', () => {
    expect(abaAtiva('/configuracoes/meta')).toBe('/configuracoes/meta')
  })

  it('acende numa subrota', () => {
    expect(abaAtiva('/configuracoes/procedimentos/abc')).toBe('/configuracoes/procedimentos')
  })

  it('não acende por prefixo solto', () => {
    expect(abaAtiva('/configuracoes/metalurgia')).toBeNull()
  })

  it('não acende sem caminho', () => {
    expect(abaAtiva(null)).toBeNull()
  })

  it('respeita a lista filtrada da secretária', () => {
    const abas = abasParaPapel('secretaria')
    expect(abaAtiva('/configuracoes/notificacoes', abas)).toBe('/configuracoes/notificacoes')
    expect(abaAtiva('/configuracoes/api', abas)).toBe('/configuracoes/api')
    expect(abaAtiva('/configuracoes/meta', abas)).toBeNull()
  })
})

describe('documentação da API', () => {
  it('lista os endpoints principais', () => {
    const caminhos = ENDPOINTS_DA_API.map((e) => `${e.metodo} ${e.caminho}`)
    expect(caminhos).toContain('GET /api/pacientes')
    expect(caminhos).toContain('GET /api/procedimentos')
    expect(caminhos).toContain('POST /api/leads')
    expect(caminhos).toContain('POST /api/agenda/agendar')
    expect(caminhos).toContain('POST /api/agenda/remarcar')
    expect(caminhos).toContain('POST /api/agenda/cancelar')
  })

  it('documenta os sete estágios', () => {
    expect(ESTAGIOS_DA_API).toHaveLength(7)
    expect(ESTAGIOS_DA_API).toContain('retorno')
  })

  it('expõe nav com visão, chave, recursos e erros', () => {
    expect(NAV_DO_PAINEL_API.map((n) => n.id)).toEqual([
      'visao',
      'chave',
      'pacientes',
      'procedimentos',
      'leads',
      'agenda',
      'erros',
    ])
  })

  it('agrupa endpoints por seção', () => {
    expect(endpointsDaSecao('pacientes').every((e) => e.secao === 'pacientes')).toBe(true)
    expect(endpointsDaSecao('agenda').map((e) => e.caminho)).toContain('/api/agenda/agendar')
  })

  it('monta curl com domínio real e Bearer', () => {
    const ep = ENDPOINTS_DA_API.find((e) => e.caminho === '/api/pacientes')!
    const curl = montarCurlDoEndpoint('https://web.clinica.exemplo', ep)
    expect(curl).toContain('https://web.clinica.exemplo/api/pacientes')
    expect(curl).toContain('Authorization: Bearer $API_KEY')
  })

  it('cataloga erros com remédio', () => {
    expect(CATALOGO_ERROS_API.map((e) => e.codigo)).toEqual([401, 400, 404, 422, 500])
    expect(CATALOGO_ERROS_API.every((e) => e.quando && e.remédio)).toBe(true)
  })
})
