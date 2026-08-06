/**
 * Telefone brasileiro em E.164.
 *
 * Função pura, sem React, sem Supabase e sem Next: o telefone é a chave por
 * onde o paciente recebe lembrete no WhatsApp, então normalizar errado não dá
 * erro na tela — dá mensagem entregue na pessoa errada, ou não entregue.
 * Guardar sempre em E.164 (`+5511987654321`) é o que torna o índice único de
 * `patients.telefone` capaz de detectar duplicata: "(11) 98765-4321" e
 * "11987654321" são o mesmo paciente e precisam colidir no banco.
 */

/**
 * Normaliza telefone brasileiro para E.164. Devolve null quando não dá
 * para inferir um número válido — o chamador decide o que fazer.
 */
export function normalizarTelefone(bruto: string): string | null {
  let digitos = bruto.replace(/\D/g, '')

  // O "55" da frente só é código de país a partir de 12 dígitos: um número
  // nacional tem no máximo 11 (DDD + celular). Sem esse piso, o DDD 55
  // (Santa Maria/RS) seria comido como se fosse código de país.
  if (digitos.startsWith('55') && digitos.length >= 12) {
    digitos = digitos.slice(2)
  }
  // Zero de operadora/tronco discado antes do DDD — vem muito de agenda antiga.
  if (digitos.startsWith('0')) {
    digitos = digitos.slice(1)
  }
  // 10 dígitos = DDD + fixo; 11 = DDD + celular com nono dígito.
  if (digitos.length !== 10 && digitos.length !== 11) return null

  return `+55${digitos}`
}

/**
 * E.164 → "(11) 98765-4321", para leitura na tela. Só sabe formatar número
 * brasileiro; qualquer outra coisa volta como está, porque exibir errado é
 * pior do que exibir cru. `null` e vazio viram travessão.
 */
export function formatarTelefone(e164: string | null | undefined): string {
  if (!e164) return '—'

  const brasileiro = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164)
  if (!brasileiro) return e164

  const [, ddd, prefixo, sufixo] = brasileiro
  return `(${ddd}) ${prefixo}-${sufixo}`
}
