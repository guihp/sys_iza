# Atribuição e otimização de anúncios da Meta — plano

**Objetivo:** fechar o ciclo entre o anúncio e o resultado clínico. Hoje a Meta
otimiza por "conversa iniciada", que é o sinal mais raso que existe — ela
aprende a encontrar quem gosta de mandar mensagem, não quem agenda e paga. O
plano dá à Meta o sinal certo e dá à clínica o CAC real por anúncio.

## Situação levantada em 2026-08-06

Conta de anúncios `1526237358668434` ("Izadora", business Elonai Automações,
BRL).

| Campanha | Objetivo | Gasto | Resultado | Estado |
|---|---|---|---|---|
| Izadora - Whatsapp - Leads | OUTCOME_ENGAGEMENT | R$ 179,96 | 24 conversas · R$ 7,50 | pausada |
| Trafego instagram Izadora | LINK_CLICKS | R$ 81,47 | 402 visitas ao perfil · R$ 0,20 | pausada |

**Zero datasets (pixel). Zero conversões personalizadas.** Não existe canal de
volta para a Meta. É a lacuna que este plano fecha.

## Decisões tomadas pelo dono

- Evento que a Meta deve perseguir: **`agendado`**. Os eventos mais fundos
  (compareceu, virou paciente) são enviados também, mas para relatório — o
  volume atual não sustenta otimização por eles.
- A página dentro do sistema é **somente leitura**. Pausar anúncio e mexer em
  orçamento continua no Gerenciador.
- O dataset e o token são criados pelo dono, com passo a passo (o MCP da Meta
  só tem leitura para dataset).

---

## Restrição legal — não é opcional

Dado de saúde é **dado sensível** na LGPD (art. 11). O consentimento tem que ser
específico e destacado; aceite genérico não serve.

Regras que o código precisa cumprir:

1. **Só envia evento de quem tem `consentimento_lgpd_em` preenchido.** Sem
   consentimento, o evento simplesmente não sai — e isso é comportamento
   testado, não um `if` solto.
2. **Nunca enviar nome de procedimento, observação clínica ou qualquer coisa do
   prontuário.** O evento carrega: tipo, horário, identificador com hash e, no
   `Purchase`, um valor monetário. Nada além disso.
3. O valor monetário revela faixa de preço, que é uma pista fraca de qual
   procedimento foi feito. Mitigação: enviar o valor **arredondado para a
   centena** no `Purchase`. A Meta otimiza igual e a granularidade some.
4. Identificador sempre com SHA-256, normalizado antes (telefone em E.164 sem
   `+`, minúsculas, sem espaço) — é o que a Meta exige e é o que impede mandar
   telefone em claro.
5. A tela de configuração precisa deixar ligar e **desligar** o envio inteiro,
   com o efeito valendo na hora.

---

## Arquitetura

Três pedaços, e um deles não é meu:

```
  anúncio CTWA
       │
       ▼
  WhatsApp ──► Evolution ──► n8n  ◄── PEDAÇO 1 (fora deste repo)
                              │        grava a atribuição
                              ▼
                      Supabase: lead_attribution
                              │
                              ▼
       app ──► funil avança ──► fila de eventos ──► worker ──► Meta CAPI
                                                                (PEDAÇO 2)
                              │
                              ▼
              página /marketing lê Marketing API + cruza com o funil
                                                                (PEDAÇO 3)
```

### Pedaço 1 — captura no n8n

O payload real do `messages.upsert` da Evolution traz tudo em
`data.contextInfo.externalAdReply`:

| Campo do webhook | Vira |
|---|---|
| `externalAdReply.ctwaClid` | `ctwa_clid` — a chave de atribuição |
| `externalAdReply.sourceId` | `ad_id` — o ID do anúncio |
| `externalAdReply.sourceApp` | `source_app` (`instagram` / `facebook`) |
| `externalAdReply.title` | `ad_title` |
| `externalAdReply.body` | `ad_body` |
| `externalAdReply.sourceUrl` | `source_url` |
| `externalAdReply.greetingMessageBody` | `greeting_message` |
| `data.key.remoteJid` | telefone → normalizar para E.164 |
| `data.pushName` | `push_name` |
| `data.messageTimestamp` | `primeiro_contato_em` (unix **segundos**) |

Regra: **só grava quando `externalAdReply.ctwaClid` existe.** Mensagem sem esse
bloco é conversa orgânica e não deve poluir a atribuição.

Cuidados que o fluxo do n8n precisa ter:
- `remoteJid` pode vir como LID (`addressingMode: "lid"`); use `remoteJidAlt`
  quando ele existir e for diferente.
- `messageTimestamp` é **segundos**, não milissegundos. Multiplicar por 1000 na
  hora errada joga o evento para 1970 e a Meta descarta.
- O `ctwa_clid` tem validade. Grave na primeira mensagem e **não sobrescreva**
  numa mensagem posterior da mesma pessoa, ou a atribuição migra de anúncio.

### Pedaço 2 — envio (neste repo)

Espelha o desenho da fila de lembretes, que já está pronto e testado:

- Tabela `meta_conversion_jobs`, com `chave_idempotencia` única, `status`,
  `tentativas`, `erro`, `enviado_em` — mesma mecânica de reserva atômica
  (`status = 'enviando'`) que impede envio duplicado com dois workers no ar.
- Regra pura em `src/domain/marketing/plan-conversions.ts`: recebe estágio
  anterior, estágio novo, consentimento e atribuição; devolve os eventos a
  enviar. Sem I/O, testável sem banco.
