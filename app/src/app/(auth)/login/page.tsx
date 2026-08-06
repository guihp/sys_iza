'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/browser'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault()
    setCarregando(true)
    setErro(null)
    const supabase = createBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setCarregando(false)
    if (error) {
      // Mensagem genérica de propósito: não revelar se o e-mail existe.
      setErro('E-mail ou senha incorretos')
      return
    }
    router.replace('/crm')
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-fundo px-6">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="font-serif text-2xl text-texto">Dra. Izadora Barros</h1>
          <p className="text-sm text-texto/60">CRO SP 173735</p>
        </header>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">E-mail</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-linha bg-transparent px-3 py-2"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Senha</span>
          <input
            type="password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="w-full rounded-lg border border-linha bg-transparent px-3 py-2"
          />
        </label>

        {erro && (
          <p role="alert" className="text-sm text-red-600">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={carregando}
          className="w-full rounded-lg bg-acento py-2 text-white disabled:opacity-60"
        >
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
