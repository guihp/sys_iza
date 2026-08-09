'use client'

import { useEffect, useState, useTransition } from 'react'
import { Cartao, RotuloMiudo, juntar } from '@/components/ui'
import { gerarChaveDaApi, rotacionarChaveDaApi } from './acoes'
import {
  CATALOGO_ERROS_API,
  ESTAGIOS_DA_API,
  NAV_DO_PAINEL_API,
  endpointsDaSecao,
  montarCurlDoEndpoint,
  type EndpointDoc,
  type SecaoEndpoint,
} from './conteudo'
import type { StatusDaChaveApi } from './status'

type SecaoAtiva = (typeof NAV_DO_PAINEL_API)[number]['id']

type Props = {
  baseUrl: string
  status: StatusDaChaveApi
  podeGerarChave: boolean
}

type ResultadoTeste = {
  status: number
  corpo: string
  ok: boolean
}

/**
 * Painel profissional da API: nav lateral + curls + playground + chave.
 */
export function PainelDaApi({ baseUrl, status: statusInicial, podeGerarChave }: Props) {
  const [secao, setSecao] = useState<SecaoAtiva>('visao')
  const [status, setStatus] = useState(statusInicial)
  const [chaveRecemGerada, setChaveRecemGerada] = useState<string | null>(null)
  const [bearerOpcional, setBearerOpcional] = useState('')
  const [erroChave, setErroChave] = useState<string | null>(null)
  const [pendenteChave, iniciarChave] = useTransition()

  const origemPlayground =
    typeof window !== 'undefined' ? window.location.origin : baseUrl || ''

  function gerarOuRotacionar(rotacionar: boolean) {
    setErroChave(null)
    iniciarChave(async () => {
      const resultado = rotacionar ? await rotacionarChaveDaApi() : await gerarChaveDaApi()
      if (!resultado.ok) {
        setErroChave(resultado.erro)
        return
      }
      setChaveRecemGerada(resultado.chave)
      setBearerOpcional(resultado.chave)
      setStatus({
        chaveEnvConfigurada: status.chaveEnvConfigurada,
        chaveBancoConfigurada: true,
        prefixo: resultado.prefixo,
        criadoEm: resultado.criadoEm,
        fonte: status.chaveEnvConfigurada ? 'ambos' : 'banco',
      })
    })
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <nav
        aria-label="Seções da API"
        className="flex shrink-0 gap-1 overflow-x-auto lg:w-44 lg:flex-col lg:overflow-visible"
      >
        {NAV_DO_PAINEL_API.map((item) => {
          const ativo = secao === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSecao(item.id)}
              className={juntar(
                'shrink-0 rounded-cartao px-3 py-2 text-left text-sm transition-colors',
                ativo
                  ? 'bg-acento-suave font-medium text-texto'
                  : 'text-texto-suave hover:bg-superficie-2 hover:text-texto',
              )}
            >
              {item.rotulo}
            </button>
          )
        })}
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        {secao === 'visao' ? (
          <SecaoVisao baseUrl={baseUrl} status={status} />
        ) : null}

        {secao === 'chave' ? (
          <SecaoChave
            status={status}
            podeGerarChave={podeGerarChave}
            pendente={pendenteChave}
            erro={erroChave}
            chaveRecemGerada={chaveRecemGerada}
            onFecharModal={() => setChaveRecemGerada(null)}
            onGerar={() => gerarOuRotacionar(false)}
            onRotacionar={() => gerarOuRotacionar(true)}
          />
        ) : null}

        {secao === 'pacientes' ||
        secao === 'procedimentos' ||
        secao === 'leads' ||
        secao === 'agenda' ? (
          <SecaoEndpoints
            secao={secao}
            baseUrl={baseUrl}
            origemPlayground={origemPlayground}
            bearerOpcional={bearerOpcional}
            onBearerChange={setBearerOpcional}
          />
        ) : null}

        {secao === 'erros' ? <SecaoErros /> : null}
      </div>
    </div>
  )
}

