# Estado do projeto — leia isto primeiro

Documento de passagem de bastão. Se você é uma IA (ou uma pessoa) chegando agora
neste repositório, comece por aqui: o que o sistema é, o que já funciona, o que
está pela metade, o que está travado e por quê.

Última atualização: **2026-08-06**.

---

## 1. O que é

Sistema interno da clínica de estética da Dra. Izadora Barros. Dois usuários:
a **dra** e a **secretaria**. Não tem cadastro público — é ferramenta de
trabalho, não produto.

Faz: funil de leads em kanban, agenda de consultas, prontuário, fila de retornos
e disparo automático de lembretes por WhatsApp e e-mail. Está sendo acrescentada
a atribuição de anúncios da Meta.

## 2. Onde as coisas estão

| | |
|---|---|
| Repositório | `https://github.com/guihp/sys_iza`, branch `main`, **público** (o dono vai fechar depois) |
| App | `app/` — Next.js **16.3.0**, React 19, Tailwind v4, pnpm |
| Worker | `app/worker/` — laço de 5 min, processo separado |
| Banco | Supabase, project ref `mcdzuspmhqzftmnocjlp` |
| Migrations | `app/supabase/migrations/`, **0001 a 0010 aplicadas** |
| Deploy | Coolify, ver `DEPLOY.md` |

Documentos:

- `README.md` — entrada do projeto, como rodar em dev
- `DEPLOY.md` — deploy no Coolify, variáveis, primeiro usuário
- `docs/superpowers/specs/2026-08-05-clinica-izadora-design.md` — spec funcional original
- `docs/superpowers/plans/2026-08-05-fase-0-1-*.md` — plano das 13 tasks já executadas
- `docs/superpowers/specs/2026-08-06-redesign-ui.md` — spec visual do redesign
- `docs/superpowers/plans/2026-08-06-atribuicao-meta-ads.md` — plano da atribuição da Meta
- `docs/superpowers/specs/2026-08-06-n8n-captura-ctwa.md` — o que o n8n precisa fazer

## 3. O que já funciona

Fundação, CRM, agenda, prontuário e lembretes estão implementados e testados:
login por papel com RLS, audit log append-only, catálogo de procedimentos, funil
de 7 estágios, agenda semanal com conflito barrado no banco, retorno em 3 níveis
de precedência, 5 gatilhos de lembrete com janela de silêncio, adaptadores da
Evolution e do Resend, worker com reserva atômica, Google Agenda opcional,
editor de mensagens.

**542 testes offline + 111 de banco**, todos passando.

```bash
cd app
pnpm test          # offline (jsdom), não precisa de banco
pnpm test:db       # integração contra o Supabase REAL — ver aviso na seção 6
pnpm dev           # dev server
pnpm worker        # worker local
```

## 4. O que está em andamento

**Redesign da interface** — spec em `docs/superpowers/specs/2026-08-06-redesign-ui.md`,
extraído de mockups que **não estão no repositório**. Parte já foi feita
(tokens dourados, primitivas em `src/components/ui/`, sidebar fixa, busca
global, KPIs, categoria de procedimento). Falta: dashboard como destino do
login, e o cadastro de paciente direto pela agenda.

**Atribuição da Meta** — plano em `docs/superpowers/plans/2026-08-06-atribuicao-meta-ads.md`.
Passos 1 a 5 **prontos**:

1. Schema `lead_attribution` + `meta_conversion_jobs` (migration `0010`).
2. Spec do n8n, com os nós prontos para colar em
   `docs/superpowers/specs/n8n-captura-ctwa-nodes.json`.
3. Domínio puro em `src/domain/marketing/` — mapa estágio→evento, guarda de
   consentimento, hash, arredondamento de valor.
4. Adaptador da CAPI em `src/integrations/meta/`, despacho no worker, e o
   enfileiramento ligado aos quatro pontos onde o funil muda (`crm/acoes.ts`,
   `agenda/acoes.ts`, `pacientes/[id]/acoes.ts`, `components/lead/acoes.ts`).
5. Página `/marketing`, somente leitura, cruzando gasto da Marketing API com o
   funil daqui por `ad_id` — CAC real e ROI por anúncio.

**As credenciais da Meta já existem e foram verificadas** (2026-08-06): dataset
`1735170690969038`, `META_CAPI_TOKEN` e `META_ADS_TOKEN` no `.env.local`. O token
de anúncios lê as campanhas; o de CAPI aceita POST em `/events`.

Falta: passo 6 (tela de configuração da Meta — liga/desliga e estado do dataset)
e o n8n do lado do dono.

## 5. O que está travado, e por quem

