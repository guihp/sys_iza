import type { ReactNode } from 'react'
import { juntar } from './classes'

/**
 * Estado vazio.
 *
 * Não é enfeite: o banco desta clínica está vazio por decisão do dono — zero
 * pacientes, zero consultas — e vai continuar assim até a primeira paciente
 * real entrar. Toda lista, coluna, tabela e grade precisa dizer o que está
 * faltando e, quando fizer sentido, oferecer o caminho para preencher.
 * Área em branco sem explicação lê como tela quebrada.
 *
 * `explicacao` é a segunda linha, para quando a frase curta não basta — "a fila
 * enche sozinha conforme os atendimentos vencem", por exemplo. `acao` é um
 * botão ou link já pronto (normalmente uma `<Pilula>`).
 */
export function EstadoVazio({
  mensagem,
  explicacao,
  acao,
  className,
}: {
  mensagem: ReactNode
  explicacao?: ReactNode
  acao?: ReactNode
  className?: string
}) {
  return (
    <div
      className={juntar(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-[13px] text-texto-suave">{mensagem}</p>
      {explicacao ? (
        <p className="max-w-[44ch] text-[11px] text-texto-suave">{explicacao}</p>
      ) : null}
      {acao}
    </div>
  )
}
