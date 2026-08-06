/**
 * Formatação e filtros da tela de Retornos.
 *
 * Separado de `page.tsx` e de `fila.ts` porque é desenho, não regra de quem
 * entra na fila: rótulo de ciclo, texto de atraso, chip da URL e link do
 * WhatsApp. Funções puras — testáveis sem banco e sem React.
 */

import type { LinhaDaFila } from './fila'

/** Valores aceitos em `?filtro=`. Qualquer outra coisa vira `todos`. */
export type FiltroDaFila = 'vencidos' | 'a_vencer' | 'todos'

/**
 * Intervalo do catálogo → "ciclo de 5 meses" / "ciclo de 45 dias".
 *
 * Abaixo de 60 dias o mockup fala em dias; a partir daí, meses arredondados
 * (30 dias ≈ 1 mês). `null` é procedimento sem retorno no catálogo — a linha
 * ainda pode existir se alguém ajustou o vencimento na mão, e aí não há ciclo
 * para mostrar.
 */
export function descreverCiclo(dias: number | null): string | null {
  if (dias === null || dias <= 0) return null
  if (dias < 60) return dias === 1 ? 'ciclo de 1 dia' : `ciclo de ${dias} dias`
  const meses = Math.round(dias / 30)
  return meses === 1 ? 'ciclo de 1 mês' : `ciclo de ${meses} meses`
}

/**
 * Texto da coluna RETORNO.
 *
 * Vencido: `58 dias em atraso` (o mockup não usa "vencido há"). Em dia: `vence
 * em 12 dias` / `vence hoje`. O tom (alerta vs suave) fica no JSX.
 */
export function textoDoRetorno(diasRestantes: number): string {
  if (diasRestantes < 0) {
    const atraso = Math.abs(diasRestantes)
    return atraso === 1 ? '1 dia em atraso' : `${atraso} dias em atraso`
  }
  if (diasRestantes === 0) return 'vence hoje'
  return diasRestantes === 1 ? 'vence em 1 dia' : `vence em ${diasRestantes} dias`
}

/** Lê `?filtro=` da URL. Valor inválido ou ausente → `todos`. */
export function filtroDaUrl(valor: string | string[] | undefined): FiltroDaFila {
  const bruto = Array.isArray(valor) ? valor[0] : valor
  if (bruto === 'vencidos' || bruto === 'a_vencer' || bruto === 'todos') return bruto
  return 'todos'
}

/** Aplica o chip ativo sobre a fila já montada. */
export function filtrarFila(fila: LinhaDaFila[], filtro: FiltroDaFila): LinhaDaFila[] {
  if (filtro === 'vencidos') return fila.filter((linha) => linha.status === 'vencido')
  if (filtro === 'a_vencer') return fila.filter((linha) => linha.status === 'vencendo')
  return fila
}

/**
 * `https://wa.me/<E.164 sem +>?text=…`.
 *
 * O número já vem em E.164 (`+5511…`); o wa.me quer só dígitos. Texto pré-
 * preenchido a partir do template — a secretária ainda precisa apertar enviar
 * no app; isto não passa pela Evolution.
 */
export function linkWhatsApp(telefoneE164: string, texto: string): string {
  const numero = telefoneE164.replace(/\D/g, '')
  const base = `https://wa.me/${numero}`
  if (!texto) return base
  return `${base}?text=${encodeURIComponent(texto)}`
}

/**
 * Como a paciente é chamada no texto do WhatsApp — mesma regra do worker:
 * apelido do cadastro, senão o primeiro nome.
 */
export function tratamentoParaMensagem(
  nomeCompleto: string,
  apelido: string | null | undefined,
): string {
  const preferido = apelido?.trim()
  if (preferido) return preferido
  return nomeCompleto.trim().split(/\s+/)[0] || ''
}
