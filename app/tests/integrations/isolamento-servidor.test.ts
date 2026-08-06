/**
 * Sem docblock de ambiente: este arquivo roda de propósito no jsdom, onde
 * `window` existe. É o único lugar do projeto que simula o browser para provar
 * que os adaptadores de envio se recusam a rodar lá.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { criarEvolutionClient } from '@/integrations/evolution/client'
import { criarEmailClient } from '@/integrations/email/resend'

/** `pnpm test` roda com o cwd em `app/`. */
const RAIZ_SRC = path.resolve(process.cwd(), 'src')

describe('guarda de servidor em tempo de execução', () => {
  it('o cliente da Evolution se recusa a existir no browser', () => {
    expect(typeof window).toBe('object')
    expect(() =>
      criarEvolutionClient({ url: 'http://x', apiKey: 'k', instancia: 'i' }),
    ).toThrow(/servidor/i)
  })

  it('o cliente de e-mail se recusa a existir no browser', () => {
    expect(() => criarEmailClient({ apiKey: 'k', remetente: 'a@b.com' })).toThrow(/servidor/i)
  })
})

// ---------------------------------------------------------------------------
// Checagem estática: nenhum Client Component alcança src/integrations
// ---------------------------------------------------------------------------

function listarArquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const completo = path.join(dir, nome)
    if (statSync(completo).isDirectory()) return listarArquivos(completo)
    return /\.tsx?$/.test(nome) ? [completo] : []
  })
}

function ehClientComponent(conteudo: string): boolean {
  return /^\s*(['"])use client\1/m.test(conteudo.slice(0, 200))
}

/** `@/a/b` -> caminho absoluto do arquivo, testando as extensões do projeto. */
function resolverAlias(especificador: string): string | null {
  const base = path.join(RAIZ_SRC, especificador.slice('@/'.length))
  for (const tentativa of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(tentativa).isFile()) return tentativa
    } catch {
      // caminho inexistente: tenta a próxima extensão
    }
  }
  return null
}

function importesInternos(conteudo: string): string[] {
  const achados = new Set<string>()
  for (const m of conteudo.matchAll(/from\s+['"](@\/[^'"]+)['"]/g)) achados.add(m[1])
  for (const m of conteudo.matchAll(/import\(\s*['"](@\/[^'"]+)['"]\s*\)/g)) achados.add(m[1])
  return [...achados]
}

describe('nenhum segredo de envio chega ao browser', () => {
  const arquivos = listarArquivos(RAIZ_SRC)

  it('nenhum módulo de integração é marcado como Client Component', () => {
    const integracoes = arquivos.filter((a) => a.includes(`${path.sep}integrations${path.sep}`))
    expect(integracoes.length).toBeGreaterThan(0)
    for (const arquivo of integracoes) {
      expect(ehClientComponent(readFileSync(arquivo, 'utf8')), arquivo).toBe(false)
    }
  })

  it('nenhum Client Component importa src/integrations, nem de forma indireta', () => {
    const clientes = arquivos.filter((a) => ehClientComponent(readFileSync(a, 'utf8')))
    expect(clientes.length).toBeGreaterThan(0)

    const alcancados = new Map<string, string[]>()
    for (const raiz of clientes) {
      const pilha: Array<{ arquivo: string; caminho: string[] }> = [
        { arquivo: raiz, caminho: [path.relative(RAIZ_SRC, raiz)] },
      ]
      const visitados = new Set<string>()
      while (pilha.length > 0) {
        const { arquivo, caminho } = pilha.pop()!
        if (visitados.has(arquivo)) continue
        visitados.add(arquivo)

        const relativo = path.relative(RAIZ_SRC, arquivo)
        if (relativo.startsWith(`integrations${path.sep}`)) {
          alcancados.set(relativo, caminho)
          continue
        }
        for (const especificador of importesInternos(readFileSync(arquivo, 'utf8'))) {
          const destino = resolverAlias(especificador)
          if (destino) pilha.push({ arquivo: destino, caminho: [...caminho, especificador] })
        }
      }
    }

    expect(
      [...alcancados].map(([alvo, caminho]) => `${alvo} via ${caminho.join(' -> ')}`),
    ).toEqual([])
  })
})
