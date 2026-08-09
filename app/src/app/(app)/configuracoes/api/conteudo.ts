/**
 * Conteúdo estático da aba Configurações → API.
 * Módulo puro (sem React) para manter a página enxuta e testável.
 */

export const ESTAGIOS_DA_API = [
  'lead',
  'contato',
  'agendado',
  'compareceu',
  'paciente',
  'retorno',
  'descartado',
] as const

export type SecaoEndpoint = 'pacientes' | 'procedimentos' | 'leads' | 'agenda'

export type EndpointDoc = {
  metodo: 'GET' | 'POST' | 'PATCH'
  caminho: string
  secao: SecaoEndpoint
  resumo: string
  corpo?: string
  respostaOk: string
  codigos: string
}

export type ItemNavApi =
  | { id: 'visao' | 'chave' | 'erros'; rotulo: string }
  | { id: SecaoEndpoint; rotulo: string }

export const NAV_DO_PAINEL_API: ItemNavApi[] = [
  { id: 'visao', rotulo: 'Visão geral' },
  { id: 'chave', rotulo: 'Chave' },
  { id: 'pacientes', rotulo: 'Pacientes' },
  { id: 'procedimentos', rotulo: 'Procedimentos' },
  { id: 'leads', rotulo: 'Leads' },
  { id: 'agenda', rotulo: 'Agenda' },
  { id: 'erros', rotulo: 'Erros' },
]

export type ErroCatalogo = {
  codigo: number
  quando: string
  remédio: string
}

export const CATALOGO_ERROS_API: ErroCatalogo[] = [
  {
    codigo: 401,
    quando: 'Sem sessão e chave inválida ou ausente',
    remédio: 'Gerar chave no painel ou colar Bearer; conferir Coolify env',
  },
  {
    codigo: 400,
    quando: 'JSON inválido / UUID malformado',
    remédio: 'Validar body / IDs',
  },
  {
    codigo: 404,
    quando: 'Paciente/procedimento/lead inexistente',
    remédio: 'Listar IDs via GET',
  },
  {
    codigo: 422,
    quando: 'Conflito, fora de expediente, validação de negócio',
    remédio: 'Ler `erro` no JSON; ajustar horário/procedimento',
  },
  {
    codigo: 500,
    quando: 'Falha interna',
    remédio: 'Ver logs Coolify; reenviar',
  },
]

