# n8n — captura da atribuição de anúncio (ctwa_clid)

Este fluxo roda **no n8n**, fora deste repositório. Ele é o primeiro elo da
atribuição: sem ele, nenhum evento consegue voltar para a Meta, porque não
existe como ligar a paciente ao anúncio depois que a conversa começa.

Base: payload real de `messages.upsert` da Evolution API, coletado em
2026-08-06.

> **Reconciliar antes de aplicar:** os nomes de tabela e coluna abaixo seguem o
> plano. Confira contra a migration `0010_atribuicao_meta.sql` que estiver no
> repositório — se ela divergir, a migration vence.

---

## 1. Onde entra

No workflow que já recebe o webhook `messages.upsert`, **antes** de qualquer nó
que responda a paciente. A gravação da atribuição não pode depender de a IA
responder, nem pode atrasar a resposta: se este ramo falhar, o atendimento
segue.

Desenhe como ramo paralelo (dois caminhos saindo do webhook), não em série.

---

## 2. O gatilho: só mensagem vinda de anúncio

Mensagem orgânica **não** pode entrar na tabela — ela poluiria a atribuição com
gente que nunca clicou em anúncio.

Nó **IF**, condição verdadeira só quando existe o bloco de anúncio:

```
{{ $json.body.data.contextInfo?.externalAdReply?.ctwaClid != null }}
```

Sem `ctwaClid`, o ramo termina ali. Sem erro, sem log de pânico — é o caso
comum.

---

## 3. Extração — nó Code

```js
// Um item por mensagem. Retorna [] quando não for mensagem de anúncio,
// para o caso de o IF acima ser removido por engano no futuro.
const saida = [];

for (const item of $input.all()) {
  const data = item.json.body?.data ?? item.json.data;
  const anuncio = data?.contextInfo?.externalAdReply;
  if (!anuncio?.ctwaClid) continue;

  // --- telefone ---------------------------------------------------------
  // `remoteJid` pode vir como LID (addressingMode: "lid"), que NÃO é o
  // telefone. Quando `remoteJidAlt` existe, ele é o número real.
  const jid = data.key?.remoteJidAlt || data.key?.remoteJid || '';
  const telefone = normalizarE164BR(jid.split('@')[0]);
  if (!telefone) continue; // sem telefone não há como vincular depois

  // --- horário ----------------------------------------------------------
  // messageTimestamp vem em SEGUNDOS. Tratar como milissegundos joga o
  // evento para 1970 e a Meta descarta o evento sem avisar.
  const segundos = Number(data.messageTimestamp);
  const primeiroContato = Number.isFinite(segundos)
    ? new Date(segundos * 1000).toISOString()
    : new Date().toISOString();

  saida.push({
    json: {
      telefone,
      ctwa_clid: anuncio.ctwaClid,
      ad_id: anuncio.sourceId ?? null,
      source_app: anuncio.sourceApp ?? null,
      source_url: anuncio.sourceUrl ?? null,
      ad_title: anuncio.title ?? null,
      ad_body: anuncio.body ?? null,
      greeting_message: anuncio.greetingMessageBody ?? null,
      push_name: data.pushName ?? null,
      primeiro_contato_em: primeiroContato,
    },
  });
}

return saida;

// Espelha src/lib/phone.ts do app. Mantenha os dois iguais: se divergirem,
// o mesmo número vira duas linhas e a atribuição se perde.
function normalizarE164BR(bruto) {
  let d = String(bruto || '').replace(/\D/g, '');
  // Só tira o 55 do começo se sobrarem 12+ dígitos. Sem esse piso, o DDD 55
  // (Santa Maria/RS) seria comido como código de país e geraria um número
  // errado que ainda passa em qualquer validação de comprimento.
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return null;
  return '+55' + d;
}
```

---

## 4. Gravação no Supabase

Nó **HTTP Request** (o nó nativo do Supabase não expõe o cabeçalho de conflito
que precisamos).

- Método: `POST`
- URL: `https://mcdzuspmhqzftmnocjlp.supabase.co/rest/v1/lead_attribution`
- Cabeçalhos:
  - `apikey`: a **service_role key** (o n8n escreve fora de sessão de usuário;
    a RLS da tabela não tem policy de escrita para papel humano de propósito)
  - `Authorization`: `Bearer <service_role key>`
  - `Content-Type`: `application/json`
  - `Prefer`: `resolution=ignore-duplicates,return=minimal`
- Corpo: o JSON do nó anterior.

### O `ignore-duplicates` é a regra de negócio, não uma otimização

O índice único é por telefone. Da segunda mensagem em diante, o `insert` colide
e é **descartado** — que é exatamente o comportamento desejado.

Se em vez disso fosse `merge-duplicates` (upsert), a segunda mensagem
sobrescreveria o `ctwa_clid` e o `ad_id`. Consequência prática: uma paciente que
clicou no anúncio A em janeiro e mandou "oi" de novo em março depois de ver o
anúncio B teria a venda creditada ao B. O A, que realmente trouxe a paciente,
apareceria como se não convertesse nada — e você pausaria o anúncio bom.

**Primeiro clique vence. Sempre.**

---

## 5. Tratamento de erro

Marque o nó HTTP com **"Continue On Fail"**. Se o Supabase estiver fora, a
atribuição daquela mensagem é perdida — e isso é aceitável. O que não é
aceitável é a paciente ficar sem resposta porque a gravação de marketing falhou.

Se quiser rede de segurança, mande a falha para uma fila de reprocesso do n8n.
Não bloqueie o ramo de atendimento em nenhuma hipótese.

---

## 6. Como conferir que funcionou

1. Publique um anúncio de clique-pro-WhatsApp e clique nele do seu próprio
   celular.
2. No Supabase → Table Editor → `lead_attribution`, a linha tem que aparecer com
   `ctwa_clid` preenchido e `ad_id` batendo com o ID do anúncio no Gerenciador.
3. Mande uma segunda mensagem do mesmo número. **A linha não pode mudar** —
   nem `ctwa_clid`, nem `ad_id`, nem `primeiro_contato_em`. Se mudou, o
   `Prefer` está errado.
4. Mande uma mensagem de um número que nunca viu anúncio. **Nenhuma linha nova.**
   Se apareceu, o IF do passo 2 está deixando passar.

---

## 7. O que este fluxo deliberadamente não faz

- **Não cria paciente.** Cadastro é do app, com as regras dele. Esta tabela é só
  o registro de "este telefone veio deste anúncio"; o vínculo acontece do lado
  do app quando a paciente existir.
- **Não manda nada para a Meta.** O envio dos eventos de conversão é do worker
  do app, que tem a regra de consentimento da LGPD. O n8n só captura.
- **Não guarda conteúdo de conversa.** Só os campos listados. Mensagem de
  paciente é dado clínico e não tem por que estar numa tabela de marketing.
