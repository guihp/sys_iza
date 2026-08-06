import { redirect } from 'next/navigation'

/**
 * A raiz não tem tela própria: quem está logado vai para o funil (mesmo
 * destino do login) e quem não está é barrado antes, pelo proxy.
 */
export default function Home() {
  redirect('/crm')
}