| Trava | Quem destrava | Consequência de não ter |
|---|---|---|
| WhatsApp não pareado (instância `izadoraClinica`, `state: close`) | a Dra., pelo painel da Evolution | nenhum lembrete sai |
| `EMAIL_FROM` está no sandbox do Resend (`onboarding@resend.dev`) | dono verificar domínio no Resend | e-mail só chega para o dono da conta, nunca para paciente |
| `ctwa_clid` ainda não é capturado em produção | dono, colando os nós no n8n | não há como ligar paciente a anúncio |
| Deploy no Coolify | dono | o sistema só roda local |
| Repositório está público | dono | schema e lógica de acesso visíveis |
| Chaves que passaram pelo chat não foram rotacionadas | dono | Evolution e Resend expostos no histórico |
| Credenciais do Google OAuth | dono, no Google Cloud | sincronia de agenda fica desligada (opcional) |

**Destravado em 2026-08-06:** dataset da Meta, token de CAPI e token de
Marketing API já existem, estão no `.env.local` e foram verificados contra a
Graph API.

Regra que atravessa o sistema: **integração sem credencial fica desligada, não
quebrada.** O app sobe e funciona inteiro; só a parte dependente não acende.

## 6. Armadilhas — leia antes de mexer

Cada uma destas já custou tempo ou quase entrou em produção errada.

**Next 16, não 15.** O middleware é `app/src/proxy.ts` exportando uma função
`proxy`. `middleware.ts` está deprecado e ter os dois é **erro de build**. O
plano das 13 tasks diz "Next 15" e está desatualizado.

**Arquivo `'use server'` só exporta função async.** `export const ALGUMA_COISA`
dentro dele quebra o build com `Only async functions are allowed to be exported`.
Constante, tipo e helper puro vão em módulo separado — veja
`crm/estagios.ts`, `agenda/grade.ts`, `retornos/fila.ts`.

**`NEXT_PUBLIC_*` é inlinada em build time** pelo Turbopack. No Docker elas
precisam chegar como `ARG`, não só como env de runtime, senão a imagem sobe com
`undefined` compilado dentro. Já tratado em `docker/Dockerfile.web`.

**`pnpm test:db` roda contra o banco de PRODUÇÃO.** Não existe banco descartável
(a máquina de desenvolvimento não tem runtime de container). Cada execução grava
uma linha em `audit_log`, que é append-only e **não pode ser limpa**. Rode com
filtro de arquivo, não a suíte inteira, salvo quando for necessário.

**Fuso sempre por `src/lib/datetime.ts`.** Ele resolve `America/Sao_Paulo` via
`Intl`/tzdata. Nunca assuma `-03` fixo: o Brasil não tem horário de verão desde
2019, mas o tzdata guarda o histórico e há testes que dependem disso.

**Telefone sempre por `src/lib/phone.ts`.** A normalização tem um detalhe não
óbvio: só tira o `55` inicial quando sobram 12+ dígitos, senão o DDD 55
(Santa Maria/RS) seria comido como código de país.

**Migrations não são aplicadas por quem escreve o código.** Quem escreve cria o
arquivo e avisa; quem aplica é o dono, com `pnpm supabase db push`.

**`Intl.NumberFormat('pt-BR')` usa espaço não separável (U+00A0)** depois do
`R$`. Comparação de string com espaço comum falha com as duas parecendo iguais.

## 7. Decisões tomadas — não reabra sem motivo novo

- **Banco fica vazio.** Nada de dados de demonstração. Toda tela precisa de
  estado vazio decente; KPI mostra `0` ou `—`, nunca `NaN`.
- **Evento que a Meta persegue: `agendado`.** Os mais fundos são enviados também,
  mas só para relatório — o volume atual (24 conversas no total) não sustenta
  otimização por eles.
- **A página de marketing é somente leitura.** Mexer em anúncio continua no
  Gerenciador.
- **Google Agenda ficou com conta de serviço**, e a troca para OAuth foi adiada.
- **Primeiro clique vence** na atribuição: o `ctwa_clid` nunca é sobrescrito por
  uma mensagem posterior. Há trigger no banco garantindo isso.
- **Next 16 fica**, apesar de o plano dizer 15.

## 8. LGPD — restrição dura na parte de marketing

Dado de saúde é dado sensível. O que o código precisa cumprir, e já cumpre no
domínio (`src/domain/marketing/`):

1. Evento só sai de quem tem `consentimento_lgpd_em` preenchido.
2. Nunca enviar nome de procedimento, observação clínica ou qualquer campo de
   prontuário. O tipo de entrada **não tem campo** para isso — é estrutural, não
   uma regra a lembrar.
3. Valor do `Purchase` vai arredondado para a centena: o valor exato revela faixa
   de preço e portanto o procedimento.
4. Identificador sempre com SHA-256. O `uuid` interno da paciente nunca sai em
   claro.

## 9. Se você for continuar o trabalho

1. Leia o plano ou spec da frente em que vai mexer (seção 2).
2. TDD: teste que falha, implementação, teste passando, commit.
3. Rode `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint` e `pnpm build` antes
   de commitar. Há **1 warning pré-existente** em `tests/lib/env.test.ts:23` que
   não é seu.
4. Commit em português, Conventional Commits.
5. Regra de decomposição: `src/domain/` não importa Supabase, React nem Next. É
   o que mantém a regra de negócio testável sem banco.
