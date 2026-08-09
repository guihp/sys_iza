# Deploy no Coolify

Sistema da Clínica Izadora: dois containers a partir deste repositório — `web`
(Next.js) e `worker` (laço de despacho de lembretes, a cada 5 minutos).

> **Ainda não validado num build real.** A máquina onde o projeto foi
> desenvolvido não tem runtime de container, então `docker build` nunca rodou
> contra estes arquivos. O YAML foi validado e o conteúdo confere com o que o
> código exige, mas o primeiro build na VPS é o primeiro teste de verdade.

---

## 1. Rede interna

O compose cria a rede `clinica-iza` automaticamente no deploy (não exige rede
externa pré-existente). O default antigo (`n8n_default` + `external: true`)
quebrava o Coolify se essa rede não existisse no host.

A Evolution API costuma rodar **sem porta publicada**. Para o app alcançá-la,
Evolution (e n8n, se precisar) precisa estar na **mesma** rede Docker:

1. Anexe Evolution/n8n à rede `clinica-iza`, **ou**
2. Na VPS, crie/conecte a rede compartilhada e ligue os containers nela:

```bash
docker network ls
docker network connect clinica-iza <container_evolution>
```

`EVOLUTION_URL` deve usar o hostname Docker interno (ex.: `http://evolution:8080`),
não um domínio público.

Não use variável de rede externa no Coolify a menos que a rede **já exista** no
host — o compose não declara mais `external: true`.

---

## 2. Variáveis de ambiente

No Coolify: aba **Environment Variables** do recurso. Todas são obrigatórias,
exceto onde indicado.

| Variável | Onde encontrar | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Marque **Build Variable** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API (`anon`) | Marque **Build Variable** |
| `SUPABASE_URL` | mesma URL acima | |
| `SUPABASE_ANON_KEY` | mesma chave `anon` acima | |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (`service_role`) | **Segredo.** Bypassa RLS |
| `EVOLUTION_URL` | endereço interno da Evolution | ex.: `http://evolution:8080` |
| `EVOLUTION_API_KEY` | painel da Evolution | **Segredo** |
| `EVOLUTION_INSTANCE` | nome da instância conectada ao WhatsApp | |
| `RESEND_API_KEY` | resend.com → API Keys | **Segredo** |
| `EMAIL_FROM` | remetente verificado no Resend | precisa ser e-mail válido |
| `APP_TZ` | — | opcional, default `America/Sao_Paulo` |

### Meta Ads — opcional, desligado por padrão

Sem `META_DATASET_ID` **e** `META_CAPI_TOKEN`, a integração fica desligada: o
worker não consulta a fila, loga uma linha no boot e nada mais. O sistema
funciona inteiro.

| Variável | Onde encontrar | Sem ela |
|---|---|---|
| `META_DATASET_ID` | Gerenciador de Eventos → seu dataset | desligada |
| `META_CAPI_TOKEN` | dentro do dataset → Configurações → Gerar token | desligada |
| `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | Config. do Business → contas do WhatsApp | envia sem o identificador do canal |
| `META_GRAPH_API_VERSION` | — | usa `v25.0` |
| `META_TEST_EVENT_CODE` | Gerenciador de Eventos → Teste de Eventos | evento conta como produção |
| `META_ADS_TOKEN` | Business → Usuários do sistema → token `ads_read` | `/marketing` fica desligada |
| `META_AD_ACCOUNT_ID` | conta de anúncios (sem `act_`) | usa a conta padrão do código |

`META_TEST_EVENT_CODE` só deve ser preenchida **durante a conferência**. Com ela
preenchida os eventos vão para a aba de teste e não contam para otimização;
esquecê-la ligada é o jeito silencioso de a Meta nunca aprender nada.

Três campos do payload são suposição e precisam ser validados no Teste de
Eventos na primeira conexão — estão comentados um a um em
`src/integrations/meta/payload.ts`. A documentação da Meta para CAPI de
mensagens respondeu 404 quando foi consultada.

Para a página `/marketing` é preciso um token de Marketing API com `ads_read`
(`META_ADS_TOKEN`), gerado por usuário do sistema. Sem ele a rota sobe e
explica o que falta — não quebra o resto do sistema.

### Google Agenda — opcional, desligado por padrão

A sincronia de consultas com o Google Agenda só liga se as **três** variáveis
abaixo estiverem preenchidas. Faltando qualquer uma — ou com qualquer uma vazia
— ela fica desligada e o sistema funciona normalmente, sem erro em tela e sem
log a cada agendamento.

| Variável | Onde encontrar |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | JSON da conta de serviço, campo `client_email` |
| `GOOGLE_PRIVATE_KEY` | JSON da conta de serviço, campo `private_key` (PEM; aceita `\n` escrito) |
| `GOOGLE_CALENDAR_ID` | ID da agenda no Google Agenda |

Não existe default para `GOOGLE_CALENDAR_ID` de propósito: `primary` numa conta
de serviço é a agenda dela mesma, e os eventos sumiriam em silêncio.

Passo a passo do lado do Google (também está na tela `/configuracoes/google`):

1. Criar projeto no Google Cloud e habilitar a **Google Calendar API**.
2. Criar uma **conta de serviço** → Chaves → gerar chave JSON.
3. No Google Agenda, **compartilhar a agenda** com o `client_email` da conta de
   serviço, com permissão "Fazer alterações em eventos". Sem esse passo o Google
   recusa a escrita, mesmo com as credenciais certas.
4. Preencher as três variáveis no Coolify e redeployar.

### Web Push (PWA) — opcional, desligado por padrão

Avisos à **equipe** (dra + secretaria) quando alguém marca uma consulta. Pacientes
não recebem este canal. Sem as chaves VAPID o sistema sobe normal; só o push
fica desligado.

| Variável | Onde encontrar | Observação |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | par gerado localmente | Marque **Build Variable** (Turbopack inlina) |
| `VAPID_PRIVATE_KEY` | par gerado localmente | **Segredo.** Nunca no repositório |
| `VAPID_SUBJECT` | `mailto:` do dono ou URL do app | opcional; há fallback local |

Gerar o par (uma vez) na máquina de desenvolvimento:

```bash
cd app && pnpm exec web-push generate-vapid-keys
```

Cole a pública em `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e a privada em
`VAPID_PRIVATE_KEY` no Coolify (e no `.env.local` em dev). **Não commit** a
privada. Depois do deploy: Configurações → Notificações → ligar neste aparelho.

