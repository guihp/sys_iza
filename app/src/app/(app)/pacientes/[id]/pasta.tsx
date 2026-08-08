'use client'

import { useRef, useState, useTransition } from 'react'
import { ROTULOS_ANGULO, type AnguloFoto } from '@/domain/clinical/prontuario'
import { formatarDataExtensaComAno } from '@/lib/datetime'
import { BOTAO_PRINCIPAL, BOTAO_SECUNDARIO, CAMPO } from '../campos'
import { removerArquivo, subirArquivo, subirFoto } from './acoes-pasta'
import type { ArquivoLinha, FotoLinha } from './tipos'

/**
 * Pasta — fotos clínicas e arquivos (termo escaneado, exames).
 * URLs assinadas de curta duração; nunca públicas.
 */
export function PastaDoPaciente({
  pacienteId,
  fotos,
  arquivos,
  somenteLeitura,
}: {
  pacienteId: string
  fotos: FotoLinha[]
  arquivos: ArquivoLinha[]
  somenteLeitura: boolean
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const [angulo, setAngulo] = useState<AnguloFoto>('frontal')
  const [titulo, setTitulo] = useState('Termo assinado')
  const [categoria, setCategoria] = useState('termo')
  const inputFoto = useRef<HTMLInputElement>(null)
  const inputArquivo = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-8">
      {erro ? (
        <p role="alert" className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {ok}
        </p>
      ) : null}

      <section className="space-y-4">
        <header>
          <h2 className="font-serif text-lg">Fotos clínicas</h2>
          <p className="text-sm text-texto/60">
            Bucket privado · link assinado por 15 minutos
          </p>
        </header>

        {!somenteLeitura ? (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-linha p-4">
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Ângulo</span>
              <select
                value={angulo}
                onChange={(e) => setAngulo(e.target.value as AnguloFoto)}
                className={CAMPO}
              >
                {(Object.keys(ROTULOS_ANGULO) as AnguloFoto[]).map((a) => (
                  <option key={a} value={a}>
                    {ROTULOS_ANGULO[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Arquivo</span>
              <input
                ref={inputFoto}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="block text-sm"
              />
            </label>
            <button
              type="button"
              disabled={pendente}
              className={BOTAO_PRINCIPAL}
              onClick={() => {
                const arquivo = inputFoto.current?.files?.[0]
                if (!arquivo) {
                  setErro('Escolha uma foto.')
                  return
                }
                setErro(null)
                setOk(null)
                const dados = new FormData()
                dados.set('pacienteId', pacienteId)
                dados.set('angulo', angulo)
                dados.set('arquivo', arquivo)
                iniciar(async () => {
                  const resultado = await subirFoto(dados)
                  if (!resultado.ok) {
                    setErro(resultado.erro)
                    return
                  }
                  setOk('Foto enviada.')
                  if (inputFoto.current) inputFoto.current.value = ''
                })
              }}
            >
              {pendente ? 'Enviando…' : 'Enviar foto'}
            </button>
          </div>
        ) : null}

        {fotos.length === 0 ? (
          <p className="text-sm text-texto/60">Nenhuma foto ainda.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fotos.map((foto) => (
              <li key={foto.id} className="overflow-hidden rounded-xl border border-linha">
                {foto.urlAssinada ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={foto.urlAssinada}
                    alt={ROTULOS_ANGULO[foto.angulo as AnguloFoto] ?? foto.angulo}
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-superficie text-sm text-texto/50">
                    Link expirado — recarregue
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {ROTULOS_ANGULO[foto.angulo as AnguloFoto] ?? foto.angulo}
                    </p>
                    <p className="text-xs text-texto/50">
                      {formatarDataExtensaComAno(foto.criado_em.slice(0, 10))}
                    </p>
                  </div>
                  {!somenteLeitura ? (
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline"
                      disabled={pendente}
                      onClick={() => {
                        iniciar(async () => {
                          const resultado = await removerArquivo({
                            pacienteId,
                            id: foto.id,
                            tipo: 'foto',
                          })
                          if (!resultado.ok) setErro(resultado.erro)
                          else setOk('Foto removida.')
                        })
                      }}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <header>
          <h2 className="font-serif text-lg">Arquivos</h2>
          <p className="text-sm text-texto/60">
            Termo assinado em papel, exames, PDF/JPG
          </p>
        </header>

        {!somenteLeitura ? (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-linha p-4">
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Título</span>
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                className={CAMPO}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Categoria</span>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className={CAMPO}
              >
                <option value="termo">Termo</option>
                <option value="exame">Exame</option>
                <option value="outro">Outro</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-texto/80">Arquivo</span>
              <input
                ref={inputArquivo}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="block text-sm"
              />
            </label>
            <button
              type="button"
              disabled={pendente}
              className={BOTAO_PRINCIPAL}
              onClick={() => {
                const arquivo = inputArquivo.current?.files?.[0]
                if (!arquivo) {
                  setErro('Escolha um arquivo.')
                  return
                }
                setErro(null)
                setOk(null)
                const dados = new FormData()
                dados.set('pacienteId', pacienteId)
                dados.set('titulo', titulo)
                dados.set('categoria', categoria)
                dados.set('arquivo', arquivo)
                iniciar(async () => {
                  const resultado = await subirArquivo(dados)
                  if (!resultado.ok) {
                    setErro(resultado.erro)
                    return
                  }
                  setOk('Arquivo enviado.')
                  if (inputArquivo.current) inputArquivo.current.value = ''
                })
              }}
            >
              {pendente ? 'Enviando…' : 'Enviar arquivo'}
            </button>
          </div>
        ) : null}

        {arquivos.length === 0 ? (
          <p className="text-sm text-texto/60">Nenhum arquivo ainda.</p>
        ) : (
          <ul className="space-y-2">
            {arquivos.map((arquivo) => (
              <li
                key={arquivo.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-linha px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{arquivo.titulo}</p>
                  <p className="text-xs text-texto/50">
                    {arquivo.categoria} · {formatarDataExtensaComAno(arquivo.criado_em.slice(0, 10))}
                  </p>
                </div>
                <div className="flex gap-2">
                  {arquivo.urlAssinada ? (
                    <a
                      href={arquivo.urlAssinada}
                      target="_blank"
                      rel="noreferrer"
                      className={BOTAO_SECUNDARIO}
                    >
                      Abrir
                    </a>
                  ) : (
                    <span className="text-xs text-texto/50">Link expirado</span>
                  )}
                  {!somenteLeitura ? (
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline"
                      disabled={pendente}
                      onClick={() => {
                        iniciar(async () => {
                          const resultado = await removerArquivo({
                            pacienteId,
                            id: arquivo.id,
                            tipo: 'arquivo',
                          })
                          if (!resultado.ok) setErro(resultado.erro)
                          else setOk('Arquivo removido.')
                        })
                      }}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
