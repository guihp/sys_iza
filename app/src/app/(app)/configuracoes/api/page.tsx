import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina } from '@/components/ui'
import { chaveDaApiHttp, serverEnv } from '@/lib/env'
import { ENDPOINTS_DA_API, ESTAGIOS_DA_API } from './conteudo'

export const metadata = { title: 'API' }

function BlocoCodigo({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-linha bg-superficie-2 p-3 text-[12px] leading-relaxed text-texto">
      <code>{children}</code>
    </pre>
  )
}

/**
 * Documentação da API HTTP para n8n / automação.
 *
 * Visível para dra e secretaria. A chave em si nunca aparece na tela — só se
 * está configurada no ambiente (Coolify). Quem gera e cola a chave é o dono.
 */
export default async function PaginaDaApi() {
  await requireSessao()
  const chaveConfigurada = Boolean(chaveDaApiHttp(serverEnv()))

  return (
    <section className="max-w-3xl space-y-10">
      <CabecalhoDePagina
        secao="Integrações"
        titulo="API"
        descricao="Endpoints para o n8n (e qualquer automação) listar IDs, criar leads e marcar / remarcar / cancelar consultas. Autenticação por chave gerada por você — não vem da Meta."
      />

      <div
        className={`space-y-2 rounded-xl border p-4 ${
          chaveConfigurada
            ? 'border-emerald-600/40 bg-emerald-500/10'
            : 'border-amber-600/40 bg-amber-500/10'
        }`}
      >
        <p className="text-sm font-medium">
          {chaveConfigurada
            ? 'Chave da API configurada no servidor'
            : 'Chave da API ainda não configurada'}
        </p>
        <p className="text-sm text-texto-suave">
          {chaveConfigurada
            ? 'As rotas /api/* aceitam sessão logada ou Authorization: Bearer / x-api-key.'
            : 'Sem a variável no Coolify, só quem está logado no app consegue chamar /api/*. Gere a chave abaixo e cole no painel.'}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">1. Como gerar e configurar a chave</h2>
        <p className="text-sm text-texto-suave">
          A chave <strong className="font-medium text-texto">não existe na Meta</strong> nem em
          nenhum painel externo. Você gera no terminal, cola no Coolify e usa no n8n.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-texto-suave">
          <li>
            No Mac / Linux, rode:
            <BlocoCodigo>{`openssl rand -hex 32`}</BlocoCodigo>
          </li>
          <li>
            No Coolify (variáveis do serviço web), crie{' '}
            <code className="rounded bg-superficie-2 px-1">API_KEY</code> com o valor gerado.
            Reinicie o container.
          </li>
          <li>
            Alias legado: se já existir{' '}
            <code className="rounded bg-superficie-2 px-1">AGENDA_API_KEY</code>, continua
            válida. Preferência: <code className="rounded bg-superficie-2 px-1">API_KEY</code>{' '}
            primeiro; se vazia, cai em <code className="rounded bg-superficie-2 px-1">AGENDA_API_KEY</code>.
          </li>
          <li>Não commite a chave. Não cole no chat. Não use variável NEXT_PUBLIC_*.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">2. Base URL e autenticação</h2>
        <p className="text-sm text-texto-suave">
          Base URL = URL pública do app no Coolify (ex.:{' '}
          <code className="rounded bg-superficie-2 px-1">https://sistema.seudominio.com</code>
          ). Todos os caminhos abaixo são relativos a ela.
        </p>
        <p className="text-sm text-texto-suave">Cabeçalhos (escolha um):</p>
        <BlocoCodigo>{`Authorization: Bearer SEU_API_KEY
# ou
x-api-key: SEU_API_KEY
Content-Type: application/json`}</BlocoCodigo>
        <p className="text-sm text-texto-suave">
          Sem sessão e sem chave válida → <strong className="font-medium text-texto">401</strong>.
          O proxy não redireciona /api/* para /login (curl e n8n não quebram).
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-xl">3. Endpoints</h2>
        {ENDPOINTS_DA_API.map((ep) => (
          <article
            key={`${ep.metodo}-${ep.caminho}`}
            className="space-y-2 rounded-xl border border-linha bg-superficie p-4"
          >
            <p className="font-mono text-sm">
              <span className="font-semibold text-acento">{ep.metodo}</span> {ep.caminho}
            </p>
            <p className="text-sm text-texto-suave">{ep.resumo}</p>
            {ep.corpo ? (
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-texto-suave">Body</p>
                <BlocoCodigo>{ep.corpo}</BlocoCodigo>
              </div>
            ) : null}
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-texto-suave">Resposta OK</p>
              <BlocoCodigo>{ep.respostaOk}</BlocoCodigo>
            </div>
            <p className="text-xs text-texto-suave">HTTP: {ep.codigos}</p>
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">4. Retorno</h2>
        <p className="text-sm text-texto-suave">
          Não há endpoint separado de &quot;retorno&quot;. Retorno = criar um agendamento (
          <code className="rounded bg-superficie-2 px-1">POST /api/agenda/agendar</code>) com o{' '}
          <strong className="font-medium text-texto">procedimento de retorno</strong> do catálogo
          (o mesmo fluxo da agenda na UI). Use o UUID desse procedimento em{' '}
          <code className="rounded bg-superficie-2 px-1">procedimentoId</code>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">5. Estágios do funil</h2>
        <BlocoCodigo>{ESTAGIOS_DA_API.join(' · ')}</BlocoCodigo>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">6. Exemplos curl (prontos para n8n)</h2>
        <p className="text-sm text-texto-suave">
          Troque <code className="rounded bg-superficie-2 px-1">$APP_URL</code> e{' '}
          <code className="rounded bg-superficie-2 px-1">$API_KEY</code>. No n8n: nó HTTP Request,
          Authentication = Header Auth ou Header genérico.
        </p>
        <BlocoCodigo>{`# Listar pacientes (pegar IDs)
curl -sS "$APP_URL/api/pacientes" \\
  -H "Authorization: Bearer $API_KEY"

# Listar procedimentos (pegar IDs)
curl -sS "$APP_URL/api/procedimentos" \\
  -H "Authorization: Bearer $API_KEY"

# Criar lead
curl -sS -X POST "$APP_URL/api/leads" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"nome":"Maria Silva","telefone":"11987654321","origem":"WhatsApp"}'

# Agendar (inicio = ISO com Z, instante absoluto)
curl -sS -X POST "$APP_URL/api/agenda/agendar" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"pacienteId":"<uuid>","procedimentoId":"<uuid>","inicio":"2026-08-20T17:00:00.000Z"}'

# Remarcar
curl -sS -X POST "$APP_URL/api/agenda/remarcar" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"consultaId":"<uuid>","inicio":"2026-08-21T18:00:00.000Z"}'

# Cancelar
curl -sS -X POST "$APP_URL/api/agenda/cancelar" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"consultaId":"<uuid>"}'`}</BlocoCodigo>
      </section>

      <section className="space-y-2 rounded-xl border border-linha p-4">
        <h2 className="font-serif text-lg">Notas</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-texto-suave">
          <li>
            <code className="rounded bg-superficie-2 px-1">inicio</code> é sempre ISO 8601 com{' '}
            <code className="rounded bg-superficie-2 px-1">Z</code> (mesmo contrato do formulário
            da agenda).
          </li>
          <li>Telefone é normalizado para E.164 (+55…) antes de gravar.</li>
          <li>Erro de negócio (conflito, telefone duplicado, validação) → 422 com mensagem em português.</li>
        </ul>
      </section>
    </section>
  )
}
