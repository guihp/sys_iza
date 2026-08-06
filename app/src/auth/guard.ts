import type { Sessao } from '@/auth/session'

export class ErroDePermissao extends Error {
  constructor(mensagem = 'Você não tem permissão para esta ação') {
    super(mensagem)
    this.name = 'ErroDePermissao'
  }
}

/** Função pura: recebe a sessão já resolvida, para poder ser testada sem I/O. */
export function exigirDra(sessao: Sessao | null): Sessao {
  if (!sessao) throw new ErroDePermissao('Sessão expirada')
  if (sessao.role !== 'dra') throw new ErroDePermissao()
  return sessao
}