export const ENDPOINTS_DA_API: EndpointDoc[] = [
  {
    metodo: 'GET',
    caminho: '/api/pacientes',
    secao: 'pacientes',
    resumo: 'Lista pacientes (id, nome, telefone, e-mail, estágio…).',
    respostaOk: '{ "ok": true, "pacientes": [ { "id": "…", "nome_completo": "…", "telefone": "+55…", … } ] }',
    codigos: '200 · 401 · 500',
  },
  {
    metodo: 'GET',
    caminho: '/api/pacientes/{id}',
    secao: 'pacientes',
    resumo: 'Detalhe de um paciente pelo UUID.',
    respostaOk: '{ "ok": true, "paciente": { … } }',
    codigos: '200 · 400 · 401 · 404',
  },
  {
    metodo: 'GET',
    caminho: '/api/procedimentos',
    secao: 'procedimentos',
    resumo: 'Catálogo ativo (id, nome, duração, preço…). Use ?todos=1 para incluir inativos.',
    respostaOk: '{ "ok": true, "procedimentos": [ { "id": "…", "nome": "…", "duracao_minutos": 60, … } ] }',
    codigos: '200 · 401 · 500',
  },
  {
    metodo: 'GET',
    caminho: '/api/procedimentos/{id}',
    secao: 'procedimentos',
    resumo: 'Detalhe de um procedimento pelo UUID.',
    respostaOk: '{ "ok": true, "procedimento": { … } }',
    codigos: '200 · 400 · 401 · 404',
  },
  {
    metodo: 'POST',
    caminho: '/api/leads',
    secao: 'leads',
    resumo: 'Cria lead (mesmo caminho do botão NOVO LEAD).',
    corpo: `{
  "nome": "Maria Silva",
  "telefone": "11987654321",
  "origem": "WhatsApp",
  "procedimentoInteresseId": "<uuid-ou-null>"
}`,
    respostaOk: '{ "ok": true, "pacienteId": "<uuid>" }',
    codigos: '201 · 400 · 401 · 422',
  },
  {
    metodo: 'PATCH',
    caminho: '/api/leads/{id}',
    secao: 'leads',
    resumo: 'Atualiza campos de CRM (nome, telefone, origem, procedimento, e-mail, consentimentos).',
    corpo: `{
  "nome": "Maria S.",
  "telefone": "11987654321",
  "origem": "Instagram",
  "procedimentoInteresseId": null,
  "email": "maria@email.com",
  "aceitaWhatsapp": true,
  "aceitaEmail": false
}`,
    respostaOk: '{ "ok": true, "pacienteId": "<uuid>" }',
    codigos: '200 · 400 · 401 · 422',
  },
  {
    metodo: 'POST',
    caminho: '/api/leads/{id}/estagio',
    secao: 'leads',
    resumo: 'Move o cartão no funil (mesma regra do kanban + Meta).',
    corpo: `{ "estagio": "contato" }`,
    respostaOk: '{ "ok": true, "pacienteId": "<uuid>", "estagio": "contato" }',
    codigos: '200 · 400 · 401 · 422',
  },
  {
    metodo: 'POST',
    caminho: '/api/agenda/agendar',
    secao: 'agenda',
    resumo: 'Cria consulta (conflito, lembretes, Google, push à equipe).',
    corpo: `{
  "pacienteId": "<uuid>",
  "procedimentoId": "<uuid>",
  "inicio": "2026-08-20T17:00:00.000Z"
}`,
    respostaOk: '{ "ok": true, "id": "<uuid-da-consulta>" }',
    codigos: '201 · 400 · 401 · 422',
  },
  {
    metodo: 'POST',
    caminho: '/api/agenda/remarcar',
    secao: 'agenda',
    resumo: 'Remarca horário (e opcionalmente o procedimento). Cancela lembretes pendentes e replaneja.',
    corpo: `{
  "consultaId": "<uuid>",
  "inicio": "2026-08-21T18:00:00.000Z",
  "procedimentoId": "<uuid-opcional>"
}`,
    respostaOk: '{ "ok": true, "id": "<uuid>" }',
    codigos: '200 · 400 · 401 · 422',
  },
  {
    metodo: 'POST',
    caminho: '/api/agenda/cancelar',
    secao: 'agenda',
    resumo: 'Cancela consulta (status cancelado + lembretes + Google).',
    corpo: `{ "consultaId": "<uuid>" }`,
    respostaOk: '{ "ok": true, "id": "<uuid>" }',
    codigos: '200 · 400 · 401 · 422',
  },
]

export function endpointsDaSecao(secao: SecaoEndpoint): EndpointDoc[] {
  return ENDPOINTS_DA_API.filter((ep) => ep.secao === secao)
}

/**
 * Curl pronto para n8n / terminal.
 * Usa `$API_KEY` no header; base URL real quando disponível.
 */
export function montarCurlDoEndpoint(baseUrl: string, ep: EndpointDoc): string {
  const origem = baseUrl.replace(/\/$/, '') || '$APP_URL'
  const url = `${origem}${ep.caminho}`
  const linhas = [`curl -sS`]

  if (ep.metodo !== 'GET') {
    linhas[0] += ` -X ${ep.metodo}`
  }

  linhas[0] += ` "${url}" \\`
  linhas.push(`  -H "Authorization: Bearer $API_KEY"`)

  if (ep.corpo) {
    const corpoCompacto = ep.corpo.replace(/\s*\n\s*/g, ' ').trim()
    linhas[linhas.length - 1] += ' \\'
    linhas.push(`  -H "Content-Type: application/json" \\`)
    linhas.push(`  -d '${corpoCompacto}'`)
  }

  return linhas.join('\n')
}
