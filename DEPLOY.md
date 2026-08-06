# Deploy no Coolify

Sistema da Clínica Izadora: dois containers a partir deste repositório — `web`
(Next.js) e `worker` (laço de despacho de lembretes, a cada 5 minutos).

> **Ainda não validado num build real.** A máquina onde o projeto foi
> desenvolvido não tem runtime de container, então `docker build` nunca rodou
> contra estes arquivos. O YAML foi validado e o conteúdo confere com o que o
> código exige, mas o primeiro build na VPS é o primeiro teste de verdade.

---

## 1. Antes de tudo: a rede interna

A Evolution API roda na VPS **sem porta publicada** — é assim que ela não fica
exposta na internet. Para o app alcançá-la, os containers precisam entrar na
mesma rede Docker onde n8n e Evolution já estão.

Na VPS:

```bash
docker network ls
```

Anote o nome da rede do n8n. O padrão assumido é `n8n_default`; se for outro,
defina `REDE_INTERNA` no painel do Coolify com o nome correto.

Se essa rede não existir ou o nome estiver errado, o deploy sobe e **os
lembretes falham silenciosamente** com erro de conexão a cada ciclo — vale
conferir antes.

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
| `REDE_INTERNA` | passo 1 | opcional, default `n8n_default` |

### As duas `NEXT_PUBLIC_*` precisam ser Build Variables

Não é detalhe de configuração — é a diferença entre o app funcionar e não
funcionar. O Turbopack **inlina** essas duas no bundle durante o `next build`.
Se elas só existirem em runtime, a imagem sai com `undefined` compilado dentro e
o client do Supabase quebra no browser, com o login falhando sem mensagem útil.

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

As migrations `0001` a `0008` já estão aplicadas no projeto
`mcdzuspmhqzftmnocjlp`. Rode o comando acima sempre que uma nova entrar no
repositório, **antes** de dar deploy do código que depende dela.

Para conferir o que está aplicado:

```bash
cd app && pnpm supabase migration list
```

---

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

- **Credenciais de Evolution e Resend ainda não foram configuradas.** Sem elas o
  app sobe e funciona (cadastro, agenda, prontuário), mas nenhum lembrete sai —
  o worker vai acumular falha classificada como `credencial`, que é permanente e
  não retenta.
- **Nenhuma imagem foi buildada ainda** (ver aviso no topo).
- **Jobs presos em `enviando`** não voltam sozinhos para a fila. É deliberado:
  não dá para distinguir "morreu antes de enviar" de "enviou e morreu antes de
  gravar", e devolver o segundo caso reenviaria a mensagem. O worker conta as
  reservas presas no boot e avisa no log; a decisão é humana.
- **`pnpm test:db` roda contra o Supabase de produção** e grava uma linha em
  `audit_log`, que é append-only e não pode ser limpa. Cada execução polui a
  auditoria. Para resolver de verdade, os testes de banco precisam de um
  Postgres descartável.
