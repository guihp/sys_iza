import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
import { CabecalhoDePagina } from '@/components/ui'
import { carregarMarca } from '@/lib/marca'
import { FormularioDaMarca } from './formulario'

export const metadata = { title: 'Marca' }

/**
 * Marca da clínica — foto do login e logo.
 * Exclusiva da dra (`notFound` para secretária).
 */
export default async function PaginaDaMarca() {
  const sessao = await requireSessao()
  if (sessao.role !== 'dra') notFound()

  const marca = await carregarMarca()

  return (
    <section className="max-w-2xl space-y-8">
      <CabecalhoDePagina
        secao="Identidade"
        titulo="Marca"
        descricao="Foto do painel de login e logo da clínica. Elas aparecem na entrada e na barra lateral — não se edita mais isso na tela de login."
      />
      <FormularioDaMarca marcaInicial={marca} />
    </section>
  )
}
