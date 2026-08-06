/**
 * Renderização das mensagens enviadas ao paciente.
 *
 * Módulo puro: sem I/O, sem Supabase, sem React, sem Next. O texto vem da tabela
 * `message_templates`, editável pela Dra. (Task 13), e é aqui que ele vira a
 * frase que a paciente lê.
 *
 * A sintaxe é `{{variavel}}` e só isso: sem condicional, sem laço, sem
 * expressão. É deliberado. Quem escreve o texto é a Dra., não um programador, e
 * uma linguagem de template completa transformaria um erro de digitação num erro
 * de execução no meio do disparo — ou, pior, numa porta para o conteúdo do banco
 * executar algo. Substituição de variável é tudo o que a mensagem precisa.
 */

/**
 * `\w+` e nada além: letra, dígito e sublinhado. Nome com espaço ou hífen no
 * meio não é variável e fica no texto como está — assim um `{{ ... }}` digitado
 * por engano aparece visível para quem revisa o template, em vez de sumir.
 */
const VARIAVEL = /\{\{\s*(\w+)\s*\}\}/g

/**
 * Substitui `{{variavel}}` pelo valor.
 *
 * Variável ausente vira string vazia: é melhor mandar uma frase incompleta do
 * que expor `{{nome}}` ao paciente. Um campo em branco no cadastro passa
 * despercebido; a chave crua na mensagem é constrangimento imediato e público.
 *
 * A substituição usa função de callback, e não string, por dois motivos que
 * seriam bugs difíceis de achar: numa string de substituição o `$&` e o `$1`
 * teriam significado especial, e um valor legítimo como "R$ 1.000" seria
 * corrompido; e o resultado da função não é reprocessado pelo regex, então um
 * paciente cadastrado como "{{telefone}}" não consegue fazer a própria mensagem
 * revelar outra variável.
 */
export function renderizarTemplate(texto: string, variaveis: Record<string, string>): string {
  return texto.replace(VARIAVEL, (_, chave: string) => variaveis[chave] ?? '')
}

/**
 * Variáveis citadas no texto, na ordem em que aparecem e sem repetição.
 *
 * Serve ao editor de mensagens: dá para avisar a Dra. de que ela escreveu
 * `{{procedimeto}}` antes de a mensagem sair com um buraco no meio.
 */
export function variaveisDoTemplate(texto: string): string[] {
  const encontradas = new Set<string>()
  for (const achado of texto.matchAll(VARIAVEL)) encontradas.add(achado[1])
  return [...encontradas]
}
