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

export type EndpointDoc = {
  metodo: string
  caminho: string
  resumo: string
  corpo?: string
  respostaOk: string
  codigos: string
}

export const ENDPOINTS_DA_API: EndpointDoc[] = [
  {
    metodo: 'GET',
    caminho: '/api/pacientes',
    resumo: 'Lista pacientes (id, nome, telefone, e-mail, estágio…).',
    respostaOk: '{ "ok": true, "pacientes": [ { "id": "…", "nome_completo": "…", "telefone": "+55…", … } ] }',
    codigos: '200 · 401 · 500',
  },
  {
    metodo: 'GET',
    caminho: '/api/pacientes/{id}',
    resumo: 'Detalhe de um paciente pelo UUID.',
    respostaOk: '{ "ok": true, "paciente": { … } }',
    codigos: '200 · 400 · 401 · 404',
  },
  {
    metodo: 'GET',
    caminho: '/api/procedimentos',
    resumo: 'Catálogo ativo (id, nome, duração, preço…). Use ?todos=1 para incluir inativos.',
    respostaOk: '{ "ok": true, "procedimentos": [ { "id": "…", "nome": "…", "duracao_minutos": 60, … } ] }',
    codigos: '200 · 401 · 500',
  },
  {
    metodo: 'GET',
    caminho: '/api/procedimentos/{id}',
    resumo: 'Detalhe de um procedimento pelo UUID.',
    respostaOk: '{ "ok": true, "procedimento": { … } }',
    codigos: '200 · 400 · 401 · 404',
  },
  {
    metodo: 'POST',
    caminho: '/api/leads',
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
    resumo: 'Move o cartão no funil (mesma regra do kanban + Meta).',
    corpo: `{ "estagio": "contato" }`,
    respostaOk: '{ "ok": true, "pacienteId": "<uuid>", "estagio": "contato" }',
    codigos: '200 · 400 · 401 · 422',
  },
  {
    metodo: 'POST',
    caminho: '/api/agenda/agendar',
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
    resumo: 'Cancela consulta (status cancelado + lembretes + Google).',
    corpo: `{ "consultaId": "<uuid>" }`,
    respostaOk: '{ "ok": true, "id": "<uuid>" }',
    codigos: '200 · 400 · 401 · 422',
  },
]