Limites honestos: iOS só com PWA na Tela de Início e iOS 16.4+; Safari desktop
é limitado; precisa HTTPS (ou `localhost` em dev).

Som da notificação: o SW pede `silent: false` e um WAV em `/sounds/notificacao.wav`.
Na prática o aparelho usa o **tom do sistema** — Chrome Android e iOS quase
nunca tocam o arquivo customizado. Não dá para forçar um bip próprio em todas
as plataformas.

### API HTTP (n8n / automação) — opcional

Rotas sob `/api/*` (pacientes, procedimentos, leads, agenda). Documentação,
playground e geração de chave: **Configurações → API** (só a Dra. gera/rotaciona).

Autenticação (qualquer um basta):

1. Cookie de sessão da equipe (usuário logado), **ou**
2. Chave gerada no painel (hash em `clinic_settings`; plaintext mostrado **uma vez**), **ou**
3. Variável de ambiente no Coolify (`API_KEY` / alias `AGENDA_API_KEY`)

**Preferência:** gerar no painel. O env continua válido (Coolify já configurado
não quebra). Cabeçalhos: `Authorization: Bearer …` ou `x-api-key`.

| Variável | Onde encontrar | Observação |
|---|---|---|
| `API_KEY` | painel **ou** `openssl rand -hex 32` | **Segredo.** Fallback Coolify; opcional se a chave do painel existir |
| `AGENDA_API_KEY` | mesmo valor / legado | Aceita se `API_KEY` estiver vazia |

Migration `0020_api_key_clinic_settings` precisa estar aplicada no Supabase antes
do redeploy que usa geração no painel.

Exemplo:

```bash
curl -sS -X POST "$APP_URL/api/agenda/agendar" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pacienteId":"<uuid>","procedimentoId":"<uuid>","inicio":"2026-08-20T17:00:00.000Z"}'
```

`inicio` é ISO 8601 com `Z` (instante absoluto). Sem sessão e sem chave válida
→ **401**.

### `NEXT_PUBLIC_*` precisam ser Build Variables

Não é detalhe de configuração — é a diferença entre o app funcionar e não
funcionar. O Turbopack **inlina** `NEXT_PUBLIC_*` no bundle durante o `next build`.
Se `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` só existirem em
runtime, a imagem sai com `undefined` compilado dentro e o client do Supabase
quebra no browser, com o login falhando sem mensagem útil. O mesmo vale para
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` se você ligar o push: marque como Build Variable.

O `Dockerfile.web` recusa o build se elas não chegarem como `ARG`, justamente
para o erro aparecer no build e não em produção.

---

## 3. Criar o recurso no Coolify

1. **New Resource → Docker Compose** (não "Dockerfile" — são dois serviços).
2. Repositório: `https://github.com/guihp/sys_iza`, branch `main`.
3. Caminho do compose: `docker-compose.yml` (raiz).
4. Preencha as variáveis do passo 2.
5. Em **Domains**, aponte o domínio para o serviço `web`, porta `3000`.
   O compose usa `expose` e não `ports` de propósito: quem publica para a
   internet é o proxy do Coolify, com TLS. Publicar porta de host abriria o app
   por fora do certificado.
6. Deploy.

O `worker` não tem domínio nem porta — é processo de fundo. No painel ele
aparece sem URL, e é isso mesmo.

---

## 4. Migrations

**O Coolify não aplica migrations.** O schema é versionado em
`app/supabase/migrations/` e vai para o Supabase pela sua máquina:

