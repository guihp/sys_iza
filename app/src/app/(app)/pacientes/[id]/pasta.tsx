'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { ROTULOS_ANGULO, type AnguloFoto } from '@/domain/clinical/prontuario'
import { formatarDataExtensaComAno } from '@/lib/datetime'
import {
  destinoDoArquivo,
  tituloDeNomeArquivo,
} from '@/lib/pasta-paciente'
import { BOTAO_SECUNDARIO } from '../campos'
import { removerArquivo, subirArquivo, subirFoto } from './acoes-pasta'
import type { ArquivoLinha, FotoLinha } from './tipos'

type StatusEnvio = 'enviando' | 'ok' | 'erro'

type ItemFila = {
  id: string
  nome: string
  destino: 'foto' | 'arquivo'
  status: StatusEnvio
  erro?: string
}

const ANGULO_PADRAO: AnguloFoto = 'frontal'
const CATEGORIA_PADRAO = 'outro'

/**
 * Pasta — fotos clínicas e arquivos (termo escaneado, exames).
 * Uma zona de drop: imagens → fotos; demais aceitos → arquivos.
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
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fila, setFila] = useState<ItemFila[]>([])
  const [arrastando, setArrastando] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [pendenteRemocao, iniciarRemocao] = useTransition()

  function atualizarItem(id: string, patch: Partial<ItemFila>) {
    setFila((atual) => atual.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function enviarArquivo(arquivo: File) {
    const destino = destinoDoArquivo(arquivo.type)
    const id = `${arquivo.name}-${arquivo.size}-${arquivo.lastModified}-${Math.random().toString(36).slice(2, 8)}`

    if (!destino) {
      setFila((atual) => [
        ...atual,
        {
          id,
          nome: arquivo.name,
          destino: 'arquivo',
          status: 'erro',
          erro: 'Use JPEG, PNG, WebP ou PDF.',
        },
      ])
      return
    }

    setFila((atual) => [
      ...atual,
      { id, nome: arquivo.name, destino, status: 'enviando' },
    ])

    const dados = new FormData()
    dados.set('pacienteId', pacienteId)
    dados.set('arquivo', arquivo)

    if (destino === 'foto') {
      dados.set('angulo', ANGULO_PADRAO)
      const resultado = await subirFoto(dados)
      if (!resultado.ok) {
        atualizarItem(id, { status: 'erro', erro: resultado.erro })
        return
      }
    } else {
      dados.set('titulo', tituloDeNomeArquivo(arquivo.name))
      dados.set('categoria', CATEGORIA_PADRAO)
      const resultado = await subirArquivo(dados)
      if (!resultado.ok) {
        atualizarItem(id, { status: 'erro', erro: resultado.erro })
        return
      }
    }

    atualizarItem(id, { status: 'ok' })
  }

  function processarLista(lista: FileList | File[]) {
    const arquivosSelecionados = Array.from(lista)
    if (arquivosSelecionados.length === 0) return
    setErroGeral(null)
    void Promise.all(arquivosSelecionados.map((arquivo) => enviarArquivo(arquivo)))
  }

  return (
    <div className="space-y-8">
      {erroGeral ? (
        <p role="alert" className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700">
          {erroGeral}
        </p>
      ) : null}

      {!somenteLeitura ? (
        <div className="space-y-3">
          <label
            htmlFor={inputId}
            onDragEnter={(e) => {
              e.preventDefault()
              setArrastando(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setArrastando(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              if (e.currentTarget.contains(e.relatedTarget as Node)) return
              setArrastando(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setArrastando(false)
              processarLista(e.dataTransfer.files)
            }}
            className={[
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center transition',
              arrastando
                ? 'border-acento bg-acento/5'
                : 'border-linha bg-superficie/40 hover:border-acento/60',
            ].join(' ')}
          >
            <span className="font-serif text-lg text-texto">Solte ou escolha arquivos</span>
            <span className="max-w-sm text-sm text-texto/60">
              Imagens (JPEG, PNG, WebP) vão para fotos clínicas. PDF e demais aceitos, para
              arquivos. Upload inicia na hora.
            </span>
            <input
              id={inputId}
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) processarLista(e.target.files)
                e.target.value = ''
              }}
            />
          </label>

          {fila.length > 0 ? (
            <ul className="space-y-1.5 text-sm" aria-live="polite">
              {fila.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-linha/50 py-1.5 last:border-0"
                >
                  <span className="truncate text-texto">
                    {item.nome}
                    <span className="text-texto/50">
                      {' '}
                      · {item.destino === 'foto' ? 'foto' : 'arquivo'}
                    </span>
                  </span>
                  <span
                    className={
                      item.status === 'erro'
                        ? 'text-red-700'
                        : item.status === 'ok'
                          ? 'text-emerald-700'
                          : 'text-texto/60'
                    }
                  >
                    {item.status === 'enviando'
                      ? 'Enviando…'
                      : item.status === 'ok'
                        ? 'Enviado'
                        : item.erro ?? 'Erro'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-4">
        <header>
          <h2 className="font-serif text-lg">Fotos clínicas</h2>
          <p className="text-sm text-texto/60">
            Bucket privado · link assinado por 15 minutos
          </p>
        </header>

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
                      disabled={pendenteRemocao}
                      onClick={() => {
                        setErroGeral(null)
                        iniciarRemocao(async () => {
                          const resultado = await removerArquivo({
                            pacienteId,
                            id: foto.id,
                            tipo: 'foto',
                          })
                          if (!resultado.ok) setErroGeral(resultado.erro)
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
            Termo assinado em papel, exames, PDF
          </p>
        </header>

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
                      disabled={pendenteRemocao}
                      onClick={() => {
                        setErroGeral(null)
                        iniciarRemocao(async () => {
                          const resultado = await removerArquivo({
                            pacienteId,
                            id: arquivo.id,
                            tipo: 'arquivo',
                          })
                          if (!resultado.ok) setErroGeral(resultado.erro)
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