- Adaptador `src/integrations/meta/capi.ts` no padrão da Task 10: fábrica com
  `fetchImpl` injetado, `garantirServidor()`, erro classificado em transitório
  vs permanente, mensagem sanitizada (o token **não** pode vazar para a coluna
  `erro`, que aparece na tela).
- O worker existente ganha um segundo despachante. Não crie um segundo
  processo.

**Mapa de eventos** — estágio do funil para evento da Meta:

| Estágio | Evento | Valor | Observação |
|---|---|---|---|
| `lead` | `Lead` | — | primeiro contato vindo de anúncio |
| `contato` | `Contact` | — | |
| `agendado` | `Schedule` | — | **é por este que a Meta otimiza** |
| `compareceu` | `CompleteRegistration` | — | não há evento padrão melhor |
| `paciente` | `Purchase` | preço arredondado à centena, BRL | |
| `descartado` | nenhum | — | |

Detalhes do payload que **precisam ser conferidos contra a documentação vigente
da Meta no momento de implementar** — a API de mensagens muda com frequência e
eu não vou fingir certeza sobre o formato exato:
- `action_source: "business_messaging"` e o par de campos que identificam o
  canal WhatsApp;
- `user_data.ctwa_clid` como chave, mais `user_data.ph` com SHA-256 do telefone;
- `event_id` estável derivado de `(patient_id, evento)` para deduplicação;
- `event_time` em segundos.

Fonte da verdade: Events Manager da conta, aba de Teste de Eventos. **Nada é
dado como funcionando sem aparecer lá.**

### Pedaço 3 — página `/marketing`

Somente leitura. Chama a Marketing API com token de usuário do sistema (não é o
MCP — o MCP é ferramenta desta conversa, o app precisa de credencial própria).

O que a página mostra e que **nenhum painel da Meta consegue mostrar**: o
cruzamento entre o gasto dela e o funil daqui, por `ad_id`.

Tabela por anúncio:

| Coluna | Origem |
|---|---|
| Anúncio, campanha, criativo | Marketing API |
| Gasto, impressões, cliques, conversas iniciadas, custo por conversa | Marketing API |
| Leads, agendaram, compareceram, viraram paciente | nosso banco, por `ad_id` |
| Taxa lead → agendado, agendado → compareceu | derivado |
| Receita atribuída | nosso banco |
| **CAC real** = gasto ÷ pacientes | derivado |
| **ROI** = receita ÷ gasto | derivado |

Com o banco vazio, tudo isso é zero — e a tela precisa dizer isso com uma frase,
não com `NaN` nem gráfico fantasma.

Também na página: estado do dataset (EMQ, frescor, volume por evento), lido de
`ads_get_dataset_quality`/`ads_get_dataset_stats`, para dar de cara quando a
qualidade de correspondência cair.

---

## Sequência

| # | Entrega | Depende de |
|---|---|---|
| 1 | Migration `lead_attribution` + colunas de atribuição, com RLS | — |
| 2 | Spec do fluxo n8n (documento, o dono aplica lá) | 1 |
| 3 | Domínio puro: mapa de estágio→evento, regra de consentimento, hash | — |
| 4 | Adaptador CAPI + fila `meta_conversion_jobs` + despacho no worker | 1, 3, credenciais |
| 5 | Página `/marketing` com o cruzamento | 1, credenciais |
| 6 | Tela de configuração: liga/desliga, estado do dataset, teste de evento | 4 |

Os passos 1, 2 e 3 **não dependem de credencial** e podem começar já. Os passos
4 e 5 ficam montados e só acendem quando o dataset e o token existirem.

## O que o dono precisa providenciar

1. **Dataset**: Gerenciador de Eventos → Conectar fontes de dados → Web →
   criar, nomear "Clínica Izadora". Anotar o **ID do dataset**.
2. **Token de CAPI**: dentro do dataset, aba Configurações → Gerar token de
   acesso. É esse que o worker usa.
3. **Token de Marketing API**: Configurações do Business → Usuários do sistema →
   criar usuário do sistema → dar acesso à conta de anúncios → gerar token com
   `ads_read`. É esse que a página usa.
4. Passar os três valores **pelo painel do Coolify ou pelo arquivo `.env`**, não
   pelo chat.

Enquanto isso não existe, o sistema funciona inteiro e a parte de marketing fica
desligada, do mesmo jeito que a integração com o Google Agenda.

## Recomendações sobre as campanhas — fora do escopo do código

Não mexo em anúncio (a página é só leitura), mas registro o que os dados
mostram:

- A campanha de WhatsApp otimiza por `messaging_conversation_started`. Depois
  que o `Schedule` estiver chegando e acumulando volume, o objetivo deveria
  migrar para conversão por esse evento. Antes disso, não — a Meta precisa de
  histórico.
- 24 conversas no total é pouco para qualquer otimização. A Meta quer algo perto
  de 50 eventos por semana por conjunto para sair do aprendizado. Com R$ 7,50
  por conversa e uma fração delas virando agendamento, o orçamento atual não
  chega lá. Ou o orçamento sobe, ou a otimização continua sendo por conversa e a
  gente usa os eventos fundos só para relatório — que já é um ganho grande
  sozinho, porque hoje não existe CAC real nenhum.
- A campanha de tráfego para o Instagram não gera atribuição nenhuma: visita de
  perfil não deixa `ctwa_clid`. Ela não vai aparecer no cruzamento, e isso é
  esperado, não é bug.