```bash
cd app && pnpm supabase db push
```

As migrations `0001` a `0010` já estão aplicadas no projeto
`mcdzuspmhqzftmnocjlp`. O conteúdo de `0011_prontuario_clinico` também já está
no banco (aplicado sob a versão `20260808154348`). Se `migration list` mostrar
a `0011` local como pendente, alinhe o histórico com:

```bash
cd app && pnpm supabase migration repair --status applied 0011
```

Rode `db push` sempre que uma migration **nova** entrar no repositório,
**antes** de dar deploy do código que depende dela.

Para conferir o que está aplicado:

```bash
cd app && pnpm supabase migration list
```

---

## 4.1. Parear o WhatsApp da clínica

A instância da Evolution (`EVOLUTION_INSTANCE`) precisa estar **conectada a um
telefone** antes de qualquer lembrete sair. Ter a URL e a chave certas não
basta: uma instância criada mas nunca pareada fica em `state: close`, e todo
envio falha.

Quem pareia é a Dra., pelo painel da Evolution: abrir a instância, gerar o QR e
ler com **WhatsApp → Dispositivos conectados → Conectar dispositivo**. O QR
expira em cerca de 40 segundos; se vencer, é só gerar outro.

Para conferir o estado a qualquer momento, sem pareamento:

```bash
curl -s -H "apikey: $EVOLUTION_API_KEY" \
  "$EVOLUTION_URL/instance/connectionState/$EVOLUTION_INSTANCE"
```

`"state":"open"` é conectado. `close` ou `connecting` significam que o WhatsApp
ainda não está pareado — e nesse estado o worker vai acumular falha a cada
ciclo.

## 5. Primeiro acesso

Não existe cadastro público — é sistema fechado, com dois papéis (`dra` e
`secretaria`). O primeiro usuário é criado à mão:

1. Supabase → Authentication → Users → **Add user**, com e-mail e senha.
2. Supabase → Table Editor → `profiles` → inserir a linha correspondente,
   com o mesmo `id` do usuário criado e `role = 'dra'`.

Sem a linha em `profiles` o login autentica mas o app não sabe o papel, e as
telas restritas ficam inacessíveis.

---

## 6. Conferir se subiu de verdade

**Web** — abra o domínio. A raiz redireciona para `/crm`; sem sessão, o proxy
manda para `/login`. Chegar na tela de login já prova que o Next subiu, que o
proxy do Coolify alcançou o container e que o `HOSTNAME=0.0.0.0` pegou.

**Healthcheck** — no painel, o serviço `web` fica `healthy` depois de ~40s
(`start_period`). Se ficar `unhealthy`, o problema é o app, não o proxy.

**Worker** — nos logs do serviço `worker`, a primeira linha deve ser:

```
[lembretes] worker iniciado — ciclo a cada 5 minutos
```

Se aparecer `Variáveis de ambiente inválidas — …`, falta variável: a mensagem
nomeia qual.

**Deploy sem mensagem duplicada** — todo deploy sobe o container novo antes de
derrubar o velho, então por alguns segundos há dois workers na mesma fila. A
reserva atômica (`status = 'enviando'`, migration 0008) é o que impede a
paciente de receber o mesmo lembrete duas vezes. O `stop_grace_period: 30s` dá
tempo do worker antigo terminar o ciclo em curso antes do SIGKILL.

---

## 7. Pendências conhecidas

- **WhatsApp ainda não pareado.** As credenciais da Evolution foram conferidas e
  respondem, mas a instância nunca foi conectada a um telefone (`state: close`).
  Ver a seção 4.1 — é a Dra. quem faz, pelo painel da Evolution. Até lá o app
  funciona inteiro (cadastro, agenda, prontuário) e só os lembretes não saem.
- **`EMAIL_FROM` está provisório.** A chave do Resend é *send-only*, então não dá
  para descobrir o domínio verificado pela API. O valor em uso é
  `onboarding@resend.dev`, o sandbox do Resend: ele entrega **apenas para o
  e-mail dono da conta**, nunca para uma paciente. Trocar pelo endereço real da
  clínica assim que o domínio estiver verificado no Resend (é um registro DNS).
- **Nenhum envio real foi testado de ponta a ponta** — depende dos dois itens
  acima.
- **Nenhuma imagem foi buildada ainda** (ver aviso no topo).
- **Jobs presos em `enviando`** não voltam sozinhos para a fila. É deliberado:
  não dá para distinguir "morreu antes de enviar" de "enviou e morreu antes de
  gravar", e devolver o segundo caso reenviaria a mensagem. O worker conta as
  reservas presas no boot e avisa no log; a decisão é humana.
- **`pnpm test:db` roda contra o Supabase de produção** e grava uma linha em
  `audit_log`, que é append-only e não pode ser limpa. Cada execução polui a
  auditoria. Para resolver de verdade, os testes de banco precisam de um
  Postgres descartável.
