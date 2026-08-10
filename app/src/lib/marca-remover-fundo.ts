/**
 * Remove o fundo da logo no browser (WASM / ONNX via @imgly).
 * Só roda no client — import dinâmico para não ir no bundle do servidor.
 */

export async function removerFundoDeImagem(fonte: string | Blob | File): Promise<File> {
  const { removeBackground } = await import('@imgly/background-removal')
  const blob = await removeBackground(fonte, {
    output: { format: 'image/png', quality: 0.9 },
  })
  const nome =
    fonte instanceof File
      ? fonte.name.replace(/\.[^.]+$/, '') + '-sem-fundo.png'
      : `logo-sem-fundo-${Date.now()}.png`
  return new File([blob], nome, { type: 'image/png' })
}
