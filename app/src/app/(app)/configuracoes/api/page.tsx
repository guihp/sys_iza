import { headers } from 'next/headers'
import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina } from '@/components/ui'
import { urlPublicaDoApp } from '@/lib/url-publica'
import { PainelDaApi } from './painel-api'
import { carregarStatusDaChaveApi } from './status'

export const metadata = { title: 'API' }

/**
 * Painel da API HTTP (n8n / automação).
 * Dra e secretária veem docs e playground; só a Dra gera a chave.
 */
export default async function PaginaDaApi() {
  const sessao = await requireSessao()
  const [cabecalhos, status] = await Promise.all([headers(), carregarStatusDaChaveApi()])
  const baseUrl = urlPublicaDoApp(cabecalhos)

  return (
    <section className="space-y-8">
      <CabecalhoDePagina
        secao="Integrações"
        titulo="API"
        descricao="Endpoints para o n8n listar IDs, criar leads e marcar / remarcar / cancelar consultas. Gere a chave aqui ou use a do Coolify."
      />

      <PainelDaApi
        baseUrl={baseUrl}
        status={status}
        podeGerarChave={sessao.role === 'dra'}
      />
    </section>
  )
}