function SecaoVisao({ baseUrl, status }: { baseUrl: string; status: StatusDaChaveApi }) {
  return (
    <div className="space-y-5">
      <CartaoStatus status={status} />
      <Cartao className="space-y-3 p-5">
        <h2 className="font-serif text-xl">Base URL e autenticação</h2>
        <p className="text-sm text-texto-suave">
          Domínio desta instalação:{' '}
          <code className="rounded bg-superficie-2 px-1 text-texto">
            {baseUrl || '(não detectado — use o host do Coolify)'}
          </code>
        </p>
        <BlocoCodigo>{`Authorization: Bearer SEU_API_KEY
# ou
x-api-key: SEU_API_KEY
Content-Type: application/json`}</BlocoCodigo>
        <p className="text-sm text-texto-suave">
          Sem sessão e sem chave válida → <strong className="font-medium text-texto">401</strong>.
          O proxy não redireciona /api/* para /login.
        </p>
        <p className="text-sm text-texto-suave">
          Retorno = agendar com o procedimento de retorno do catálogo (
          <code className="rounded bg-superficie-2 px-1">POST /api/agenda/agendar</code>).
        </p>
        <div className="space-y-1">
          <RotuloMiudo>Estágios do funil</RotuloMiudo>
          <BlocoCodigo>{ESTAGIOS_DA_API.join(' · ')}</BlocoCodigo>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-texto-suave">
          <li>
            <code className="rounded bg-superficie-2 px-1">inicio</code> é ISO 8601 com{' '}
            <code className="rounded bg-superficie-2 px-1">Z</code>.
          </li>
          <li>Telefone normalizado para E.164 (+55…) antes de gravar.</li>
          <li>Erro de negócio → 422 com mensagem em português.</li>
        </ul>
      </Cartao>
    </div>
  )
}

function CartaoStatus({ status }: { status: StatusDaChaveApi }) {
  const ok = status.fonte !== 'nenhuma'
  let titulo = 'Chave da API ainda não configurada'
  let detalhe =
    'Sem chave no painel nem no Coolify, só quem está logado consegue chamar /api/*.'

  if (status.fonte === 'banco') {
    titulo = 'Chave configurada no painel'
    detalhe = `Prefixo ${status.prefixo ?? '…'}… — use Bearer / x-api-key no n8n.`
  } else if (status.fonte === 'env') {
    titulo = 'Chave configurada no servidor (env)'
    detalhe = 'API_KEY / AGENDA_API_KEY no Coolify. Pode gerar outra no painel (as duas valem).'
  } else if (status.fonte === 'ambos') {
    titulo = 'Chave no painel e no servidor'
    detalhe = `Banco: ${status.prefixo ?? '…'}… · Env Coolify também aceita.`
  }

  return (
    <div
      className={juntar(
        'space-y-2 rounded-xl border p-4',
        ok ? 'border-emerald-600/40 bg-emerald-500/10' : 'border-amber-600/40 bg-amber-500/10',
      )}
    >
      <p className="text-sm font-medium">{titulo}</p>
      <p className="text-sm text-texto-suave">{detalhe}</p>
    </div>
  )
}

function SecaoChave({
  status,
  podeGerarChave,
  pendente,
  erro,
  chaveRecemGerada,
  onFecharModal,
  onGerar,
  onRotacionar,
}: {
  status: StatusDaChaveApi
  podeGerarChave: boolean
  pendente: boolean
  erro: string | null
  chaveRecemGerada: string | null
  onFecharModal: () => void
  onGerar: () => void
  onRotacionar: () => void
}) {
  const temBanco = status.chaveBancoConfigurada

  return (
    <div className="space-y-5">
      <CartaoStatus status={status} />

      <Cartao className="space-y-4 p-5">
        <h2 className="font-serif text-xl">Chave da API</h2>
        <p className="text-sm text-texto-suave">
          Gere no painel (recomendado): o hash fica no banco; o plaintext aparece{' '}
          <strong className="font-medium text-texto">uma vez</strong>. Alternativa: variável{' '}
          <code className="rounded bg-superficie-2 px-1">API_KEY</code> no Coolify (continua
          válida).
        </p>

        {temBanco ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <RotuloMiudo>Prefixo</RotuloMiudo>
              <p className="font-mono text-texto">{status.prefixo ?? '—'}…</p>
            </div>
            <div>
              <RotuloMiudo>Criada em</RotuloMiudo>
              <p className="text-texto">
                {status.criadoEm
                  ? new Date(status.criadoEm).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })
                  : '—'}
              </p>
            </div>
          </dl>
        ) : null}

        {podeGerarChave ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pendente}
              onClick={temBanco ? onRotacionar : onGerar}
              className="inline-flex min-h-11 items-center justify-center rounded-cartao bg-acento px-4 text-sm font-medium text-fundo disabled:opacity-60"
            >
              {pendente
                ? 'Gerando…'
                : temBanco
                  ? 'Rotacionar chave'
                  : 'Gerar chave'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-texto-suave">
            Só a Dra. pode gerar ou rotacionar. Secretária vê docs e testa com a sessão.
          </p>
        )}

        {erro ? <p className="text-sm text-red-700">{erro}</p> : null}

        <div className="space-y-2 border-t border-linha pt-4">
          <RotuloMiudo>No n8n</RotuloMiudo>
          <p className="text-sm text-texto-suave">
            HTTP Request → Authentication = Header Auth, ou header genérico:{' '}
            <code className="rounded bg-superficie-2 px-1">Authorization: Bearer …</code> ou{' '}
            <code className="rounded bg-superficie-2 px-1">x-api-key</code>.
          </p>
        </div>
      </Cartao>

      {chaveRecemGerada ? (
        <ModalChaveGerada chave={chaveRecemGerada} onFechar={onFecharModal} />
      ) : null}
    </div>
  )
}

function ModalChaveGerada({ chave, onFechar }: { chave: string; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onFechar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onFechar])

  async function copiar() {
    try {
      await navigator.clipboard.writeText(chave)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-chave-titulo"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-lg space-y-4 rounded-xl border border-linha bg-superficie p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="modal-chave-titulo" className="font-serif text-xl">
          Copie a chave agora
        </h3>
        <p className="text-sm text-texto-suave">
          Ela não será mostrada de novo. Cole no n8n (Bearer) e guarde em local seguro.
        </p>
        <BlocoCodigo>{chave}</BlocoCodigo>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copiar}
            className="inline-flex min-h-11 items-center rounded-cartao bg-acento px-4 text-sm font-medium text-fundo"
          >
            {copiado ? 'Copiada' : 'Copiar chave'}
          </button>
          <button
            type="button"
            onClick={onFechar}
            className="inline-flex min-h-11 items-center rounded-cartao border border-linha px-4 text-sm text-texto"
          >
            Já copiei
          </button>
        </div>
      </div>
    </div>
  )
}

function SecaoEndpoints({
  secao,
  baseUrl,
  origemPlayground,
  bearerOpcional,
  onBearerChange,
}: {
  secao: SecaoEndpoint
  baseUrl: string
  origemPlayground: string
  bearerOpcional: string
  onBearerChange: (v: string) => void
}) {
  const endpoints = endpointsDaSecao(secao)
  const titulo = NAV_DO_PAINEL_API.find((n) => n.id === secao)?.rotulo ?? secao

  return (
    <div className="space-y-4">
      <h2 className="font-serif text-xl">{titulo}</h2>
      {endpoints.map((ep) => (
        <CartaoEndpoint
          key={`${ep.metodo}-${ep.caminho}`}
          ep={ep}
          baseUrl={baseUrl}
          origemPlayground={origemPlayground}
          bearerOpcional={bearerOpcional}
          onBearerChange={onBearerChange}
        />
      ))}
    </div>
  )
}

function CartaoEndpoint({
  ep,
  baseUrl,
  origemPlayground,
  bearerOpcional,
  onBearerChange,
}: {
  ep: EndpointDoc
  baseUrl: string
  origemPlayground: string
  bearerOpcional: string
  onBearerChange: (v: string) => void
}) {
  const [caminho, setCaminho] = useState(ep.caminho)
  const [corpo, setCorpo] = useState(ep.corpo ?? '')
  const [usarBearer, setUsarBearer] = useState(false)
  const [teste, setTeste] = useState<ResultadoTeste | null>(null)
  const [testando, setTestando] = useState(false)
  const [curlCopiado, setCurlCopiado] = useState(false)

  const curl = montarCurlDoEndpoint(baseUrl, { ...ep, caminho })

  async function copiarCurl() {
    try {
      await navigator.clipboard.writeText(curl)
      setCurlCopiado(true)
      setTimeout(() => setCurlCopiado(false), 2000)
    } catch {
      setCurlCopiado(false)
    }
  }

  async function testar() {
    setTestando(true)
    setTeste(null)
    try {
      const url = `${origemPlayground.replace(/\/$/, '')}${caminho}`
      const headers: Record<string, string> = {}
      if (usarBearer && bearerOpcional.trim()) {
        headers.Authorization = `Bearer ${bearerOpcional.trim()}`
      }
      if (ep.metodo !== 'GET' && corpo.trim()) {
        headers['Content-Type'] = 'application/json'
      }

      const resposta = await fetch(url, {
        method: ep.metodo,
        headers,
        body: ep.metodo === 'GET' ? undefined : corpo.trim() || undefined,
        credentials: 'same-origin',
      })

      const texto = await resposta.text()
      let formatado = texto
      try {
        formatado = JSON.stringify(JSON.parse(texto), null, 2)
      } catch {
        // mantém texto bruto
      }

      setTeste({ status: resposta.status, corpo: formatado, ok: resposta.ok })
    } catch (erro) {
      setTeste({
        status: 0,
        corpo: erro instanceof Error ? erro.message : 'Falha de rede',
        ok: false,
      })
    } finally {
      setTestando(false)
    }
  }

  return (
    <article className="space-y-3 rounded-xl border border-linha bg-superficie p-4">
      <p className="font-mono text-sm">
        <span className="font-semibold text-acento">{ep.metodo}</span> {ep.caminho}
      </p>
      <p className="text-sm text-texto-suave">{ep.resumo}</p>

      <div className="space-y-1">
        <RotuloMiudo>Curl</RotuloMiudo>
        <BlocoCodigo>{curl}</BlocoCodigo>
      </div>

      {ep.corpo ? (
        <div className="space-y-1">
          <RotuloMiudo>Body (editável)</RotuloMiudo>
          <textarea
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            rows={Math.min(10, corpo.split('\n').length + 1)}
            className="w-full rounded-cartao border border-linha bg-fundo px-3 py-2 font-mono text-[12px] text-texto outline-none focus:border-acento"
            spellCheck={false}
          />
        </div>
      ) : null}

      {ep.caminho.includes('{') ? (
        <div className="space-y-1">
          <RotuloMiudo>Caminho do teste (substitua &#123;id&#125;)</RotuloMiudo>
          <input
            value={caminho}
            onChange={(e) => setCaminho(e.target.value)}
            className="w-full rounded-cartao border border-linha bg-fundo px-3 py-2 font-mono text-[12px] text-texto outline-none focus:border-acento"
          />
        </div>
      ) : null}

      <div className="space-y-2 rounded-cartao border border-linha/80 bg-fundo/40 p-3">
        <label className="flex items-start gap-2 text-sm text-texto-suave">
          <input
            type="checkbox"
            checked={usarBearer}
            onChange={(e) => setUsarBearer(e.target.checked)}
            className="mt-1"
          />
          <span>
            Usar Bearer (opcional). Sem marcar, o teste usa a sessão logada (cookie).
          </span>
        </label>
        {usarBearer ? (
          <input
            type="password"
            autoComplete="off"
            value={bearerOpcional}
            onChange={(e) => onBearerChange(e.target.value)}
            placeholder="Cole a chave recém-gerada"
            className="w-full rounded-cartao border border-linha bg-fundo px-3 py-2 font-mono text-[12px] text-texto outline-none focus:border-acento"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copiarCurl}
          className="inline-flex min-h-10 items-center rounded-cartao border border-linha px-3 text-sm text-texto"
        >
          {curlCopiado ? 'Curl copiado' : 'Copiar curl'}
        </button>
        <button
          type="button"
          disabled={testando}
          onClick={testar}
          className="inline-flex min-h-10 items-center rounded-cartao bg-acento px-3 text-sm font-medium text-fundo disabled:opacity-60"
        >
          {testando ? 'Testando…' : 'Testar'}
        </button>
      </div>

      {teste ? (
        <div className="space-y-1">
          <p
            className={juntar(
              'text-sm font-medium',
              teste.ok ? 'text-emerald-800' : 'text-red-700',
            )}
          >
            HTTP {teste.status || '—'}
          </p>
          <BlocoCodigo>{teste.corpo}</BlocoCodigo>
        </div>
      ) : null}

      <div className="space-y-1">
        <RotuloMiudo>Resposta OK</RotuloMiudo>
        <BlocoCodigo>{ep.respostaOk}</BlocoCodigo>
      </div>
      <p className="text-xs text-texto-suave">HTTP: {ep.codigos}</p>
    </article>
  )
}

function SecaoErros() {
  return (
    <div className="space-y-4">
      <h2 className="font-serif text-xl">Catálogo de erros</h2>
      <p className="text-sm text-texto-suave">
        Códigos HTTP que as rotas /api/* devolvem e como destravar.
      </p>
      <div className="overflow-x-auto rounded-xl border border-linha">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="border-b border-linha bg-superficie-2 text-texto-suave">
            <tr>
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Quando</th>
              <th className="px-3 py-2 font-medium">Como resolver</th>
            </tr>
          </thead>
          <tbody>
            {CATALOGO_ERROS_API.map((item) => (
              <tr key={item.codigo} className="border-b border-linha last:border-0">
                <td className="px-3 py-2 font-mono font-medium text-acento">{item.codigo}</td>
                <td className="px-3 py-2 text-texto-suave">{item.quando}</td>
                <td className="px-3 py-2 text-texto-suave">{item.remédio}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BlocoCodigo({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-linha bg-superficie-2 p-3 text-[12px] leading-relaxed text-texto">
      <code>{children}</code>
    </pre>
  )
}
