import type { AutosaveStatus } from '@/hooks/use-autosave'

/**
 * Indicador discreto ao lado do formulário — sem modal bloqueante.
 * "Salvo" só aparece quando o hook confirma `{ ok: true }` do servidor.
 */
export function StatusAutosave({
  status,
  erro,
}: {
  status: AutosaveStatus
  erro: string | null
}) {
  if (status === 'idle') return null

  if (status === 'error') {
    return (
      <p role="alert" className="text-sm text-red-700">
        {erro ?? 'Erro ao salvar.'}
      </p>
    )
  }

  if (status === 'saved') {
    return (
      <p role="status" className="text-sm text-texto/50">
        Salvo
      </p>
    )
  }

  if (status === 'dirty') {
    return (
      <p role="status" className="text-sm text-texto/50">
        Alterado…
      </p>
    )
  }

  return (
    <p role="status" className="text-sm text-texto/50">
      Salvando…
    </p>
  )
}
