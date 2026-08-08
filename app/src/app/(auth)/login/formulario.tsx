'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/browser'
import type { MarcaDaClinica } from '@/lib/marca'
import './login.css'

const CAMPO =
  'login-campo w-full rounded-[12px] border border-[#e4ded4] bg-white px-4 py-[14px] text-[14px] tracking-[0.01em] text-[#1b1815] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[#a9a096]'

export function FormularioDeLogin({ marca }: { marca: MarcaDaClinica }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [manterConectada, setManterConectada] = useState(true)
  const [aviso, setAviso] = useState('')
  const [avisoOk, setAvisoOk] = useState(false)
  const [carregando, setCarregando] = useState(false)

  function limparAviso() {
    setAviso('')
    setAvisoOk(false)
  }

  async function entrar(evento: FormEvent) {
    evento.preventDefault()
    limparAviso()

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setAviso('Informe um e-mail válido.')
      return
    }
    if (senha.length < 6) {
      setAviso('A senha tem no mínimo 6 caracteres.')
      return
    }

    setCarregando(true)
    void manterConectada

    const supabase = createBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setCarregando(false)

    if (error) {
      setAviso('E-mail ou senha incorretos')
      return
    }
    setAvisoOk(true)
    setAviso('Acesso liberado — abrindo sua agenda.')
    router.replace('/crm')
  }

  async function esqueciSenha() {
    limparAviso()
    if (!email.trim()) {
      setAviso('Informe o e-mail acima para receber o link de redefinição.')
      return
    }
    setCarregando(true)
    const supabase = createBrowserClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`,
    })
    setCarregando(false)
    if (error) {
      setAviso('Não foi possível enviar o e-mail de redefinição. Tente de novo.')
      return
    }
    setAvisoOk(true)
    setAviso('Se este e-mail estiver cadastrado, enviamos o link de redefinição.')
  }

  return (
    <main
      className="min-h-dvh overflow-x-hidden overflow-y-auto bg-[#f7f4ef] text-[#1b1815] antialiased"
      style={{ fontFamily: 'var(--font-login-sans), system-ui, sans-serif' }}
    >
      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative flex min-h-0 flex-col justify-between gap-8 bg-[#efe9e0] px-6 py-8 pt-[max(2rem,env(safe-area-inset-top))] sm:gap-10 sm:px-12 sm:py-[52px] lg:px-14 lg:pt-[52px]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            {marca.heroUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={marca.heroUrl} alt="" className="absolute inset-0 size-full object-cover" />
            ) : null}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(252,250,246,.9), rgba(252,250,246,.62) 45%, rgba(252,250,246,.94))',
              }}
            />
            <div
              className="login-aurora absolute -left-[14%] -top-[16%] h-[78%] w-[78%] rounded-full opacity-70 blur-[90px]"
              style={{
                background:
                  'radial-gradient(circle at 40% 40%, rgba(201,162,115,.5), rgba(201,162,115,0) 68%)',
              }}
            />
            <div
              className="login-aurora2 absolute -bottom-[18%] -right-[16%] h-[66%] w-[66%] rounded-full opacity-[0.55] blur-[100px]"
              style={{
                background:
                  'radial-gradient(circle at 50% 50%, rgba(186,168,196,.45), rgba(186,168,196,0) 70%)',
              }}
            />
          </div>

          <header className="login-rise relative flex flex-col gap-3">
            {marca.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={marca.logoUrl}
                alt=""
                className="mb-2 h-10 w-auto max-w-[min(160px,70vw)] object-contain"
              />
            ) : (
              <div className="login-line h-px w-10 bg-[#a17c4b]" />
            )}
            <h1
              className="text-[clamp(26px,7vw,30px)] leading-[1.1] tracking-[0.01em] text-[#1b1815]"
              style={{ fontFamily: 'var(--font-login-serif), Georgia, serif' }}
            >
              Dra. Izadora Barros
            </h1>
            <p className="text-[10.5px] uppercase tracking-[0.24em] text-[#8a8075]">
              Estética Avançada · CRO SP 173735
            </p>
          </header>

          <div className="login-rise-delay relative max-w-[520px] max-lg:pb-2">
            <p
              className="m-0 text-[clamp(24px,6.5vw,44px)] font-light leading-[1.12] tracking-[0.005em] text-pretty text-[#1b1815]"
              style={{ fontFamily: 'var(--font-login-serif), Georgia, serif', fontWeight: 300 }}
            >
              Cada paciente <em className="italic text-[#a17c4b]">acompanhada</em> do primeiro
              contato ao retorno.
            </p>
          </div>
        </section>

        <section
          className="relative flex items-center justify-center px-5 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-10 sm:py-[52px]"
          style={{
            background: 'radial-gradient(120% 90% at 100% 0%, #ffffff 0%, #f7f4ef 62%)',
          }}
        >
          <div
            className="absolute inset-y-0 left-0 hidden w-px lg:block"
            style={{
              background:
                'linear-gradient(180deg, rgba(161,124,75,0), rgba(161,124,75,.35), rgba(161,124,75,0))',
            }}
            aria-hidden="true"
          />
          <div
            className="login-float pointer-events-none absolute right-6 top-6 size-[88px] rounded-full border border-[rgba(161,124,75,0.18)] sm:right-14 sm:top-14 sm:size-[120px]"
            aria-hidden="true"
          />

          <form
            onSubmit={entrar}
            className="login-rise-card relative flex w-full max-w-[392px] flex-col gap-6 rounded-[22px] border border-[#e8e1d7] px-5 py-8 sm:gap-[30px] sm:px-10 sm:py-11"
            style={{
              background: 'rgba(255,255,255,.86)',
              backdropFilter: 'blur(14px)',
              boxShadow: '0 1px 2px rgba(27,24,21,.04), 0 44px 90px -54px rgba(27,24,21,.55)',
            }}
          >
            <header className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-[0.24em] text-[#a17c4b]">
                Área da clínica
              </span>
              <h2
                className="m-0 text-[clamp(26px,8vw,33px)] font-normal leading-[1.1] text-[#1b1815]"
                style={{ fontFamily: 'var(--font-login-serif), Georgia, serif' }}
              >
                Bem-vinda de volta
              </h2>
              <p className="m-0 text-[13px] leading-[1.55] text-[#5c554d]">
                Acesse a agenda, o funil e os retornos da sua clínica.
              </p>
            </header>

            <div className="flex flex-col gap-[18px]">
              <label className="flex flex-col gap-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-[#948b80]">E-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="voce@clinica.com.br"
                  value={email}
                  onChange={(evento) => {
                    setEmail(evento.target.value)
                    limparAviso()
                  }}
                  className={CAMPO}
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-[#948b80]">
                  Senha
                  <button
                    type="button"
                    className="min-h-11 tracking-[0.14em] text-[#a17c4b] transition-opacity hover:opacity-70"
                    onClick={() => setMostrarSenha((atual) => !atual)}
                  >
                    {mostrarSenha ? 'Ocultar' : 'Mostrar'}
                  </button>
                </span>
                <input
                  type={mostrarSenha ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={(evento) => {
                    setSenha(evento.target.value)
                    limparAviso()
                  }}
                  className={`${CAMPO} tracking-[0.06em]`}
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-[9px] text-[12.5px] text-[#5c554d] select-none"
                  onClick={() => setManterConectada((atual) => !atual)}
                >
                  <span
                    className="flex size-4 items-center justify-center rounded-[5px] text-[10px] text-white transition-[background,border-color]"
                    style={{
                      border: manterConectada ? '1px solid #a17c4b' : '1px solid #d8d0c4',
                      background: manterConectada ? '#a17c4b' : 'transparent',
                    }}
                    aria-hidden="true"
                  >
                    {manterConectada ? '✓' : ''}
                  </span>
                  Manter conectada
                </button>
                <button
                  type="button"
                  disabled={carregando}
                  onClick={esqueciSenha}
                  className="min-h-11 text-[12.5px] text-[#a17c4b] transition-colors hover:text-[#1b1815]"
                >
                  Esqueci a senha
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-[14px]">
              <button
                type="submit"
                disabled={carregando}
                className="relative flex h-[50px] min-h-11 items-center justify-center overflow-hidden rounded-[12px] text-[12.5px] uppercase tracking-[0.14em] text-white transition-[transform,box-shadow] duration-[180ms] hover:-translate-y-px disabled:opacity-60"
                style={{
                  background: 'linear-gradient(100deg, #8f6c3e, #b08a56 48%, #8f6c3e)',
                  boxShadow: '0 18px 34px -22px rgba(143,108,62,.9)',
                }}
              >
                <span className="relative z-10">{carregando ? 'Entrando…' : 'Entrar'}</span>
                <span
                  className="login-sheen pointer-events-none absolute inset-y-0 w-[44%]"
                  style={{
                    background:
                      'linear-gradient(100deg, rgba(255,255,255,0), rgba(255,255,255,.42), rgba(255,255,255,0))',
                  }}
                  aria-hidden="true"
                />
              </button>
              <p
                role={aviso ? (avisoOk ? 'status' : 'alert') : undefined}
                className="min-h-[17px] text-center text-[12.5px] tracking-[0.01em] text-pretty"
                style={{ color: avisoOk ? '#8f6c3e' : '#b4553a' }}
              >
                {aviso}
              </p>
            </div>

            <p className="m-0 text-center text-[11.5px] leading-[1.6] text-[#948b80]">
              Acesso restrito à equipe. Dados de pacientes protegidos pela LGPD.
            </p>
          </form>
        </section>
      </div>
    </main>
  )
}
