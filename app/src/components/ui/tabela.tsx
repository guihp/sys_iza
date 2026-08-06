import type { ComponentProps } from 'react'
import { juntar } from './classes'
import { classesDeRotuloMiudo } from './rotulo-miudo'

/**
 * Tabela do sistema: cabeçalho em rótulo miúdo com borda embaixo, linhas
 * separadas por borda, **sem zebra**, e a última linha sem borda.
 *
 * As peças são separadas de propósito — cada tela monta as colunas que precisa.
 * A regra da borda mora em `<TabelaCorpo>` e não em `<TabelaLinha>` porque
 * `last:` sobre a linha também apagaria a borda do cabeçalho, que é filho único
 * do `<thead>`.
 *
 * `<Tabela>` já vem com rolagem horizontal própria: numa tela estreita é a
 * tabela que rola, nunca a página inteira — a sidebar fica onde está.
 */
export function Tabela({ className, ...resto }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={juntar('w-full border-collapse text-left', className)} {...resto} />
    </div>
  )
}

export function TabelaCabecalho({ className, ...resto }: ComponentProps<'thead'>) {
  return (
    <thead className={juntar('[&>tr]:border-b [&>tr]:border-linha', className)} {...resto} />
  )
}

export function TabelaCorpo({ className, ...resto }: ComponentProps<'tbody'>) {
  return (
    <tbody
      className={juntar(
        '[&>tr]:border-b [&>tr]:border-linha [&>tr:last-child]:border-b-0',
        className,
      )}
      {...resto}
    />
  )
}

export function TabelaLinha({ className, ...resto }: ComponentProps<'tr'>) {
  return <tr className={className} {...resto} />
}

/** `<th>` do cabeçalho, já com o rótulo miúdo. */
export function TabelaColuna({ className, scope = 'col', ...resto }: ComponentProps<'th'>) {
  return (
    <th
      scope={scope}
      className={juntar(classesDeRotuloMiudo(), 'py-3 pr-4 font-normal last:pr-0', className)}
      {...resto}
    />
  )
}

export function TabelaCelula({ className, ...resto }: ComponentProps<'td'>) {
  return <td className={juntar('py-4 pr-4 align-middle last:pr-0', className)} {...resto} />
}
