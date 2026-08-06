# Sistema da Clínica Izadora

Sistema interno da clínica da Dra. Izadora Barros (CRO SP 173735): funil de
leads, agenda de consultas, fila de retornos e lembretes automáticos por
WhatsApp e e-mail.

Não é multiempresa e não tem cadastro público. São duas pessoas e dois papéis —
`dra` e `secretaria` —, e a diferença entre eles é real: a secretária lê o
histórico clínico e opera a agenda, mas não escreve nada clínico e não edita
configuração. Quem garante isso é a Row Level Security do Postgres, não a
interface.

Interface e mensagens ao paciente em português do Brasil; toda regra de negócio
com data e hora roda em `America/Sao_Paulo`, explicitamente, nunca no fuso do
servidor.

## O que o sistema faz

- **Funil (`/crm`)** — kanban de sete estágios: lead, contato, agendado,
  compareceu, paciente, retorno, descartado.
- **Agenda (`/agenda`)** — semana de consultas, com detecção de conflito de
  horário e validação contra o horário de atendimento.
- **Paciente (`/pacientes/[id]`)** — cadastro, contato, consentimento por canal
  e registro de atendimento.
- **Retornos (`/retornos`)** — fila de quem precisa voltar, classificada em em
  dia, vencendo e vencido. O intervalo vem do procedimento e pode ser ajustado
  atendimento a atendimento, ou zerado quando não há retorno.
- **Lembretes automáticos** — cinco gatilhos: confirmação na véspera, aviso três
  horas antes, cuidados 24h depois do procedimento, pergunta sobre o resultado
  em sete dias e aviso de retorno uma semana antes do vencimento. Respeitam o
  opt-out por canal e a janela de silêncio das 21h às 08h.
- **Procedimentos (`/configuracoes/procedimentos`)** — catálogo com duração,
  preço e intervalo de retorno padrão.
- **Mensagens (`/configuracoes/mensagens`)** — o texto de cada lembrete, com
  prévia ao vivo. Exclusiva da Dra.
- **Google Agenda (`/configuracoes/google`)** — espelhamento opcional das
  consultas na agenda pessoal da Dra.

## Como rodar em desenvolvimento

Requisitos: Node 22+ e **pnpm** (nunca `npm install` — o lockfile é do pnpm).

```bash
cd app
pnpm install
```

As variáveis de ambiente ficam em `app/.env.local`, que não vai para o
repositório. `app/.env.example` lista os nomes; o que cada uma significa e onde
obter o valor está na tabela do [DEPLOY.md](DEPLOY.md#2-variáveis-de-ambiente) —
são as mesmas em desenvolvimento e em produção. Sem `SUPABASE_URL` e as chaves,
o app não sobe: `src/lib/env.ts` valida tudo com zod na inicialização e falha
nomeando a variável que faltou.

Não existe Supabase local neste projeto — o desenvolvimento aponta para o mesmo
Supabase de produção. Vale saber disso antes de mexer em dado de paciente.

```bash
pnpm dev      # http://localhost:3000
pnpm worker   # laço de lembretes, ciclo a cada 5 minutos
```

O `worker` é um processo separado e opcional em desenvolvimento: sem ele o
sistema funciona inteiro, os lembretes apenas ficam parados na fila.

Não há tela de cadastro. Para entrar, o primeiro usuário é criado à mão no
painel do Supabase — ver [DEPLOY.md, "Primeiro acesso"](DEPLOY.md#5-primeiro-acesso).

## Arquitetura

**Next.js 16 (App Router) na frente, Supabase atrás.** As páginas são Server
Components que leem o Postgres já autenticadas como o usuário da sessão, via
cookie; a escrita passa por Server Actions. Não existe camada de API própria
entre os dois, e é deliberado: cada consulta atravessa a RLS do banco, então uma
página que esquecesse de filtrar por permissão ainda assim não devolveria o que
o usuário não pode ver. `src/proxy.ts` (o middleware — neste Next ele se chama
assim) renova a sessão e manda quem não está logado para `/login`.

**A regra de negócio mora em `src/domain/`, sem I/O.** Retorno em três níveis,
conflito de horário, horário de atendimento, planejamento dos cinco lembretes,
janela de silêncio e renderização de template são funções puras: não importam
Supabase, React nem Next, e por isso são testadas sem banco e sem mock. Supabase,
Evolution API (WhatsApp), Resend (e-mail) e Google Calendar ficam atrás de
adaptadores finos em `src/integrations/`, que se recusam a existir no browser —
há teste provando que nenhum Client Component os alcança, nem indiretamente.
Nenhum segredo chega ao cliente: só variáveis `NEXT_PUBLIC_*`.

**Os lembretes são uma fila, não um cron por consulta.** Agendar uma consulta ou
registrar um atendimento grava linhas em `reminder_jobs` com uma chave de
idempotência; o worker acorda a cada cinco minutos, **reserva** as vencidas com
um `update` condicional — dois workers no ar durante um deploy não despacham a
mesma linha —, monta o texto a partir de `message_templates` e envia. O que cair
entre 21h e 08h é reagendado para as 09:00 do dia seguinte. Falha de rede volta
para a fila com nova tentativa; falha de credencial é permanente e não retenta.

## Testes

Duas suítes, separadas de propósito:

```bash
cd app
pnpm test        # offline: domínio, componentes, integrações e helpers
pnpm test:db     # integração real contra o Supabase
```

`pnpm test` roda em jsdom, não toca em rede e exclui `tests/db/`. É a suíte que
tem de estar verde antes de qualquer commit, junto com:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

`pnpm test:db` precisa de `app/.env.test` com URL e chaves, e **aponta hoje para
o Supabase de produção**. Cada execução cria usuários de teste (que os próprios
testes apagam no fim) e deixa linhas em `audit_log`, que é append-only. Rode com
filtro de arquivo quando puder — `pnpm test:db tests/db/templates.test.ts` — e
não o inclua em automação até haver um Postgres descartável.

## Estrutura de pastas

```
DEPLOY.md                  # produção: Coolify, variáveis, migrations, healthcheck
docker/                    # Dockerfile.web e Dockerfile.worker
docker-compose.yml         # os dois serviços, na rede interna do n8n/Evolution
docs/                      # spec e plano de implementação
app/
  src/
    app/                   # rotas: (auth)/login e (app)/{crm,agenda,retornos,…}
    domain/                # regra de negócio pura, sem I/O
    integrations/          # Evolution, Resend, Google Calendar — só servidor
    lib/                   # env, datetime, telefone, clients do Supabase
    auth/                  # sessão e guarda de papel
    components/            # app-shell, tema
    proxy.ts               # middleware: sessão e rotas protegidas
  worker/                  # laço de 5 minutos, despacho e fila de lembretes
  supabase/migrations/     # schema versionado, 0001 a 0008
  tests/
    domain/ … lib/ …       # offline (pnpm test)
    db/                    # integração contra o Supabase (pnpm test:db)
```

Cada página costuma ter três arquivos ao lado: `page.tsx` (Server Component),
`acoes.ts` (Server Actions) e um módulo puro com as regras da tela — `estagios.ts`
no funil, `grade.ts` na agenda, `fila.ts` nos retornos, `mensagens.ts` no editor
de mensagens. A separação é obrigatória, não estilística: um arquivo `'use
server'` só pode exportar função async, então constantes e helpers puros
precisam de um módulo próprio — e ganham teste unitário de graça.

## Produção

Deploy no Coolify, migrations, variáveis de ambiente e verificação pós-deploy
estão em **[DEPLOY.md](DEPLOY.md)**.
