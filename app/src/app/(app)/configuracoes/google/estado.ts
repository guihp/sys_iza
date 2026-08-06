/**
 * Estado da sincronia com o Google Agenda, para a tela.
 *
 * Separado da `page.tsx` por um motivo específico: `configuracaoDoGoogle` mora
 * no módulo do adaptador, que chama `garantirServidor()` e carrega
 * `node:crypto`. Concentrar aqui a tradução "configuração → o que a Dra. lê"
 * deixa a decisão testável sem renderizar página e sem tocar no adaptador.
 *
 * O que esta função devolve chega ao HTML. Por isso ela nunca leva a chave
 * privada junto — só o que dá para publicar numa tela: se está ligada, para
 * qual agenda, e qual endereço precisa receber o compartilhamento.
 */

export type EstadoDoGoogle =
  | { ligada: false }
  | { ligada: true; contaDeServico: string; calendarId: string }

type EnvDoGoogle = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string
  GOOGLE_PRIVATE_KEY?: string
  GOOGLE_CALENDAR_ID?: string
}

export function estadoDoGoogle(env: EnvDoGoogle): EstadoDoGoogle {
  // Mesma regra do adaptador: as três variáveis ou nada. A tela precisa dizer
  // "desligada" exatamente quando a sincronia não vai acontecer — anunciar
  // "conectado" com meia credencial seria a Dra. confiar num espelho que não
  // está espelhando.
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_CALENDAR_ID) {
    return { ligada: false }
  }

  return {
    ligada: true,
    contaDeServico: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    calendarId: env.GOOGLE_CALENDAR_ID,
  }
}
