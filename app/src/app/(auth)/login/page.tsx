import { carregarMarca } from '@/lib/marca'
import { FormularioDeLogin } from './formulario'

export const metadata = { title: 'Entrar' }

/** Login — Server Component só para ler a marca; o form é cliente. */
export default async function LoginPage() {
  const marca = await carregarMarca()
  return <FormularioDeLogin marca={marca} />
}
