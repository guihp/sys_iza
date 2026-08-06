export type Tema = 'claro' | 'escuro'

export const CHAVE_TEMA = 'tema'

/** Evento interno: avisa o `ThemeToggle` de que o tema mudou nesta aba. */
export const EVENTO_TEMA = 'tema:alterado'

export function ehTema(valor: unknown): valor is Tema {
  return valor === 'claro' || valor === 'escuro'
}

/**
 * Roda no `<head>`, antes da primeira pintura, para evitar o flash branco de
 * quem escolheu o escuro. Só marca `data-tema` se houver escolha salva —
 * sem escolha, quem decide continua sendo o `prefers-color-scheme` do CSS.
 */
export const SCRIPT_TEMA_INICIAL = `try{var t=localStorage.getItem('${CHAVE_TEMA}');if(t==='claro'||t==='escuro'){document.documentElement.dataset.tema=t}}catch(e){}`
