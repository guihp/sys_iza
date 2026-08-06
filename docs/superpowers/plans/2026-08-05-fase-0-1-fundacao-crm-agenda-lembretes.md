# Fase 0+1 — Fundação, CRM, Agenda e Lembretes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o sistema da Clínica Izadora rodando com login seguro, funil de leads em kanban, agenda de consultas e disparo automático de lembretes por WhatsApp e e-mail.

**Architecture:** Next.js 15 (App Router) servindo UI e API, Supabase como Postgres + Auth + Storage com Row Level Security, e um processo `worker` separado que roda a cada 5 minutos para despachar lembretes. Toda a lógica de negócio (retorno, conflito de agenda, planejamento de lembrete, janela de silêncio) vive em funções puras sob `src/domain/`, sem I/O, cobertas por teste unitário; Supabase, Evolution API e Resend ficam atrás de adaptadores finos em `src/integrations/`.

**Tech Stack:** TypeScript, Next.js 15, React 19, Tailwind CSS v4, shadcn/ui, Supabase (CLI local para dev e testes), Vitest, Testing Library, Playwright (apenas para o PDF em fase futura), pnpm, Docker Compose.

## Global Constraints

- Idioma de toda a interface e de todo o conteúdo enviado ao paciente: **português do Brasil**.
- Timezone de toda regra de negócio: **America/Sao_Paulo**. Nunca usar o timezone do servidor implicitamente.
- Papéis do sistema: exatamente `dra` e `secretaria`. Nenhum outro.
- A secretária tem `SELECT` no prontuário e **nenhuma** policy de `INSERT`/`UPDATE`/`DELETE` sobre dados clínicos.
- Nenhum segredo (`SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_API_KEY`, `RESEND_API_KEY`) pode ser lido em código que roda no browser. Apenas variáveis com prefixo `NEXT_PUBLIC_` chegam ao cliente.
- Estágios do funil, nesta ordem: `lead`, `contato`, `agendado`, `compareceu`, `paciente`, `retorno`, `descartado`.
- Janela de silêncio para envio: nada entre **21:00 e 08:00**; o que cair nesse intervalo é reagendado para **09:00** do próximo dia útil de calendário (dia seguinte, sem regra de feriado).
- Toda tabela de dados de paciente tem RLS **habilitada**. Tabela sem policy é tabela inacessível — nunca deixar RLS desligada como atalho.
- Gerenciador de pacotes: `pnpm`. Nunca `npm install` no projeto.
- Migrations SQL versionadas em `supabase/migrations/`, nunca alteração manual pelo painel.
- Commits em português, no formato Conventional Commits.

---

## Estrutura de arquivos

```
docker/
  compose.yml                        # web + worker
  Dockerfile.web
  Dockerfile.worker
supabase/
  config.toml
  migrations/
    0001_extensions_e_enums.sql
    0002_profiles_e_audit.sql
    0003_procedimentos.sql
    0004_pacientes.sql
    0005_agendamentos.sql
    0006_atendimentos.sql
    0007_lembretes.sql
    0008_rls_policies.sql
src/
  lib/
    env.ts                           # validação de env com zod, servidor e cliente
    datetime.ts                      # helpers de timezone America/Sao_Paulo
    phone.ts                         # normalização E.164 BR
    supabase/
      server.ts                      # client autenticado por cookie (SSR)
      browser.ts                     # client do browser (anon key)
      admin.ts                       # client service_role — SOMENTE servidor/worker
  auth/
    session.ts                       # leitura de sessão e papel
    guard.ts                         # requireRole() para rotas
  domain/
    returns/
      compute-return.ts              # retorno em 3 níveis + status
    scheduling/
      conflict.ts                    # detecção de conflito de horário
      working-hours.ts               # validação contra horário de atendimento
    reminders/
      plan-reminders.ts              # gera os 5 gatilhos de uma consulta
      quiet-hours.ts                 # reagendamento pela janela de silêncio
      template.ts                    # renderização de variáveis
  integrations/
    evolution/client.ts              # envio de WhatsApp
    email/resend.ts                  # envio de e-mail
  components/
    ui/                              # shadcn/ui gerado
    app-shell.tsx                    # navegação lateral + header
    theme-toggle.tsx
  app/
    layout.tsx
    (auth)/login/page.tsx
    (app)/layout.tsx                 # protegido
    (app)/crm/page.tsx               # kanban
    (app)/agenda/page.tsx
    (app)/pacientes/[id]/page.tsx
    (app)/retornos/page.tsx
    (app)/configuracoes/procedimentos/page.tsx
    (app)/configuracoes/mensagens/page.tsx
    api/
      pacientes/route.ts
      agendamentos/route.ts
      atendimentos/route.ts
worker/
  index.ts                           # loop de 5 min
  dispatch.ts                        # busca lembretes vencidos e despacha
tests/
  domain/…                           # unitários das funções puras
  db/…                               # integração contra Supabase local
```

Regra de decomposição: `src/domain/` não importa nada de Supabase, React ou Next. Isso mantém a regra de negócio testável sem banco e sem mock pesado.

---

### Task 1: Scaffold do projeto, validação de env e Docker

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`
- Create: `src/lib/env.ts`
- Create: `docker/compose.yml`, `docker/Dockerfile.web`, `docker/Dockerfile.worker`
- Test: `tests/lib/env.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `serverEnv` (objeto com `SUPABASE_URL: string`, `SUPABASE_ANON_KEY: string`, `SUPABASE_SERVICE_ROLE_KEY: string`, `EVOLUTION_URL: string`, `EVOLUTION_API_KEY: string`, `EVOLUTION_INSTANCE: string`, `RESEND_API_KEY: string`, `EMAIL_FROM: string`, `APP_TZ: string`), `publicEnv` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`), e a função `parseServerEnv(raw: Record<string, string | undefined>)` que lança `Error` em campo faltante.

- [ ] **Step 1: Criar o projeto Next.js**

```bash
cd /Volumes/HD/CODE/ClinicaIzadora
pnpm dlx create-next-app@latest app --typescript --tailwind --app --eslint --src-dir --use-pnpm --no-import-alias
cd app
pnpm add zod @supabase/supabase-js @supabase/ssr date-fns date-fns-tz
pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Configurar o Vitest**

Criar `app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
```

Adicionar em `app/package.json`, dentro de `"scripts"`: `"test": "vitest run"` e `"test:watch": "vitest"`.

- [ ] **Step 3: Escrever o teste que falha**

Criar `app/tests/lib/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseServerEnv } from '@/lib/env'

const completo = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  EVOLUTION_URL: 'http://evolution:8080',
  EVOLUTION_API_KEY: 'key',
  EVOLUTION_INSTANCE: 'clinica',
  RESEND_API_KEY: 're_123',
  EMAIL_FROM: 'contato@clinicaizadora.com.br',
}

describe('parseServerEnv', () => {
  it('aceita um ambiente completo e assume America/Sao_Paulo por padrão', () => {
    const env = parseServerEnv(completo)
    expect(env.EVOLUTION_INSTANCE).toBe('clinica')
    expect(env.APP_TZ).toBe('America/Sao_Paulo')
  })

  it('lança erro nomeando a variável faltante', () => {
    const { EVOLUTION_API_KEY, ...incompleto } = completo
    expect(() => parseServerEnv(incompleto)).toThrow(/EVOLUTION_API_KEY/)
  })

  it('rejeita EMAIL_FROM que não seja e-mail', () => {
    expect(() => parseServerEnv({ ...completo, EMAIL_FROM: 'nao-e-email' })).toThrow(/EMAIL_FROM/)
  })
})
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `pnpm test tests/lib/env.test.ts`
Expected: FAIL — `Cannot find module '@/lib/env'`

- [ ] **Step 5: Implementar `src/lib/env.ts`**

```ts
import { z } from 'zod'

const serverSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  EVOLUTION_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().email(),
  APP_TZ: z.string().min(1).default('America/Sao_Paulo'),
})

export type ServerEnv = z.infer<typeof serverSchema>

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const resultado = serverSchema.safeParse(raw)
  if (!resultado.success) {
    const detalhes = resultado.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Variáveis de ambiente inválidas — ${detalhes}`)
  }
  return resultado.data
}

let cache: ServerEnv | null = null

/** Só pode ser chamado em código de servidor ou do worker. */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() foi chamado no browser — isso vazaria segredos')
  }
  cache ??= parseServerEnv(process.env)
  return cache
}

export const publicEnv = {
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `pnpm test tests/lib/env.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 7: Criar `.env.example`**

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# Evolution API (rede interna da VPS)
EVOLUTION_URL=http://evolution:8080
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=
# E-mail
RESEND_API_KEY=
EMAIL_FROM=
# Aplicação
APP_TZ=America/Sao_Paulo
```

Confirmar que `.env` e `.env*.local` já estão no `.gitignore` da raiz. **Nunca commitar o `.env` real.**

- [ ] **Step 8: Criar os Dockerfiles e o compose**

`docker/Dockerfile.web`:

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY app/ .
RUN pnpm build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

`docker/Dockerfile.worker`:

```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/ .
CMD ["pnpm", "worker"]
```

`docker/compose.yml`:

```yaml
services:
  web:
    build: { context: .., dockerfile: docker/Dockerfile.web }
    env_file: ../app/.env
    ports: ["3000:3000"]
    restart: unless-stopped
    networks: [interna]
  worker:
    build: { context: .., dockerfile: docker/Dockerfile.worker }
    env_file: ../app/.env
    restart: unless-stopped
    networks: [interna]

networks:
  interna:
    external: true
    name: n8n_default
```

A rede `interna` aponta para a rede onde n8n e Evolution já rodam — confirmar o nome real com `docker network ls` na VPS antes do primeiro deploy e ajustar `name:`.

Adicionar `output: 'standalone'` em `app/next.config.ts`.

- [ ] **Step 9: Commit**

```bash
git add app docker .gitignore
git commit -m "feat: scaffold Next.js, validação de env e imagens Docker"
```

---

### Task 2: Schema base — perfis, auditoria e enums

**Files:**
- Create: `app/supabase/config.toml` (gerado pela CLI)
- Create: `app/supabase/migrations/0001_extensions_e_enums.sql`
- Create: `app/supabase/migrations/0002_profiles_e_audit.sql`
- Create: `app/src/lib/supabase/server.ts`, `browser.ts`, `admin.ts`
- Test: `app/tests/db/profiles.test.ts`

**Interfaces:**
- Consumes: `serverEnv()` da Task 1
- Produces: enums `user_role` (`dra`|`secretaria`), `patient_stage` (7 valores da Global Constraints); tabelas `profiles(id uuid PK → auth.users, nome text, role user_role, ativo bool)` e `audit_log(id bigint PK, ator uuid, acao text, entidade text, registro_id text, ip inet, criado_em timestamptz)`; funções SQL `current_role_of()` e `is_dra()`; clients `createServerClient()`, `createBrowserClient()`, `createAdminClient()`.

- [ ] **Step 1: Iniciar o Supabase local**

```bash
cd app
pnpm add -D supabase
pnpm supabase init
pnpm supabase start
```

Guardar a `service_role key` e a `anon key` que a CLI imprime — vão para `app/.env.test`.

- [ ] **Step 2: Escrever a migration de enums**

`app/supabase/migrations/0001_extensions_e_enums.sql`:

```sql
create extension if not exists "pgcrypto";

create type user_role as enum ('dra', 'secretaria');

create type patient_stage as enum (
  'lead', 'contato', 'agendado', 'compareceu', 'paciente', 'retorno', 'descartado'
);

create type appointment_status as enum (
  'agendado', 'confirmado', 'compareceu', 'faltou', 'cancelado'
);

create type reminder_kind as enum (
  'confirmacao', 'vespera_curta', 'pos_procedimento', 'avaliacao', 'retorno'
);

create type reminder_channel as enum ('whatsapp', 'email');

create type reminder_status as enum ('pendente', 'enviado', 'falhou', 'cancelado');
```

- [ ] **Step 3: Escrever a migration de perfis e auditoria**

`app/supabase/migrations/0002_profiles_e_audit.sql`:

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  role user_role not null default 'secretaria',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table profiles enable row level security;

-- Definidas como security definer para não recursar na RLS de profiles.
create function current_role_of() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create function is_dra() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_role_of() = 'dra', false)
$$;

create policy "perfil proprio e da equipe visivel"
  on profiles for select using (auth.uid() is not null);

create policy "so a dra altera perfis"
  on profiles for all using (is_dra()) with check (is_dra());

create table audit_log (
  id bigint generated always as identity primary key,
  ator uuid references auth.users(id),
  acao text not null,
  entidade text not null,
  registro_id text,
  ip inet,
  criado_em timestamptz not null default now()
);

alter table audit_log enable row level security;

create policy "so a dra le a auditoria"
  on audit_log for select using (is_dra());

-- Append-only: ninguém recebe policy de update ou delete, nem a Dra.
create policy "qualquer usuario autenticado registra"
  on audit_log for insert with check (auth.uid() is not null);

create index audit_log_entidade_idx on audit_log (entidade, registro_id, criado_em desc);
```

- [ ] **Step 4: Aplicar as migrations**

Run: `pnpm supabase migration up`
Expected: as duas migrations aplicam sem erro.

- [ ] **Step 5: Escrever o teste de integração que falha**

Criar `app/tests/db/profiles.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.SUPABASE_ANON_KEY!

let admin: SupabaseClient
let comoSecretaria: SupabaseClient

async function criarUsuario(email: string, role: 'dra' | 'secretaria') {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'senha-de-teste-123', email_confirm: true,
  })
  if (error) throw error
  await admin.from('profiles').insert({ id: data.user!.id, nome: email, role })
  const sessao = createClient(URL, ANON)
  await sessao.auth.signInWithPassword({ email, password: 'senha-de-teste-123' })
  return sessao
}

beforeAll(async () => {
  admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
  comoSecretaria = await criarUsuario(`sec-${Date.now()}@teste.local`, 'secretaria')
})

describe('profiles e audit_log', () => {
  it('secretária enxerga a equipe', async () => {
    const { data, error } = await comoSecretaria.from('profiles').select('id, role')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
  })

  it('secretária não consegue se promover a dra', async () => {
    const { data: eu } = await comoSecretaria.auth.getUser()
    const { error } = await comoSecretaria
      .from('profiles').update({ role: 'dra' }).eq('id', eu.user!.id)
    expect(error).not.toBeNull()
  })

  it('audit_log não aceita update nem delete', async () => {
    await comoSecretaria.from('audit_log')
      .insert({ acao: 'leitura', entidade: 'teste', registro_id: '1' })
    const { error } = await comoSecretaria
      .from('audit_log').update({ acao: 'adulterado' }).eq('entidade', 'teste')
    expect(error).not.toBeNull()
  })
})
```

Adicionar em `app/package.json`: `"test:db": "dotenv -e .env.test -- vitest run tests/db"` e `pnpm add -D dotenv-cli`.

- [ ] **Step 6: Rodar e confirmar**

Run: `pnpm test:db`
Expected: PASS — 3 testes. Se o teste de promoção passar indevidamente, a policy `so a dra altera perfis` está errada; corrigir antes de seguir.

- [ ] **Step 7: Criar os clients do Supabase**

`app/src/lib/supabase/server.ts`:

```ts
import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { publicEnv } from '@/lib/env'

export async function createServerClient() {
  const store = await cookies()
  return createSSRClient(publicEnv.SUPABASE_URL, publicEnv.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          // Chamado de um Server Component — o middleware já renova a sessão.
        }
      },
    },
  })
}
```

`app/src/lib/supabase/browser.ts`:

```ts
import { createBrowserClient as createSPAClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'

export function createBrowserClient() {
  return createSPAClient(publicEnv.SUPABASE_URL, publicEnv.SUPABASE_ANON_KEY)
}
```

`app/src/lib/supabase/admin.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

/**
 * Ignora a RLS. Usar SOMENTE no worker e em rotas de servidor que já
 * validaram o papel do usuário. Nunca importar em Client Component.
 */
export function createAdminClient() {
  const env = serverEnv()
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}
```

- [ ] **Step 8: Commit**

```bash
git add app/supabase app/src/lib/supabase app/tests/db app/package.json
git commit -m "feat: schema de perfis e auditoria com RLS por papel"
```

---

### Task 3: Autenticação e proteção de rotas

**Files:**
- Create: `app/src/auth/session.ts`, `app/src/auth/guard.ts`
- Create: `app/src/middleware.ts`
- Create: `app/src/app/(auth)/login/page.tsx`
- Create: `app/src/app/(app)/layout.tsx`
- Test: `app/tests/auth/guard.test.ts`

**Interfaces:**
- Consumes: `createServerClient()` da Task 2
- Produces: tipo `Sessao = { userId: string; nome: string; role: 'dra' | 'secretaria' }`; `getSessao(): Promise<Sessao | null>`; `requireSessao(): Promise<Sessao>` (redireciona para `/login` se ausente); `exigirDra(sessao: Sessao | null): Sessao` (função pura, lança `ErroDePermissao` se `role !== 'dra'` ou se a sessão for nula); classe `ErroDePermissao extends Error`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/auth/guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ErroDePermissao, exigirDra } from '@/auth/guard'

const dra = { userId: 'u1', nome: 'Izadora', role: 'dra' as const }
const secretaria = { userId: 'u2', nome: 'Ana', role: 'secretaria' as const }

describe('exigirDra', () => {
  it('deixa a dra passar e devolve a sessão', () => {
    expect(exigirDra(dra)).toEqual(dra)
  })

  it('bloqueia a secretária', () => {
    expect(() => exigirDra(secretaria)).toThrow(ErroDePermissao)
  })

  it('bloqueia sessão ausente', () => {
    expect(() => exigirDra(null)).toThrow(ErroDePermissao)
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/auth/guard.test.ts`
Expected: FAIL — `Cannot find module '@/auth/guard'`

- [ ] **Step 3: Implementar `src/auth/guard.ts`**

```ts
import type { Sessao } from '@/auth/session'

export class ErroDePermissao extends Error {
  constructor(mensagem = 'Você não tem permissão para esta ação') {
    super(mensagem)
    this.name = 'ErroDePermissao'
  }
}

/** Função pura: recebe a sessão já resolvida, para poder ser testada sem I/O. */
export function exigirDra(sessao: Sessao | null): Sessao {
  if (!sessao) throw new ErroDePermissao('Sessão expirada')
  if (sessao.role !== 'dra') throw new ErroDePermissao()
  return sessao
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/auth/guard.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 5: Implementar `src/auth/session.ts`**

```ts
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

export type Sessao = { userId: string; nome: string; role: 'dra' | 'secretaria' }

export async function getSessao(): Promise<Sessao | null> {
  const supabase = await createServerClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null

  const { data: perfil } = await supabase
    .from('profiles').select('nome, role, ativo').eq('id', auth.user.id).single()

  if (!perfil || !perfil.ativo) return null
  return { userId: auth.user.id, nome: perfil.nome, role: perfil.role }
}

export async function requireSessao(): Promise<Sessao> {
  const sessao = await getSessao()
  if (!sessao) redirect('/login')
  return sessao
}
```

- [ ] **Step 6: Implementar o middleware de renovação de sessão**

`app/src/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let resposta = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (lista) => {
          lista.forEach(({ name, value }) => request.cookies.set(name, value))
          resposta = NextResponse.next({ request })
          lista.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data } = await supabase.auth.getUser()
  const ehRotaPublica = request.nextUrl.pathname.startsWith('/login')

  if (!data.user && !ehRotaPublica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return resposta
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
```

- [ ] **Step 7: Criar a página de login**

`app/src/app/(auth)/login/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/browser'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault()
    setCarregando(true)
    setErro(null)
    const supabase = createBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setCarregando(false)
    if (error) {
      // Mensagem genérica de propósito: não revelar se o e-mail existe.
      setErro('E-mail ou senha incorretos')
      return
    }
    router.replace('/crm')
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-fundo px-6">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="font-serif text-2xl text-texto">Dra. Izadora Barros</h1>
          <p className="text-sm text-texto/60">CRO SP 173735</p>
        </header>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">E-mail</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-linha bg-transparent px-3 py-2" />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Senha</span>
          <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
            className="w-full rounded-lg border border-linha bg-transparent px-3 py-2" />
        </label>

        {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}

        <button type="submit" disabled={carregando}
          className="w-full rounded-lg bg-acento py-2 text-white disabled:opacity-60">
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 8: Criar o layout protegido**

`app/src/app/(app)/layout.tsx`:

```tsx
import { requireSessao } from '@/auth/session'
import { AppShell } from '@/components/app-shell'

export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  const sessao = await requireSessao()
  return <AppShell sessao={sessao}>{children}</AppShell>
}
```

`AppShell` é criado na Task 4; até lá, deixar um componente provisório não é aceitável — execute a Task 4 antes de rodar a aplicação.

- [ ] **Step 9: Commit**

```bash
git add app/src/auth app/src/middleware.ts app/src/app app/tests/auth
git commit -m "feat: login por e-mail e senha com proteção de rotas por papel"
```

---

### Task 4: Design system claro/escuro e app shell

**Files:**
- Create: `app/src/app/globals.css` (substituir o gerado)
- Create: `app/src/components/theme-toggle.tsx`, `app/src/components/app-shell.tsx`
- Modify: `app/src/app/layout.tsx`
- Test: `app/tests/components/theme-toggle.test.tsx`

**Interfaces:**
- Consumes: `Sessao` da Task 3
- Produces: `<AppShell sessao={Sessao}>{children}</AppShell>`; `<ThemeToggle />`; tokens CSS `--cor-fundo`, `--cor-texto`, `--cor-acento`, `--cor-linha`, `--cor-superficie` e as classes Tailwind `bg-fundo`, `text-texto`, `bg-acento`, `border-linha`, `bg-superficie`.

- [ ] **Step 1: Definir os tokens em `globals.css`**

```css
@import "tailwindcss";

@theme {
  --font-serif: Georgia, 'Times New Roman', serif;
  --color-fundo: #FDFBF9;
  --color-texto: #2E2A28;
  --color-acento: #C09999;
  --color-linha: #E7DFDA;
  --color-superficie: #FFFFFF;
}

:root[data-tema="escuro"] {
  --color-fundo: #14110F;
  --color-texto: #EDE7E1;
  --color-acento: #C8A97E;
  --color-linha: #2C2622;
  --color-superficie: #1C1815;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-tema="claro"]) {
    --color-fundo: #14110F;
    --color-texto: #EDE7E1;
    --color-acento: #C8A97E;
    --color-linha: #2C2622;
    --color-superficie: #1C1815;
  }
}

body { background: var(--color-fundo); color: var(--color-texto); }
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `app/tests/components/theme-toggle.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from '@/components/theme-toggle'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-tema')
})

describe('ThemeToggle', () => {
  it('aplica o tema escuro no primeiro clique', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /tema/i }))
    expect(document.documentElement.dataset.tema).toBe('escuro')
  })

  it('volta ao claro no segundo clique e persiste a escolha', () => {
    render(<ThemeToggle />)
    const botao = screen.getByRole('button', { name: /tema/i })
    fireEvent.click(botao)
    fireEvent.click(botao)
    expect(document.documentElement.dataset.tema).toBe('claro')
    expect(localStorage.getItem('tema')).toBe('claro')
  })
})
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `pnpm test tests/components/theme-toggle.test.tsx`
Expected: FAIL — `Cannot find module '@/components/theme-toggle'`

- [ ] **Step 4: Implementar `ThemeToggle`**

```tsx
'use client'

import { useEffect, useState } from 'react'

type Tema = 'claro' | 'escuro'

export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>('claro')

  useEffect(() => {
    const salvo = localStorage.getItem('tema') as Tema | null
    if (salvo) {
      setTema(salvo)
      document.documentElement.dataset.tema = salvo
    }
  }, [])

  function alternar() {
    const proximo: Tema = tema === 'claro' ? 'escuro' : 'claro'
    setTema(proximo)
    document.documentElement.dataset.tema = proximo
    localStorage.setItem('tema', proximo)
  }

  return (
    <button type="button" onClick={alternar} aria-label="Alternar tema"
      className="rounded-lg border border-linha px-3 py-1.5 text-sm">
      {tema === 'claro' ? 'Escuro' : 'Claro'}
    </button>
  )
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm test tests/components/theme-toggle.test.tsx`
Expected: PASS — 2 testes

- [ ] **Step 6: Implementar o `AppShell`**

```tsx
import Link from 'next/link'
import type { Sessao } from '@/auth/session'
import { ThemeToggle } from '@/components/theme-toggle'

const NAVEGACAO = [
  { href: '/crm', rotulo: 'Funil' },
  { href: '/agenda', rotulo: 'Agenda' },
  { href: '/retornos', rotulo: 'Retornos' },
  { href: '/configuracoes/procedimentos', rotulo: 'Procedimentos' },
  { href: '/configuracoes/mensagens', rotulo: 'Mensagens' },
]

export function AppShell({ sessao, children }: { sessao: Sessao; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-fundo text-texto">
      <header className="flex items-center justify-between border-b border-linha px-6 py-4">
        <div>
          <p className="font-serif text-lg leading-tight">Dra. Izadora Barros</p>
          <p className="text-xs text-texto/50">CRO SP 173735</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-texto/70">
            {sessao.nome} · {sessao.role === 'dra' ? 'Doutora' : 'Secretaria'}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex">
        <nav className="w-52 shrink-0 border-r border-linha p-4">
          <ul className="space-y-1">
            {NAVEGACAO.map((item) => (
              <li key={item.href}>
                <Link href={item.href}
                  className="block rounded-lg px-3 py-2 text-sm hover:bg-superficie">
                  {item.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add app/src/app/globals.css app/src/components app/src/app/layout.tsx app/tests/components
git commit -m "feat: design system claro/escuro e navegacao principal"
```

---

### Task 5: Catálogo de procedimentos

**Files:**
- Create: `app/supabase/migrations/0003_procedimentos.sql`
- Create: `app/src/app/(app)/configuracoes/procedimentos/page.tsx`
- Create: `app/src/app/(app)/configuracoes/procedimentos/acoes.ts`
- Test: `app/tests/db/procedimentos.test.ts`

**Interfaces:**
- Consumes: `is_dra()` da Task 2, `exigirDra` da Task 3
- Produces: tabela `procedures(id uuid PK, nome text, duracao_minutos int, preco_centavos int, default_return_interval_days int null, ativo bool)`; server actions `salvarProcedimento(entrada: { id?: string; nome: string; duracaoMinutos: number; precoCentavos: number; retornoDias: number | null })` e `desativarProcedimento(id: string)`.

- [ ] **Step 1: Escrever a migration**

```sql
create table procedures (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  duracao_minutos integer not null check (duracao_minutos between 5 and 480),
  preco_centavos integer not null check (preco_centavos >= 0),
  default_return_interval_days integer check (default_return_interval_days > 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table procedures enable row level security;

create policy "equipe le procedimentos"
  on procedures for select using (auth.uid() is not null);

create policy "so a dra escreve procedimentos"
  on procedures for all using (is_dra()) with check (is_dra());

insert into procedures (nome, duracao_minutos, preco_centavos, default_return_interval_days) values
  ('Toxina botulínica', 60, 180000, 120),
  ('Preenchimento facial', 60, 250000, 365),
  ('Bioestimulador de colágeno', 60, 220000, 180),
  ('Avaliação / primeira consulta', 45, 0, null);
```

O intervalo de retorno é `null` quando o procedimento não gera retorno — é assim que a avaliação inicial fica fora da fila.

- [ ] **Step 2: Aplicar a migration**

Run: `pnpm supabase migration up`
Expected: aplica e insere 4 linhas.

- [ ] **Step 3: Escrever o teste que falha**

Criar `app/tests/db/procedimentos.test.ts` reaproveitando o helper `criarUsuario` da Task 2 (copiar a função para este arquivo — os arquivos de teste são independentes):

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON = process.env.SUPABASE_ANON_KEY!

let admin: SupabaseClient
let comoSecretaria: SupabaseClient
let comoDra: SupabaseClient

async function criarUsuario(email: string, role: 'dra' | 'secretaria') {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'senha-de-teste-123', email_confirm: true,
  })
  if (error) throw error
  await admin.from('profiles').insert({ id: data.user!.id, nome: email, role })
  const sessao = createClient(URL, ANON)
  await sessao.auth.signInWithPassword({ email, password: 'senha-de-teste-123' })
  return sessao
}

beforeAll(async () => {
  admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
  const marca = Date.now()
  comoSecretaria = await criarUsuario(`sec-proc-${marca}@teste.local`, 'secretaria')
  comoDra = await criarUsuario(`dra-proc-${marca}@teste.local`, 'dra')
})

describe('procedures', () => {
  it('vem com o catálogo inicial e a toxina retorna em 120 dias', async () => {
    const { data } = await comoSecretaria
      .from('procedures').select('nome, default_return_interval_days')
      .eq('nome', 'Toxina botulínica').single()
    expect(data!.default_return_interval_days).toBe(120)
  })

  it('avaliação inicial não gera retorno', async () => {
    const { data } = await comoSecretaria
      .from('procedures').select('default_return_interval_days')
      .eq('nome', 'Avaliação / primeira consulta').single()
    expect(data!.default_return_interval_days).toBeNull()
  })

  it('secretária não cria procedimento', async () => {
    const { error } = await comoSecretaria.from('procedures')
      .insert({ nome: 'Teste', duracao_minutos: 30, preco_centavos: 100 })
    expect(error).not.toBeNull()
  })

  it('dra cria procedimento', async () => {
    const { error } = await comoDra.from('procedures')
      .insert({ nome: `Teste ${Date.now()}`, duracao_minutos: 30, preco_centavos: 100 })
    expect(error).toBeNull()
  })
})
```

- [ ] **Step 4: Rodar e confirmar**

Run: `pnpm test:db tests/db/procedimentos.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Criar as server actions**

`app/src/app/(app)/configuracoes/procedimentos/acoes.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSessao } from '@/auth/session'
import { exigirDra } from '@/auth/guard'
import { createServerClient } from '@/lib/supabase/server'

const schema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().min(2),
  duracaoMinutos: z.coerce.number().int().min(5).max(480),
  precoCentavos: z.coerce.number().int().min(0),
  retornoDias: z.coerce.number().int().positive().nullable(),
})

export async function salvarProcedimento(entrada: unknown) {
  exigirDra(await getSessao())
  const dados = schema.parse(entrada)
  const supabase = await createServerClient()

  const linha = {
    nome: dados.nome,
    duracao_minutos: dados.duracaoMinutos,
    preco_centavos: dados.precoCentavos,
    default_return_interval_days: dados.retornoDias,
  }

  const { error } = dados.id
    ? await supabase.from('procedures').update(linha).eq('id', dados.id)
    : await supabase.from('procedures').insert(linha)

  if (error) throw new Error(`Não foi possível salvar o procedimento: ${error.message}`)
  revalidatePath('/configuracoes/procedimentos')
}

export async function desativarProcedimento(id: string) {
  exigirDra(await getSessao())
  const supabase = await createServerClient()
  const { error } = await supabase.from('procedures').update({ ativo: false }).eq('id', id)
  if (error) throw new Error(`Não foi possível desativar: ${error.message}`)
  revalidatePath('/configuracoes/procedimentos')
}
```

- [ ] **Step 6: Criar a página de listagem e edição**

`app/src/app/(app)/configuracoes/procedimentos/page.tsx` — Server Component que lê os procedimentos ativos e renderiza uma tabela com nome, duração, preço formatado em BRL e intervalo de retorno; cada linha abre um formulário que chama `salvarProcedimento`. Formatar preço com `new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preco_centavos / 100)`. Exibir "Sem retorno" quando `default_return_interval_days` for `null`. Ocultar os botões de edição quando `sessao.role !== 'dra'`.

- [ ] **Step 7: Commit**

```bash
git add app/supabase/migrations/0003_procedimentos.sql app/src/app/\(app\)/configuracoes app/tests/db/procedimentos.test.ts
git commit -m "feat: catalogo de procedimentos com intervalo de retorno padrao"
```

---

### Task 6: Pacientes e funil

**Files:**
- Create: `app/supabase/migrations/0004_pacientes.sql`
- Create: `app/src/lib/phone.ts`
- Create: `app/src/app/(app)/crm/page.tsx`, `app/src/app/(app)/crm/kanban.tsx`, `app/src/app/(app)/crm/acoes.ts`
- Test: `app/tests/lib/phone.test.ts`, `app/tests/db/pacientes.test.ts`

**Interfaces:**
- Consumes: enum `patient_stage`, `is_dra()`
- Produces: tabela `patients`; `normalizarTelefone(bruto: string): string | null` devolvendo E.164 (`+5511987654321`); server action `moverEstagio(pacienteId: string, estagio: PatientStage)`; tipo `PatientStage = 'lead' | 'contato' | 'agendado' | 'compareceu' | 'paciente' | 'retorno' | 'descartado'`.

- [ ] **Step 1: Escrever o teste de telefone**

Criar `app/tests/lib/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizarTelefone } from '@/lib/phone'

describe('normalizarTelefone', () => {
  it('normaliza celular com DDD e máscara', () => {
    expect(normalizarTelefone('(11) 98765-4321')).toBe('+5511987654321')
  })

  it('aceita número já em E.164', () => {
    expect(normalizarTelefone('+5511987654321')).toBe('+5511987654321')
  })

  it('aceita fixo de 10 dígitos', () => {
    expect(normalizarTelefone('1132654321')).toBe('+551132654321')
  })

  it('remove o zero do DDD', () => {
    expect(normalizarTelefone('011 98765-4321')).toBe('+5511987654321')
  })

  it('devolve null para entrada curta demais', () => {
    expect(normalizarTelefone('98765')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/lib/phone.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar `src/lib/phone.ts`**

```ts
/**
 * Normaliza telefone brasileiro para E.164. Devolve null quando não dá
 * para inferir um número válido — o chamador decide o que fazer.
 */
export function normalizarTelefone(bruto: string): string | null {
  let digitos = bruto.replace(/\D/g, '')

  if (digitos.startsWith('55') && digitos.length >= 12) {
    digitos = digitos.slice(2)
  }
  if (digitos.startsWith('0')) {
    digitos = digitos.slice(1)
  }
  // 10 dígitos = DDD + fixo; 11 = DDD + celular com nono dígito.
  if (digitos.length !== 10 && digitos.length !== 11) return null

  return `+55${digitos}`
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/lib/phone.test.ts`
Expected: PASS — 5 testes

- [ ] **Step 5: Escrever a migration de pacientes**

`app/supabase/migrations/0004_pacientes.sql`:

```sql
create table patients (
  id uuid primary key default gen_random_uuid(),
  nome_completo text not null,
  como_prefere_ser_chamado text,
  nascimento date,
  sexo text,
  telefone text,                       -- E.164
  email text,
  cpf text,
  nacionalidade text,
  naturalidade text,
  endereco text,
  profissao text,
  lead_source text,                    -- "Como me conheceu"
  contato_emergencia_nome text,
  contato_emergencia_parentesco text,
  contato_emergencia_telefone text,
  stage patient_stage not null default 'lead',
  aceita_whatsapp boolean not null default true,
  aceita_email boolean not null default true,
  consentimento_lgpd_em timestamptz,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index patients_telefone_idx on patients (telefone) where telefone is not null;
create index patients_stage_idx on patients (stage);

alter table patients enable row level security;

create policy "equipe le pacientes"
  on patients for select using (auth.uid() is not null);

-- Cadastro e funil são trabalho da secretária: ela escreve aqui.
create policy "equipe cria pacientes"
  on patients for insert with check (auth.uid() is not null);

create policy "equipe atualiza pacientes"
  on patients for update using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "so a dra remove pacientes"
  on patients for delete using (is_dra());
```

Distinção importante: `patients` guarda dado **cadastral**, que a secretária precisa editar. Dado **clínico** vive nas tabelas de anamnese e atendimento, onde ela só lê — ver Task 8.

- [ ] **Step 6: Escrever o teste de pacientes**

Criar `app/tests/db/pacientes.test.ts` com o mesmo helper `criarUsuario` e os casos:

```ts
it('secretária cadastra um lead', async () => {
  const { error } = await comoSecretaria.from('patients')
    .insert({ nome_completo: 'Maria Teste', telefone: `+5511${Date.now().toString().slice(-9)}` })
  expect(error).toBeNull()
})

it('novo paciente começa no estágio lead', async () => {
  const { data } = await comoSecretaria.from('patients')
    .insert({ nome_completo: 'Ana Teste' }).select('stage').single()
  expect(data!.stage).toBe('lead')
})

it('telefone é único', async () => {
  const tel = `+5511${Date.now().toString().slice(-9)}`
  await comoSecretaria.from('patients').insert({ nome_completo: 'A', telefone: tel })
  const { error } = await comoSecretaria.from('patients')
    .insert({ nome_completo: 'B', telefone: tel })
  expect(error).not.toBeNull()
})

it('secretária não apaga paciente', async () => {
  const { data } = await comoSecretaria.from('patients')
    .insert({ nome_completo: 'Para apagar' }).select('id').single()
  const { error } = await comoSecretaria.from('patients').delete().eq('id', data!.id)
  expect(error).not.toBeNull()
})
```

- [ ] **Step 7: Rodar e confirmar**

Run: `pnpm supabase migration up && pnpm test:db tests/db/pacientes.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 8: Criar a server action de movimentação**

`app/src/app/(app)/crm/acoes.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'

export const ESTAGIOS = [
  'lead', 'contato', 'agendado', 'compareceu', 'paciente', 'retorno', 'descartado',
] as const

export type PatientStage = (typeof ESTAGIOS)[number]

const schema = z.object({
  pacienteId: z.string().uuid(),
  estagio: z.enum(ESTAGIOS),
})

export async function moverEstagio(pacienteId: string, estagio: PatientStage) {
  const sessao = await requireSessao()
  const dados = schema.parse({ pacienteId, estagio })
  const supabase = await createServerClient()

  const { error } = await supabase
    .from('patients')
    .update({ stage: dados.estagio, atualizado_em: new Date().toISOString() })
    .eq('id', dados.pacienteId)

  if (error) throw new Error(`Não foi possível mover o paciente: ${error.message}`)

  await supabase.from('audit_log').insert({
    ator: sessao.userId,
    acao: `estagio:${dados.estagio}`,
    entidade: 'patients',
    registro_id: dados.pacienteId,
  })

  revalidatePath('/crm')
}
```

- [ ] **Step 9: Criar o kanban**

`app/src/app/(app)/crm/page.tsx` é um Server Component que carrega os pacientes agrupados por `stage` e passa para `<Kanban />`. `kanban.tsx` é Client Component com uma coluna por estágio (na ordem da Global Constraints), cartão mostrando nome, telefone formatado e origem, arraste entre colunas usando a HTML Drag and Drop API nativa (`draggable`, `onDragStart`, `onDrop`) e chamada a `moverEstagio` no drop, com atualização otimista revertida em caso de erro. Colunas vazias exibem "Nenhum paciente neste estágio".

- [ ] **Step 10: Commit**

```bash
git add app/supabase/migrations/0004_pacientes.sql app/src/lib/phone.ts app/src/app/\(app\)/crm app/tests
git commit -m "feat: cadastro de pacientes e funil kanban de 7 estagios"
```

---

### Task 7: Agenda com detecção de conflito

**Files:**
- Create: `app/supabase/migrations/0005_agendamentos.sql`
- Create: `app/src/domain/scheduling/conflict.ts`
- Create: `app/src/app/(app)/agenda/page.tsx`, `app/src/app/(app)/agenda/acoes.ts`
- Test: `app/tests/domain/conflict.test.ts`

**Interfaces:**
- Consumes: `procedures`, `patients`
- Produces: tabela `appointments(id uuid PK, patient_id uuid, procedure_id uuid, inicio timestamptz, fim timestamptz, status appointment_status, observacoes text)`; tipo `Slot = { id?: string; inicio: Date; fim: Date }`; `detectarConflito(novo: Slot, existentes: Slot[]): Slot | null`; server action `agendarConsulta(entrada: { pacienteId: string; procedimentoId: string; inicio: string })`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/domain/conflict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectarConflito } from '@/domain/scheduling/conflict'

const slot = (inicio: string, fim: string, id?: string) => ({
  id, inicio: new Date(inicio), fim: new Date(fim),
})

describe('detectarConflito', () => {
  const existentes = [slot('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', 'a')]

  it('não acusa conflito em horário livre', () => {
    expect(detectarConflito(slot('2026-08-10T16:00:00Z', '2026-08-10T17:00:00Z'), existentes)).toBeNull()
  })

  it('acusa sobreposição parcial no início', () => {
    const achado = detectarConflito(slot('2026-08-10T14:30:00Z', '2026-08-10T15:30:00Z'), existentes)
    expect(achado?.id).toBe('a')
  })

  it('acusa quando o novo engloba o existente', () => {
    const achado = detectarConflito(slot('2026-08-10T13:00:00Z', '2026-08-10T16:00:00Z'), existentes)
    expect(achado?.id).toBe('a')
  })

  it('encostar no fim não é conflito', () => {
    expect(detectarConflito(slot('2026-08-10T15:00:00Z', '2026-08-10T16:00:00Z'), existentes)).toBeNull()
  })

  it('ignora o próprio agendamento ao remarcar', () => {
    const remarcado = slot('2026-08-10T14:15:00Z', '2026-08-10T15:15:00Z', 'a')
    expect(detectarConflito(remarcado, existentes)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/domain/conflict.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar `src/domain/scheduling/conflict.ts`**

```ts
export type Slot = { id?: string; inicio: Date; fim: Date }

/**
 * Devolve o primeiro slot que colide com `novo`, ou null.
 * Intervalos são semiabertos: [inicio, fim). Encostar não colide.
 */
export function detectarConflito(novo: Slot, existentes: Slot[]): Slot | null {
  for (const atual of existentes) {
    if (novo.id && atual.id === novo.id) continue
    const colide = novo.inicio < atual.fim && atual.inicio < novo.fim
    if (colide) return atual
  }
  return null
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/domain/conflict.test.ts`
Expected: PASS — 5 testes

- [ ] **Step 5: Escrever a migration**

```sql
create table appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  procedure_id uuid not null references procedures(id),
  inicio timestamptz not null,
  fim timestamptz not null,
  status appointment_status not null default 'agendado',
  observacoes text,
  google_event_id text,
  criado_em timestamptz not null default now(),
  constraint fim_depois_do_inicio check (fim > inicio)
);

create index appointments_inicio_idx on appointments (inicio);
create index appointments_patient_idx on appointments (patient_id, inicio desc);

alter table appointments enable row level security;

create policy "equipe le agenda" on appointments
  for select using (auth.uid() is not null);
create policy "equipe agenda" on appointments
  for insert with check (auth.uid() is not null);
create policy "equipe remarca" on appointments
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "so a dra apaga agendamento" on appointments
  for delete using (is_dra());
```

- [ ] **Step 6: Criar a server action de agendamento**

`app/src/app/(app)/agenda/acoes.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSessao } from '@/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import { detectarConflito } from '@/domain/scheduling/conflict'
import { planejarLembretes } from '@/domain/reminders/plan-reminders'

const schema = z.object({
  pacienteId: z.string().uuid(),
  procedimentoId: z.string().uuid(),
  inicio: z.string().datetime(),
})

export async function agendarConsulta(entrada: unknown) {
  await requireSessao()
  const dados = schema.parse(entrada)
  const supabase = await createServerClient()

  const { data: procedimento, error: erroProc } = await supabase
    .from('procedures').select('id, nome, duracao_minutos').eq('id', dados.procedimentoId).single()
  if (erroProc || !procedimento) throw new Error('Procedimento não encontrado')

  const inicio = new Date(dados.inicio)
  const fim = new Date(inicio.getTime() + procedimento.duracao_minutos * 60_000)

  // Busca o dia inteiro: janela suficiente para achar qualquer sobreposição.
  const diaInicio = new Date(inicio); diaInicio.setUTCHours(0, 0, 0, 0)
  const diaFim = new Date(diaInicio.getTime() + 24 * 3600 * 1000)

  const { data: doDia } = await supabase
    .from('appointments').select('id, inicio, fim')
    .gte('inicio', diaInicio.toISOString()).lt('inicio', diaFim.toISOString())
    .neq('status', 'cancelado')

  const existentes = (doDia ?? []).map((a) => ({
    id: a.id, inicio: new Date(a.inicio), fim: new Date(a.fim),
  }))

  const conflito = detectarConflito({ inicio, fim }, existentes)
  if (conflito) {
    const hora = conflito.inicio.toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    })
    throw new Error(`Já existe consulta às ${hora} nesse horário`)
  }

  const { data: consulta, error } = await supabase.from('appointments')
    .insert({
      patient_id: dados.pacienteId,
      procedure_id: dados.procedimentoId,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
    })
    .select('id').single()

  if (error) throw new Error(`Não foi possível agendar: ${error.message}`)

  await supabase.from('patients').update({ stage: 'agendado' }).eq('id', dados.pacienteId)

  const jobs = planejarLembretes({
    appointmentId: consulta!.id,
    patientId: dados.pacienteId,
    inicio,
    aceitaWhatsapp: true,
    aceitaEmail: true,
  })
  await supabase.from('reminder_jobs').insert(jobs.map((j) => ({
    appointment_id: j.appointmentId,
    patient_id: j.patientId,
    kind: j.kind,
    channel: j.channel,
    agendado_para: j.agendadoPara.toISOString(),
    chave_idempotencia: j.chaveIdempotencia,
  })))

  revalidatePath('/agenda')
  revalidatePath('/crm')
  return consulta!.id
}
```

`planejarLembretes` e a tabela `reminder_jobs` vêm da Task 9 — esta action só funciona depois dela. Execute a Task 9 antes de testar o agendamento fim a fim.

- [ ] **Step 7: Criar a visão de agenda**

`app/src/app/(app)/agenda/page.tsx`: Server Component que recebe `?semana=YYYY-MM-DD` (padrão: semana atual), carrega os agendamentos do intervalo com join em `patients.nome_completo` e `procedures.nome`, e renderiza uma grade de 7 colunas (segunda a domingo) por faixas de 30 minutos das 08:00 às 20:00, no timezone `America/Sao_Paulo`. Cada bloco mostra hora, nome do paciente e procedimento, com cor de fundo por status. Botões de semana anterior e próxima. Clicar num espaço vazio abre o formulário de novo agendamento; erro de conflito aparece como alerta acima do formulário com a mensagem lançada pela action.

- [ ] **Step 8: Commit**

```bash
git add app/supabase/migrations/0005_agendamentos.sql app/src/domain/scheduling app/src/app/\(app\)/agenda app/tests/domain/conflict.test.ts
git commit -m "feat: agenda semanal com deteccao de conflito de horario"
```

---

### Task 8: Atendimento realizado e retorno em 3 níveis

**Files:**
- Create: `app/supabase/migrations/0006_atendimentos.sql`
- Create: `app/src/domain/returns/compute-return.ts`
- Create: `app/src/app/(app)/retornos/page.tsx`
- Create: `app/src/app/(app)/pacientes/[id]/registrar-atendimento.tsx`
- Test: `app/tests/domain/compute-return.test.ts`, `app/tests/db/atendimentos.test.ts`

**Interfaces:**
- Consumes: `procedures.default_return_interval_days`, `appointments`
- Produces: tabela `attendance_records`; `calcularRetorno(entrada: EntradaRetorno): Date | null` e `statusRetorno(vencimento: Date | null, hoje: Date): 'sem_retorno' | 'em_dia' | 'vencendo' | 'vencido'`, onde `EntradaRetorno = { realizadoEm: Date; padraoDias: number | null; ajusteDias?: number | null; ajusteData?: Date | null; semRetorno?: boolean }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/domain/compute-return.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calcularRetorno, statusRetorno } from '@/domain/returns/compute-return'

const realizadoEm = new Date('2026-08-05T12:00:00Z')

describe('calcularRetorno — 3 níveis', () => {
  it('nível 1: usa o padrão do procedimento', () => {
    const r = calcularRetorno({ realizadoEm, padraoDias: 120 })
    expect(r!.toISOString().slice(0, 10)).toBe('2026-12-03')
  })

  it('nível 2a: ajuste em dias vence o padrão', () => {
    const r = calcularRetorno({ realizadoEm, padraoDias: 120, ajusteDias: 90 })
    expect(r!.toISOString().slice(0, 10)).toBe('2026-11-03')
  })

  it('nível 2b: data explícita vence tudo', () => {
    const r = calcularRetorno({
      realizadoEm, padraoDias: 120, ajusteDias: 90,
      ajusteData: new Date('2027-01-15T12:00:00Z'),
    })
    expect(r!.toISOString().slice(0, 10)).toBe('2027-01-15')
  })

  it('nível 3: sem retorno vence inclusive a data explícita', () => {
    const r = calcularRetorno({
      realizadoEm, padraoDias: 120,
      ajusteData: new Date('2027-01-15T12:00:00Z'), semRetorno: true,
    })
    expect(r).toBeNull()
  })

  it('procedimento sem retorno padrão e sem ajuste não gera retorno', () => {
    expect(calcularRetorno({ realizadoEm, padraoDias: null })).toBeNull()
  })
})

describe('statusRetorno', () => {
  const hoje = new Date('2026-08-05T12:00:00Z')

  it('sem vencimento é sem_retorno', () => {
    expect(statusRetorno(null, hoje)).toBe('sem_retorno')
  })

  it('faltando 60 dias está em dia', () => {
    expect(statusRetorno(new Date('2026-10-04T12:00:00Z'), hoje)).toBe('em_dia')
  })

  it('faltando 30 dias já está vencendo', () => {
    expect(statusRetorno(new Date('2026-09-04T12:00:00Z'), hoje)).toBe('vencendo')
  })

  it('faltando 1 dia está vencendo', () => {
    expect(statusRetorno(new Date('2026-08-06T12:00:00Z'), hoje)).toBe('vencendo')
  })

  it('data passada está vencido', () => {
    expect(statusRetorno(new Date('2026-08-01T12:00:00Z'), hoje)).toBe('vencido')
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/domain/compute-return.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar `src/domain/returns/compute-return.ts`**

```ts
export type EntradaRetorno = {
  realizadoEm: Date
  /** Intervalo padrão do procedimento no catálogo. Null = não gera retorno. */
  padraoDias: number | null
  /** Ajuste em dias feito pela Dra. no registro do atendimento. */
  ajusteDias?: number | null
  /** Data escolhida no calendário pela Dra. Vence o ajuste em dias. */
  ajusteData?: Date | null
  /** Marcado quando o retorno não se aplica àquele paciente. Vence tudo. */
  semRetorno?: boolean
}

export type StatusRetorno = 'sem_retorno' | 'em_dia' | 'vencendo' | 'vencido'

const DIA_EM_MS = 24 * 60 * 60 * 1000
export const JANELA_VENCENDO_DIAS = 30

/**
 * Precedência, do mais forte ao mais fraco:
 *   semRetorno > ajusteData > ajusteDias > padraoDias
 */
export function calcularRetorno(entrada: EntradaRetorno): Date | null {
  if (entrada.semRetorno) return null
  if (entrada.ajusteData) return entrada.ajusteData

  const dias = entrada.ajusteDias ?? entrada.padraoDias
  if (dias == null) return null

  return new Date(entrada.realizadoEm.getTime() + dias * DIA_EM_MS)
}

export function statusRetorno(vencimento: Date | null, hoje: Date): StatusRetorno {
  if (!vencimento) return 'sem_retorno'
  const diasRestantes = Math.ceil((vencimento.getTime() - hoje.getTime()) / DIA_EM_MS)
  if (diasRestantes < 0) return 'vencido'
  if (diasRestantes <= JANELA_VENCENDO_DIAS) return 'vencendo'
  return 'em_dia'
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/domain/compute-return.test.ts`
Expected: PASS — 10 testes

- [ ] **Step 5: Escrever a migration de atendimentos**

```sql
create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  procedure_id uuid not null references procedures(id),
  realizado_em timestamptz not null default now(),
  regiao_tratada text,
  quantidade text,
  observacoes text,
  -- Retorno: o que estiver aqui vence o padrão do catálogo.
  retorno_ajuste_dias integer check (retorno_ajuste_dias > 0),
  retorno_data date,
  sem_retorno boolean not null default false,
  retorno_vencimento date,             -- resultado calculado, gravado para consulta
  registrado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now()
);

create index attendance_retorno_idx on attendance_records (retorno_vencimento)
  where retorno_vencimento is not null;
create index attendance_patient_idx on attendance_records (patient_id, realizado_em desc);

alter table attendance_records enable row level security;

-- A secretária LÊ o prontuário, mas não escreve nada nele.
create policy "equipe le atendimentos"
  on attendance_records for select using (auth.uid() is not null);

create policy "so a dra registra atendimento"
  on attendance_records for insert with check (is_dra());

create policy "so a dra edita atendimento"
  on attendance_records for update using (is_dra()) with check (is_dra());

create policy "so a dra apaga atendimento"
  on attendance_records for delete using (is_dra());
```

- [ ] **Step 6: Escrever o teste de RLS de atendimento**

Criar `app/tests/db/atendimentos.test.ts` com o helper `criarUsuario` e os casos:

```ts
it('secretária não registra atendimento', async () => {
  const { error } = await comoSecretaria.from('attendance_records').insert({
    patient_id: pacienteId, procedure_id: procedimentoId, registrado_por: idSecretaria,
  })
  expect(error).not.toBeNull()
})

it('dra registra atendimento', async () => {
  const { error } = await comoDra.from('attendance_records').insert({
    patient_id: pacienteId, procedure_id: procedimentoId, registrado_por: idDra,
    retorno_vencimento: '2026-12-03',
  })
  expect(error).toBeNull()
})

it('secretária consegue ler o atendimento registrado', async () => {
  const { data, error } = await comoSecretaria
    .from('attendance_records').select('id').eq('patient_id', pacienteId)
  expect(error).toBeNull()
  expect(data!.length).toBeGreaterThan(0)
})
```

- [ ] **Step 7: Rodar e confirmar**

Run: `pnpm supabase migration up && pnpm test:db tests/db/atendimentos.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 8: Criar o formulário de registro de atendimento**

`app/src/app/(app)/pacientes/[id]/registrar-atendimento.tsx`: Client Component visível apenas quando `sessao.role === 'dra'`. Ao escolher o procedimento, o campo "Retornar em" já vem preenchido com `default_return_interval_days` do procedimento e a data calculada aparece por extenso ("Retorno previsto: 3 de dezembro de 2026"). Três controles, na ordem de precedência: campo numérico de dias, seletor de data, e checkbox "Este paciente não precisa de retorno" que desabilita os outros dois. A prévia recalcula a cada mudança usando `calcularRetorno`. Ao salvar, a server action grava `retorno_ajuste_dias`, `retorno_data`, `sem_retorno` **e** o `retorno_vencimento` resultante, atualiza o `stage` do paciente para `paciente`, e cria os lembretes de pós-procedimento, avaliação e retorno via `planejarLembretesPosAtendimento` (Task 9).

- [ ] **Step 9: Criar a página de fila de retorno**

`app/src/app/(app)/retornos/page.tsx`: Server Component que busca os atendimentos com `retorno_vencimento` não nulo, pega o mais recente por paciente, calcula `statusRetorno` e lista apenas `vencido` e `vencendo`, ordenando vencidos primeiro e depois por data crescente. Cada linha mostra nome, telefone, procedimento, data do vencimento, dias restantes ou de atraso, e botões para agendar e abrir a conversa. Exibir contadores no topo: quantos vencidos e quantos vencendo.

- [ ] **Step 10: Commit**

```bash
git add app/supabase/migrations/0006_atendimentos.sql app/src/domain/returns app/src/app/\(app\)/retornos app/src/app/\(app\)/pacientes app/tests
git commit -m "feat: registro de atendimento com retorno configuravel em 3 niveis"
```

---

### Task 9: Planejamento de lembretes e janela de silêncio

**Files:**
- Create: `app/supabase/migrations/0007_lembretes.sql`
- Create: `app/src/domain/reminders/quiet-hours.ts`, `plan-reminders.ts`, `template.ts`
- Test: `app/tests/domain/quiet-hours.test.ts`, `plan-reminders.test.ts`, `template.test.ts`

**Interfaces:**
- Consumes: `calcularRetorno` da Task 8
- Produces: tabela `reminder_jobs` e `message_templates`; `aplicarJanelaDeSilencio(momento: Date, tz?: string): Date`; `planejarLembretes(entrada: EntradaConsulta): JobPlanejado[]`; `planejarLembretesPosAtendimento(entrada: EntradaAtendimento): JobPlanejado[]`; `renderizarTemplate(texto: string, variaveis: Record<string, string>): string`. Tipo `JobPlanejado = { appointmentId: string | null; patientId: string; kind: ReminderKind; channel: 'whatsapp' | 'email'; agendadoPara: Date; chaveIdempotencia: string }`.

- [ ] **Step 1: Escrever o teste da janela de silêncio**

Criar `app/tests/domain/quiet-hours.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { aplicarJanelaDeSilencio } from '@/domain/reminders/quiet-hours'

// Horários em UTC; São Paulo é UTC-3.
const emSaoPaulo = (iso: string) => new Date(iso)

describe('aplicarJanelaDeSilencio', () => {
  it('deixa passar 14h de São Paulo', () => {
    const momento = emSaoPaulo('2026-08-05T17:00:00Z') // 14h em SP
    expect(aplicarJanelaDeSilencio(momento).toISOString()).toBe('2026-08-05T17:00:00.000Z')
  })

  it('empurra 22h de São Paulo para as 9h do dia seguinte', () => {
    const momento = emSaoPaulo('2026-08-06T01:00:00Z') // 22h de 05/08 em SP
    // 09:00 de 06/08 em SP = 12:00 UTC
    expect(aplicarJanelaDeSilencio(momento).toISOString()).toBe('2026-08-06T12:00:00.000Z')
  })

  it('empurra 03h de São Paulo para as 9h do mesmo dia', () => {
    const momento = emSaoPaulo('2026-08-06T06:00:00Z') // 03h de 06/08 em SP
    expect(aplicarJanelaDeSilencio(momento).toISOString()).toBe('2026-08-06T12:00:00.000Z')
  })

  it('08h de São Paulo já está liberado', () => {
    const momento = emSaoPaulo('2026-08-06T11:00:00Z') // 08h em SP
    expect(aplicarJanelaDeSilencio(momento).toISOString()).toBe('2026-08-06T11:00:00.000Z')
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/domain/quiet-hours.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar `quiet-hours.ts`**

```ts
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

export const TZ_PADRAO = 'America/Sao_Paulo'
export const SILENCIO_INICIO = 21 // 21:00 inclusive
export const SILENCIO_FIM = 8     // 08:00 exclusive
export const HORA_DE_RETOMADA = 9

/**
 * Reagenda para as 09:00 locais quando o momento cai na janela de silêncio.
 * Antes das 08:00 vai para as 09:00 do mesmo dia; a partir das 21:00 vai
 * para as 09:00 do dia seguinte.
 */
export function aplicarJanelaDeSilencio(momento: Date, tz: string = TZ_PADRAO): Date {
  const local = toZonedTime(momento, tz)
  const hora = local.getHours()

  if (hora >= SILENCIO_FIM && hora < SILENCIO_INICIO) return momento

  const alvo = new Date(local)
  if (hora >= SILENCIO_INICIO) alvo.setDate(alvo.getDate() + 1)
  alvo.setHours(HORA_DE_RETOMADA, 0, 0, 0)

  const dia = formatInTimeZone(fromZonedTime(alvo, tz), tz, 'yyyy-MM-dd')
  return fromZonedTime(`${dia} 09:00:00`, tz)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/domain/quiet-hours.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Escrever o teste do planejamento**

Criar `app/tests/domain/plan-reminders.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { planejarLembretes, planejarLembretesPosAtendimento } from '@/domain/reminders/plan-reminders'

const base = {
  appointmentId: 'ap-1',
  patientId: 'pa-1',
  inicio: new Date('2026-08-20T17:00:00Z'), // 14h em SP
  aceitaWhatsapp: true,
  aceitaEmail: true,
}

describe('planejarLembretes', () => {
  it('gera confirmação por whatsapp e por e-mail, e a véspera curta', () => {
    const jobs = planejarLembretes(base)
    const tipos = jobs.map((j) => `${j.kind}:${j.channel}`)
    expect(tipos).toContain('confirmacao:whatsapp')
    expect(tipos).toContain('confirmacao:email')
    expect(tipos).toContain('vespera_curta:whatsapp')
    expect(tipos).not.toContain('vespera_curta:email')
  })

  it('confirmação sai às 09:00 de São Paulo do dia anterior', () => {
    const job = planejarLembretes(base).find((j) => j.kind === 'confirmacao' && j.channel === 'whatsapp')!
    expect(job.agendadoPara.toISOString()).toBe('2026-08-19T12:00:00.000Z')
  })

  it('véspera curta sai 3 horas antes', () => {
    const job = planejarLembretes(base).find((j) => j.kind === 'vespera_curta')!
    expect(job.agendadoPara.toISOString()).toBe('2026-08-20T14:00:00.000Z')
  })

  it('respeita opt-out de e-mail', () => {
    const jobs = planejarLembretes({ ...base, aceitaEmail: false })
    expect(jobs.every((j) => j.channel !== 'email')).toBe(true)
  })

  it('não gera nada quando o paciente recusou os dois canais', () => {
    expect(planejarLembretes({ ...base, aceitaEmail: false, aceitaWhatsapp: false })).toHaveLength(0)
  })

  it('chave de idempotência é única por consulta, tipo e canal', () => {
    const chaves = planejarLembretes(base).map((j) => j.chaveIdempotencia)
    expect(new Set(chaves).size).toBe(chaves.length)
    expect(chaves).toContain('ap-1:confirmacao:whatsapp')
  })
})

describe('planejarLembretesPosAtendimento', () => {
  const pos = {
    attendanceId: 'at-1',
    patientId: 'pa-1',
    realizadoEm: new Date('2026-08-20T17:00:00Z'),
    retornoVencimento: new Date('2026-12-18T12:00:00Z'),
    aceitaWhatsapp: true,
    aceitaEmail: true,
  }

  it('agenda cuidados em 24h e avaliação em 7 dias', () => {
    const jobs = planejarLembretesPosAtendimento(pos)
    const cuidados = jobs.find((j) => j.kind === 'pos_procedimento')!
    const avaliacao = jobs.find((j) => j.kind === 'avaliacao')!
    expect(cuidados.agendadoPara.toISOString()).toBe('2026-08-21T17:00:00.000Z')
    expect(avaliacao.agendadoPara.toISOString()).toBe('2026-08-27T17:00:00.000Z')
  })

  it('agenda o retorno 7 dias antes do vencimento', () => {
    const retorno = planejarLembretesPosAtendimento(pos).filter((j) => j.kind === 'retorno')
    expect(retorno.map((j) => j.channel).sort()).toEqual(['email', 'whatsapp'])
    expect(retorno[0].agendadoPara.toISOString()).toBe('2026-12-11T12:00:00.000Z')
  })

  it('sem vencimento não gera lembrete de retorno', () => {
    const jobs = planejarLembretesPosAtendimento({ ...pos, retornoVencimento: null })
    expect(jobs.some((j) => j.kind === 'retorno')).toBe(false)
  })
})
```

- [ ] **Step 6: Rodar e confirmar a falha**

Run: `pnpm test tests/domain/plan-reminders.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 7: Implementar `plan-reminders.ts`**

```ts
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { aplicarJanelaDeSilencio, TZ_PADRAO } from '@/domain/reminders/quiet-hours'

export type ReminderKind =
  | 'confirmacao' | 'vespera_curta' | 'pos_procedimento' | 'avaliacao' | 'retorno'

export type Canal = 'whatsapp' | 'email'

export type JobPlanejado = {
  appointmentId: string | null
  attendanceId?: string | null
  patientId: string
  kind: ReminderKind
  channel: Canal
  agendadoPara: Date
  chaveIdempotencia: string
}

export type EntradaConsulta = {
  appointmentId: string
  patientId: string
  inicio: Date
  aceitaWhatsapp: boolean
  aceitaEmail: boolean
}

export type EntradaAtendimento = {
  attendanceId: string
  patientId: string
  realizadoEm: Date
  retornoVencimento: Date | null
  aceitaWhatsapp: boolean
  aceitaEmail: boolean
}

const HORA_EM_MS = 3600 * 1000
const DIA_EM_MS = 24 * HORA_EM_MS

/** 09:00 locais do dia anterior ao `momento`. */
function noveHorasDoDiaAnterior(momento: Date, tz: string): Date {
  const diaAnterior = new Date(momento.getTime() - DIA_EM_MS)
  const dia = formatInTimeZone(diaAnterior, tz, 'yyyy-MM-dd')
  return fromZonedTime(`${dia} 09:00:00`, tz)
}

function canaisAtivos(aceitaWhatsapp: boolean, aceitaEmail: boolean): Canal[] {
  const lista: Canal[] = []
  if (aceitaWhatsapp) lista.push('whatsapp')
  if (aceitaEmail) lista.push('email')
  return lista
}

export function planejarLembretes(
  entrada: EntradaConsulta, tz: string = TZ_PADRAO,
): JobPlanejado[] {
  const canais = canaisAtivos(entrada.aceitaWhatsapp, entrada.aceitaEmail)
  if (canais.length === 0) return []

  const jobs: JobPlanejado[] = []

  // Confirmação: D-1 às 09:00, nos dois canais disponíveis.
  const momentoConfirmacao = noveHorasDoDiaAnterior(entrada.inicio, tz)
  for (const channel of canais) {
    jobs.push({
      appointmentId: entrada.appointmentId,
      patientId: entrada.patientId,
      kind: 'confirmacao',
      channel,
      agendadoPara: momentoConfirmacao,
      chaveIdempotencia: `${entrada.appointmentId}:confirmacao:${channel}`,
    })
  }

  // Véspera curta: 3h antes, só WhatsApp (e-mail não é lido a tempo).
  if (entrada.aceitaWhatsapp) {
    jobs.push({
      appointmentId: entrada.appointmentId,
      patientId: entrada.patientId,
      kind: 'vespera_curta',
      channel: 'whatsapp',
      agendadoPara: new Date(entrada.inicio.getTime() - 3 * HORA_EM_MS),
      chaveIdempotencia: `${entrada.appointmentId}:vespera_curta:whatsapp`,
    })
  }

  return jobs
}

export function planejarLembretesPosAtendimento(
  entrada: EntradaAtendimento, tz: string = TZ_PADRAO,
): JobPlanejado[] {
  const canais = canaisAtivos(entrada.aceitaWhatsapp, entrada.aceitaEmail)
  if (canais.length === 0) return []

  const jobs: JobPlanejado[] = []

  if (entrada.aceitaWhatsapp) {
    jobs.push({
      appointmentId: null,
      attendanceId: entrada.attendanceId,
      patientId: entrada.patientId,
      kind: 'pos_procedimento',
      channel: 'whatsapp',
      agendadoPara: new Date(entrada.realizadoEm.getTime() + DIA_EM_MS),
      chaveIdempotencia: `${entrada.attendanceId}:pos_procedimento:whatsapp`,
    })
    jobs.push({
      appointmentId: null,
      attendanceId: entrada.attendanceId,
      patientId: entrada.patientId,
      kind: 'avaliacao',
      channel: 'whatsapp',
      agendadoPara: new Date(entrada.realizadoEm.getTime() + 7 * DIA_EM_MS),
      chaveIdempotencia: `${entrada.attendanceId}:avaliacao:whatsapp`,
    })
  }

  if (entrada.retornoVencimento) {
    const momento = new Date(entrada.retornoVencimento.getTime() - 7 * DIA_EM_MS)
    for (const channel of canais) {
      jobs.push({
        appointmentId: null,
        attendanceId: entrada.attendanceId,
        patientId: entrada.patientId,
        kind: 'retorno',
        channel,
        agendadoPara: momento,
        chaveIdempotencia: `${entrada.attendanceId}:retorno:${channel}`,
      })
    }
  }

  return jobs
}
```

Nota: a janela de silêncio **não** é aplicada aqui — ela roda no despacho (Task 11), porque o horário planejado pode ser deslocado por atraso do worker e o que importa é a hora real do envio.

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `pnpm test tests/domain/plan-reminders.test.ts`
Expected: PASS — 9 testes

- [ ] **Step 9: Escrever o teste e implementar o template**

Criar `app/tests/domain/template.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderizarTemplate } from '@/domain/reminders/template'

describe('renderizarTemplate', () => {
  it('substitui variáveis pelo valor', () => {
    const texto = renderizarTemplate('Olá {{nome}}, sua consulta é {{data}} às {{hora}}.', {
      nome: 'Maria', data: '20/08', hora: '14:00',
    })
    expect(texto).toBe('Olá Maria, sua consulta é 20/08 às 14:00.')
  })

  it('substitui a mesma variável em todas as ocorrências', () => {
    expect(renderizarTemplate('{{nome}} e {{nome}}', { nome: 'Ana' })).toBe('Ana e Ana')
  })

  it('deixa em branco a variável não fornecida em vez de imprimir a chave', () => {
    expect(renderizarTemplate('Olá {{nome}}{{sobrenome}}!', { nome: 'Ana' })).toBe('Olá Ana!')
  })

  it('tolera espaços dentro das chaves', () => {
    expect(renderizarTemplate('Olá {{ nome }}', { nome: 'Ana' })).toBe('Olá Ana')
  })
})
```

Implementar `src/domain/reminders/template.ts`:

```ts
/**
 * Substitui {{variavel}} pelo valor. Variável ausente vira string vazia:
 * é melhor mandar uma frase incompleta do que expor "{{nome}}" ao paciente.
 */
export function renderizarTemplate(
  texto: string, variaveis: Record<string, string>,
): string {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave: string) => variaveis[chave] ?? '')
}
```

Run: `pnpm test tests/domain/template.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 10: Escrever a migration de lembretes**

`app/supabase/migrations/0007_lembretes.sql`:

```sql
create table message_templates (
  kind reminder_kind not null,
  channel reminder_channel not null,
  assunto text,                        -- usado só no e-mail
  corpo text not null,
  ativo boolean not null default true,
  primary key (kind, channel)
);

alter table message_templates enable row level security;
create policy "equipe le templates" on message_templates
  for select using (auth.uid() is not null);
create policy "so a dra edita templates" on message_templates
  for all using (is_dra()) with check (is_dra());

insert into message_templates (kind, channel, assunto, corpo) values
  ('confirmacao', 'whatsapp', null,
   'Olá, {{nome}}! Passando para confirmar sua consulta amanhã, {{data}}, às {{hora}}, com a Dra. Izadora Barros. Podemos confirmar sua presença?'),
  ('confirmacao', 'email', 'Sua consulta é amanhã, {{data}}',
   'Olá, {{nome}}! Sua consulta está marcada para {{data}} às {{hora}}. Qualquer imprevisto, é só responder esta mensagem.'),
  ('vespera_curta', 'whatsapp', null,
   'Oi, {{nome}}! Seu horário com a Dra. Izadora é hoje às {{hora}}. Te esperamos!'),
  ('pos_procedimento', 'whatsapp', null,
   'Oi, {{nome}}! Como você está depois do seu {{procedimento}}? Lembrando dos cuidados: evite exposição solar, calor intenso e exercícios pesados nas primeiras 24 horas. Qualquer dúvida, me chame por aqui.'),
  ('avaliacao', 'whatsapp', null,
   'Oi, {{nome}}! Já faz uma semana do seu {{procedimento}}. Como está se sentindo com o resultado? Sua opinião ajuda muito a Dra. Izadora.'),
  ('retorno', 'whatsapp', null,
   'Oi, {{nome}}! Seu retorno de {{procedimento}} está chegando ({{data_retorno}}). Quer que eu já reserve um horário para você?'),
  ('retorno', 'email', 'Seu retorno está chegando',
   'Olá, {{nome}}! O retorno do seu {{procedimento}} está previsto para {{data_retorno}}. Responda esta mensagem para agendarmos.');

create table reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references appointments(id) on delete cascade,
  attendance_id uuid references attendance_records(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  kind reminder_kind not null,
  channel reminder_channel not null,
  agendado_para timestamptz not null,
  status reminder_status not null default 'pendente',
  tentativas integer not null default 0,
  enviado_em timestamptz,
  erro text,
  provider_message_id text,
  chave_idempotencia text not null unique,
  criado_em timestamptz not null default now()
);

create index reminder_jobs_fila_idx on reminder_jobs (status, agendado_para)
  where status = 'pendente';

alter table reminder_jobs enable row level security;
create policy "equipe le lembretes" on reminder_jobs
  for select using (auth.uid() is not null);
create policy "equipe cria lembretes" on reminder_jobs
  for insert with check (auth.uid() is not null);
create policy "equipe cancela lembretes" on reminder_jobs
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
```

A restrição `unique` em `chave_idempotencia` é o que garante que reprocessar não duplica: o segundo `insert` falha no banco, não na aplicação.

- [ ] **Step 11: Aplicar e commitar**

```bash
pnpm supabase migration up
pnpm test tests/domain
git add app/supabase/migrations/0007_lembretes.sql app/src/domain/reminders app/tests/domain
git commit -m "feat: planejamento de lembretes, janela de silencio e templates"
```

---

### Task 10: Adaptadores da Evolution API e do e-mail

**Files:**
- Create: `app/src/integrations/evolution/client.ts`
- Create: `app/src/integrations/email/resend.ts`
- Test: `app/tests/integrations/evolution.test.ts`

**Interfaces:**
- Consumes: `serverEnv()` da Task 1
- Produces: `criarEvolutionClient(config?, fetchImpl?)` devolvendo `{ enviarTexto({ telefone, texto }): Promise<{ providerMessageId: string }> }`; `criarEmailClient(config?, fetchImpl?)` devolvendo `{ enviar({ para, assunto, html }): Promise<{ providerMessageId: string }> }`; classe `ErroDeEnvio extends Error` com propriedade `permanente: boolean`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/integrations/evolution.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { criarEvolutionClient, ErroDeEnvio } from '@/integrations/evolution/client'

const config = { url: 'http://evolution:8080', apiKey: 'k', instancia: 'clinica' }

describe('EvolutionClient', () => {
  it('chama o endpoint correto com o número sem o mais', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ key: { id: 'MSG123' } }),
    })
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const r = await client.enviarTexto({ telefone: '+5511987654321', texto: 'Olá' })

    expect(r.providerMessageId).toBe('MSG123')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://evolution:8080/message/sendText/clinica')
    expect((init as RequestInit).headers).toMatchObject({ apikey: 'k' })
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      number: '5511987654321', text: 'Olá',
    })
  })

  it('trata 400 como erro permanente', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => 'numero invalido',
    })
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    await expect(client.enviarTexto({ telefone: '+55119', texto: 'x' }))
      .rejects.toMatchObject({ permanente: true })
  })

  it('trata 500 como erro temporário', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'indisponivel',
    })
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    await expect(client.enviarTexto({ telefone: '+5511987654321', texto: 'x' }))
      .rejects.toMatchObject({ permanente: false })
  })

  it('erro de rede é temporário', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const client = criarEvolutionClient(config, fetchMock as unknown as typeof fetch)

    const erro = await client.enviarTexto({ telefone: '+5511987654321', texto: 'x' })
      .catch((e) => e)
    expect(erro).toBeInstanceOf(ErroDeEnvio)
    expect(erro.permanente).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/integrations/evolution.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar o cliente da Evolution**

```ts
import { serverEnv } from '@/lib/env'

export class ErroDeEnvio extends Error {
  /** true quando repetir não vai adiantar (número inválido, texto recusado). */
  readonly permanente: boolean
  constructor(mensagem: string, permanente: boolean) {
    super(mensagem)
    this.name = 'ErroDeEnvio'
    this.permanente = permanente
  }
}

export type ConfigEvolution = { url: string; apiKey: string; instancia: string }

export function criarEvolutionClient(
  config?: ConfigEvolution,
  fetchImpl: typeof fetch = fetch,
) {
  const cfg = config ?? (() => {
    const env = serverEnv()
    return { url: env.EVOLUTION_URL, apiKey: env.EVOLUTION_API_KEY, instancia: env.EVOLUTION_INSTANCE }
  })()

  return {
    async enviarTexto({ telefone, texto }: { telefone: string; texto: string }) {
      const endpoint = `${cfg.url}/message/sendText/${cfg.instancia}`
      let resposta: Response
      try {
        resposta = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey },
          body: JSON.stringify({ number: telefone.replace(/^\+/, ''), text: texto }),
        })
      } catch (causa) {
        throw new ErroDeEnvio(`Falha de rede ao chamar a Evolution: ${String(causa)}`, false)
      }

      if (!resposta.ok) {
        const corpo = await resposta.text()
        // 4xx: a requisição está errada, repetir não resolve. 5xx: vale tentar de novo.
        const permanente = resposta.status >= 400 && resposta.status < 500
        throw new ErroDeEnvio(`Evolution respondeu ${resposta.status}: ${corpo}`, permanente)
      }

      const dados = (await resposta.json()) as { key?: { id?: string } }
      return { providerMessageId: dados.key?.id ?? '' }
    },
  }
}

export type EvolutionClient = ReturnType<typeof criarEvolutionClient>
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/integrations/evolution.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Implementar o cliente de e-mail**

`app/src/integrations/email/resend.ts`, com a mesma forma e a mesma classificação de erro:

```ts
import { serverEnv } from '@/lib/env'
import { ErroDeEnvio } from '@/integrations/evolution/client'

export type ConfigEmail = { apiKey: string; remetente: string }

export function criarEmailClient(config?: ConfigEmail, fetchImpl: typeof fetch = fetch) {
  const cfg = config ?? (() => {
    const env = serverEnv()
    return { apiKey: env.RESEND_API_KEY, remetente: env.EMAIL_FROM }
  })()

  return {
    async enviar({ para, assunto, html }: { para: string; assunto: string; html: string }) {
      let resposta: Response
      try {
        resposta = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({ from: cfg.remetente, to: [para], subject: assunto, html }),
        })
      } catch (causa) {
        throw new ErroDeEnvio(`Falha de rede ao chamar o Resend: ${String(causa)}`, false)
      }

      if (!resposta.ok) {
        const corpo = await resposta.text()
        const permanente = resposta.status >= 400 && resposta.status < 500
        throw new ErroDeEnvio(`Resend respondeu ${resposta.status}: ${corpo}`, permanente)
      }

      const dados = (await resposta.json()) as { id?: string }
      return { providerMessageId: dados.id ?? '' }
    },
  }
}

export type EmailClient = ReturnType<typeof criarEmailClient>
```

- [ ] **Step 6: Commit**

```bash
git add app/src/integrations app/tests/integrations
git commit -m "feat: adaptadores da Evolution API e do Resend com erro classificado"
```

---

### Task 11: Worker de despacho

**Files:**
- Create: `app/worker/dispatch.ts`, `app/worker/index.ts`
- Modify: `app/package.json` (script `worker`)
- Test: `app/tests/worker/dispatch.test.ts`

**Interfaces:**
- Consumes: `aplicarJanelaDeSilencio`, `renderizarTemplate`, `EvolutionClient`, `EmailClient`, `ErroDeEnvio`
- Produces: `despacharPendentes(deps: Deps, agora: Date): Promise<Resumo>` onde `Deps = { buscarPendentes(agora: Date): Promise<JobPendente[]>; marcarEnviado(id, providerMessageId): Promise<void>; marcarFalha(id, erro, permanente): Promise<void>; reagendar(id, novoMomento): Promise<void>; whatsapp: EvolutionClient; email: EmailClient }` e `Resumo = { enviados: number; falhas: number; reagendados: number }`. `JobPendente = { id: string; kind: ReminderKind; channel: Canal; telefone: string | null; email: string | null; assunto: string | null; corpo: string; tentativas: number }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/tests/worker/dispatch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { despacharPendentes, MAX_TENTATIVAS } from '@/../worker/dispatch'
import { ErroDeEnvio } from '@/integrations/evolution/client'

const jobBase = {
  id: 'j1', kind: 'confirmacao' as const, channel: 'whatsapp' as const,
  telefone: '+5511987654321', email: null, assunto: null,
  corpo: 'Olá, Maria!', tentativas: 0,
}

function montarDeps(overrides: Partial<Parameters<typeof despacharPendentes>[0]> = {}) {
  return {
    buscarPendentes: vi.fn().mockResolvedValue([jobBase]),
    marcarEnviado: vi.fn().mockResolvedValue(undefined),
    marcarFalha: vi.fn().mockResolvedValue(undefined),
    reagendar: vi.fn().mockResolvedValue(undefined),
    whatsapp: { enviarTexto: vi.fn().mockResolvedValue({ providerMessageId: 'M1' }) },
    email: { enviar: vi.fn().mockResolvedValue({ providerMessageId: 'E1' }) },
    ...overrides,
  }
}

// 14h em São Paulo — fora da janela de silêncio.
const horarioLivre = new Date('2026-08-20T17:00:00Z')
// 23h em São Paulo — dentro da janela de silêncio.
const horarioSilencio = new Date('2026-08-21T02:00:00Z')

describe('despacharPendentes', () => {
  it('envia pelo WhatsApp e marca como enviado', async () => {
    const deps = montarDeps()
    const resumo = await despacharPendentes(deps, horarioLivre)

    expect(deps.whatsapp.enviarTexto).toHaveBeenCalledWith({
      telefone: '+5511987654321', texto: 'Olá, Maria!',
    })
    expect(deps.marcarEnviado).toHaveBeenCalledWith('j1', 'M1')
    expect(resumo.enviados).toBe(1)
  })

  it('não envia nada dentro da janela de silêncio e reagenda', async () => {
    const deps = montarDeps()
    const resumo = await despacharPendentes(deps, horarioSilencio)

    expect(deps.whatsapp.enviarTexto).not.toHaveBeenCalled()
    expect(deps.reagendar).toHaveBeenCalledOnce()
    expect(resumo.reagendados).toBe(1)
  })

  it('erro permanente marca falha sem nova tentativa', async () => {
    const deps = montarDeps({
      whatsapp: { enviarTexto: vi.fn().mockRejectedValue(new ErroDeEnvio('numero invalido', true)) },
    })
    await despacharPendentes(deps, horarioLivre)
    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', expect.stringContaining('numero invalido'), true)
  })

  it('erro temporário mantém o job pendente para nova tentativa', async () => {
    const deps = montarDeps({
      whatsapp: { enviarTexto: vi.fn().mockRejectedValue(new ErroDeEnvio('502', false)) },
    })
    await despacharPendentes(deps, horarioLivre)
    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', expect.stringContaining('502'), false)
  })

  it('desiste depois do limite de tentativas', async () => {
    const deps = montarDeps({
      buscarPendentes: vi.fn().mockResolvedValue([{ ...jobBase, tentativas: MAX_TENTATIVAS }]),
      whatsapp: { enviarTexto: vi.fn().mockRejectedValue(new ErroDeEnvio('502', false)) },
    })
    await despacharPendentes(deps, horarioLivre)
    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', expect.any(String), true)
  })

  it('job de e-mail sem endereço falha permanentemente', async () => {
    const deps = montarDeps({
      buscarPendentes: vi.fn().mockResolvedValue([
        { ...jobBase, channel: 'email' as const, email: null, assunto: 'Oi' },
      ]),
    })
    await despacharPendentes(deps, horarioLivre)
    expect(deps.email.enviar).not.toHaveBeenCalled()
    expect(deps.marcarFalha).toHaveBeenCalledWith('j1', expect.stringContaining('sem e-mail'), true)
  })

  it('uma falha não impede o envio dos outros jobs', async () => {
    const deps = montarDeps({
      buscarPendentes: vi.fn().mockResolvedValue([
        { ...jobBase, id: 'j1' }, { ...jobBase, id: 'j2' },
      ]),
      whatsapp: {
        enviarTexto: vi.fn()
          .mockRejectedValueOnce(new ErroDeEnvio('502', false))
          .mockResolvedValueOnce({ providerMessageId: 'M2' }),
      },
    })
    const resumo = await despacharPendentes(deps, horarioLivre)
    expect(resumo.enviados).toBe(1)
    expect(resumo.falhas).toBe(1)
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/worker/dispatch.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar `worker/dispatch.ts`**

```ts
import { aplicarJanelaDeSilencio } from '@/domain/reminders/quiet-hours'
import { ErroDeEnvio } from '@/integrations/evolution/client'
import type { Canal, ReminderKind } from '@/domain/reminders/plan-reminders'

export const MAX_TENTATIVAS = 3

export type JobPendente = {
  id: string
  kind: ReminderKind
  channel: Canal
  telefone: string | null
  email: string | null
  assunto: string | null
  corpo: string
  tentativas: number
}

export type Deps = {
  buscarPendentes(agora: Date): Promise<JobPendente[]>
  marcarEnviado(id: string, providerMessageId: string): Promise<void>
  marcarFalha(id: string, erro: string, definitiva: boolean): Promise<void>
  reagendar(id: string, novoMomento: Date): Promise<void>
  whatsapp: { enviarTexto(a: { telefone: string; texto: string }): Promise<{ providerMessageId: string }> }
  email: { enviar(a: { para: string; assunto: string; html: string }): Promise<{ providerMessageId: string }> }
}

export type Resumo = { enviados: number; falhas: number; reagendados: number }

export async function despacharPendentes(deps: Deps, agora: Date): Promise<Resumo> {
  const resumo: Resumo = { enviados: 0, falhas: 0, reagendados: 0 }
  const pendentes = await deps.buscarPendentes(agora)

  const permitido = aplicarJanelaDeSilencio(agora)
  const emSilencio = permitido.getTime() !== agora.getTime()

  for (const job of pendentes) {
    if (emSilencio) {
      await deps.reagendar(job.id, permitido)
      resumo.reagendados += 1
      continue
    }

    try {
      if (job.channel === 'whatsapp') {
        if (!job.telefone) throw new ErroDeEnvio('Paciente sem telefone cadastrado', true)
        const r = await deps.whatsapp.enviarTexto({ telefone: job.telefone, texto: job.corpo })
        await deps.marcarEnviado(job.id, r.providerMessageId)
      } else {
        if (!job.email) throw new ErroDeEnvio('Paciente sem e-mail cadastrado', true)
        const r = await deps.email.enviar({
          para: job.email,
          assunto: job.assunto ?? 'Clínica Dra. Izadora Barros',
          html: `<p>${job.corpo.replace(/\n/g, '<br>')}</p>`,
        })
        await deps.marcarEnviado(job.id, r.providerMessageId)
      }
      resumo.enviados += 1
    } catch (causa) {
      const permanente = causa instanceof ErroDeEnvio ? causa.permanente : false
      const esgotou = job.tentativas >= MAX_TENTATIVAS
      await deps.marcarFalha(job.id, String((causa as Error).message), permanente || esgotou)
      resumo.falhas += 1
    }
  }

  return resumo
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/worker/dispatch.test.ts`
Expected: PASS — 7 testes

- [ ] **Step 5: Implementar `worker/index.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { criarEvolutionClient } from '@/integrations/evolution/client'
import { criarEmailClient } from '@/integrations/email/resend'
import { renderizarTemplate } from '@/domain/reminders/template'
import { despacharPendentes, type Deps, type JobPendente } from './dispatch'

const INTERVALO_MS = 5 * 60 * 1000
const supabase = createAdminClient()

function montarDeps(): Deps {
  return {
    async buscarPendentes(agora) {
      const { data, error } = await supabase
        .from('reminder_jobs')
        .select(`id, kind, channel, tentativas,
                 patients ( nome_completo, como_prefere_ser_chamado, telefone, email ),
                 appointments ( inicio, procedures ( nome ) )`)
        .eq('status', 'pendente')
        .lte('agendado_para', agora.toISOString())
        .order('agendado_para')
        .limit(50)

      if (error) throw new Error(`Falha ao ler a fila: ${error.message}`)

      const { data: templates } = await supabase
        .from('message_templates').select('kind, channel, assunto, corpo').eq('ativo', true)

      return (data ?? []).map((linha): JobPendente => {
        const paciente = linha.patients as unknown as {
          nome_completo: string; como_prefere_ser_chamado: string | null
          telefone: string | null; email: string | null
        }
        const consulta = linha.appointments as unknown as
          { inicio: string; procedures: { nome: string } } | null

        const template = (templates ?? []).find(
          (t) => t.kind === linha.kind && t.channel === linha.channel,
        )

        const inicio = consulta ? new Date(consulta.inicio) : null
        const variaveis = {
          nome: paciente.como_prefere_ser_chamado ?? paciente.nome_completo.split(' ')[0],
          data: inicio?.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) ?? '',
          hora: inicio?.toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
          }) ?? '',
          procedimento: consulta?.procedures?.nome ?? 'procedimento',
          data_retorno: '',
        }

        return {
          id: linha.id,
          kind: linha.kind,
          channel: linha.channel,
          telefone: paciente.telefone,
          email: paciente.email,
          assunto: template ? renderizarTemplate(template.assunto ?? '', variaveis) : null,
          corpo: template ? renderizarTemplate(template.corpo, variaveis) : '',
          tentativas: linha.tentativas,
        }
      })
    },

    async marcarEnviado(id, providerMessageId) {
      await supabase.from('reminder_jobs')
        .update({ status: 'enviado', enviado_em: new Date().toISOString(), provider_message_id: providerMessageId })
        .eq('id', id)
    },

    async marcarFalha(id, erro, definitiva) {
      const { data } = await supabase.from('reminder_jobs')
        .select('tentativas').eq('id', id).single()
      await supabase.from('reminder_jobs')
        .update({
          status: definitiva ? 'falhou' : 'pendente',
          erro,
          tentativas: (data?.tentativas ?? 0) + 1,
        })
        .eq('id', id)
    },

    async reagendar(id, novoMomento) {
      await supabase.from('reminder_jobs')
        .update({ agendado_para: novoMomento.toISOString() }).eq('id', id)
    },

    whatsapp: criarEvolutionClient(),
    email: criarEmailClient(),
  }
}

async function rodarCiclo() {
  try {
    const resumo = await despacharPendentes(montarDeps(), new Date())
    if (resumo.enviados || resumo.falhas || resumo.reagendados) {
      console.log('[lembretes]', JSON.stringify(resumo))
    }
  } catch (causa) {
    console.error('[lembretes] ciclo falhou:', causa)
  }
}

console.log('[lembretes] worker iniciado, ciclo a cada 5 minutos')
void rodarCiclo()
setInterval(() => void rodarCiclo(), INTERVALO_MS)
```

Adicionar em `app/package.json`: `"worker": "tsx worker/index.ts"` e `pnpm add -D tsx`. Registrar o alias `@` para o `tsx` via `tsconfig.json` (`"paths": { "@/*": ["./src/*"] }`) e `pnpm add -D tsconfig-paths`, rodando `tsx --tsconfig tsconfig.json worker/index.ts`.

- [ ] **Step 6: Verificar o worker de ponta a ponta**

Criar um agendamento para daqui a 3 horas pela interface, então rodar:

```bash
cd app && pnpm worker
```

Expected: o log imprime `[lembretes] {"enviados":1,...}` no primeiro ciclo e a linha correspondente em `reminder_jobs` passa a `status = 'enviado'` com `provider_message_id` preenchido. Rodar o worker uma segunda vez e confirmar que **nada é reenviado**.

- [ ] **Step 7: Commit**

```bash
git add app/worker app/tests/worker app/package.json
git commit -m "feat: worker de despacho de lembretes com retentativa e silencio noturno"
```

---

### Task 12: Sincronia opcional com Google Calendar

**Files:**
- Create: `app/src/integrations/google/calendar.ts`
- Create: `app/src/app/(app)/configuracoes/google/page.tsx`, `app/src/app/api/google/callback/route.ts`
- Create: `app/supabase/migrations/0009_google.sql`
- Test: `app/tests/integrations/google-calendar.test.ts`

**Interfaces:**
- Consumes: `appointments`, `exigirDra`
- Produces: tabela `google_credentials(user_id uuid PK, refresh_token text, calendar_id text, ativo bool)`; `montarEvento(consulta: ConsultaParaEvento): EventoGoogle` (função pura); `sincronizarConsulta(consultaId: string): Promise<void>`.

- [ ] **Step 1: Escrever o teste da função pura**

```ts
import { describe, expect, it } from 'vitest'
import { montarEvento } from '@/integrations/google/calendar'

describe('montarEvento', () => {
  it('monta o evento com título, horários e timezone de São Paulo', () => {
    const evento = montarEvento({
      pacienteNome: 'Maria Silva',
      procedimentoNome: 'Toxina botulínica',
      inicio: new Date('2026-08-20T17:00:00Z'),
      fim: new Date('2026-08-20T18:00:00Z'),
      observacoes: 'Primeira aplicação',
    })

    expect(evento.summary).toBe('Maria Silva — Toxina botulínica')
    expect(evento.description).toBe('Primeira aplicação')
    expect(evento.start).toEqual({ dateTime: '2026-08-20T17:00:00.000Z', timeZone: 'America/Sao_Paulo' })
    expect(evento.end).toEqual({ dateTime: '2026-08-20T18:00:00.000Z', timeZone: 'America/Sao_Paulo' })
  })

  it('omite a descrição quando não há observação', () => {
    const evento = montarEvento({
      pacienteNome: 'Ana', procedimentoNome: 'Avaliação',
      inicio: new Date('2026-08-20T17:00:00Z'), fim: new Date('2026-08-20T17:45:00Z'),
      observacoes: null,
    })
    expect(evento.description).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test tests/integrations/google-calendar.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar a função pura**

```ts
export type ConsultaParaEvento = {
  pacienteNome: string
  procedimentoNome: string
  inicio: Date
  fim: Date
  observacoes: string | null
}

export type EventoGoogle = {
  summary: string
  description?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

const TZ = 'America/Sao_Paulo'

export function montarEvento(consulta: ConsultaParaEvento): EventoGoogle {
  return {
    summary: `${consulta.pacienteNome} — ${consulta.procedimentoNome}`,
    ...(consulta.observacoes ? { description: consulta.observacoes } : {}),
    start: { dateTime: consulta.inicio.toISOString(), timeZone: TZ },
    end: { dateTime: consulta.fim.toISOString(), timeZone: TZ },
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test tests/integrations/google-calendar.test.ts`
Expected: PASS — 2 testes

- [ ] **Step 5: Escrever a migration de credenciais**

```sql
create table google_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  calendar_id text not null default 'primary',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table google_credentials enable row level security;

-- Cada usuário só enxerga a própria credencial. Ninguém lê a do outro.
create policy "credencial propria" on google_credentials
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 6: Implementar o fluxo OAuth e a sincronia**

Adicionar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` ao schema de `env.ts` como **opcionais** (`z.string().optional()`) — a sincronia é um recurso opcional e o sistema precisa subir sem ela.

`/configuracoes/google` mostra o estado da conexão e um botão "Conectar Google Agenda" que leva ao consentimento OAuth com escopo `https://www.googleapis.com/auth/calendar.events`. `/api/google/callback` troca o código pelo `refresh_token` e grava em `google_credentials`. `sincronizarConsulta` carrega a credencial da Dra., obtém um `access_token` pelo `refresh_token`, chama `POST /calendar/v3/calendars/{calendarId}/events` com o corpo de `montarEvento` e grava o id retornado em `appointments.google_event_id`. Quando não houver credencial ativa, a função retorna sem erro — a agenda interna continua funcionando normalmente.

Chamar `sincronizarConsulta` ao final de `agendarConsulta` (Task 7), dentro de um `try/catch` que apenas registra o erro no console: **falha no Google nunca pode derrubar o agendamento**.

- [ ] **Step 7: Commit**

```bash
git add app/src/integrations/google app/src/app/\(app\)/configuracoes/google app/src/app/api/google app/supabase/migrations/0009_google.sql app/tests/integrations/google-calendar.test.ts
git commit -m "feat: sincronia opcional de consultas com o Google Agenda"
```

---

### Task 13: Editor de mensagens e verificação final

**Files:**
- Create: `app/src/app/(app)/configuracoes/mensagens/page.tsx`, `acoes.ts`
- Create: `app/README.md`
- Test: `app/tests/db/templates.test.ts`

**Interfaces:**
- Consumes: `message_templates`, `renderizarTemplate`, `exigirDra`
- Produces: server action `salvarTemplate(entrada: { kind: ReminderKind; channel: Canal; assunto: string | null; corpo: string })`

- [ ] **Step 1: Escrever o teste de RLS dos templates**

```ts
it('secretária lê os templates', async () => {
  const { data, error } = await comoSecretaria.from('message_templates').select('kind, corpo')
  expect(error).toBeNull()
  expect(data!.length).toBe(7)
})

it('secretária não altera template', async () => {
  const { error } = await comoSecretaria.from('message_templates')
    .update({ corpo: 'alterado' }).eq('kind', 'confirmacao').eq('channel', 'whatsapp')
  expect(error).not.toBeNull()
})

it('dra altera template', async () => {
  const { error } = await comoDra.from('message_templates')
    .update({ corpo: 'Olá, {{nome}}!' }).eq('kind', 'confirmacao').eq('channel', 'whatsapp')
  expect(error).toBeNull()
})
```

- [ ] **Step 2: Rodar e confirmar**

Run: `pnpm test:db tests/db/templates.test.ts`
Expected: PASS — 3 testes

- [ ] **Step 3: Criar a página de edição de mensagens**

`/configuracoes/mensagens` lista os 7 templates agrupados por gatilho, cada um com `textarea` do corpo, campo de assunto quando o canal for e-mail, e uma prévia ao vivo renderizada com `renderizarTemplate` usando dados de exemplo (`nome: 'Maria'`, `data: '20/08/2026'`, `hora: '14:00'`, `procedimento: 'Toxina botulínica'`, `data_retorno: '18/12/2026'`). Abaixo do campo, listar as variáveis disponíveis. Somente a Dra. vê o botão de salvar.

- [ ] **Step 4: Rodar a suíte completa**

```bash
cd app
pnpm test
pnpm test:db
pnpm build
```

Expected: todos os testes passam e o build conclui sem erro de tipo. Se algo falhar, corrigir antes de seguir — não commitar suíte vermelha.

- [ ] **Step 5: Escrever o README de operação**

`app/README.md` documentando: variáveis de ambiente e onde obter cada uma; como subir o ambiente local (`pnpm supabase start`, `pnpm dev`, `pnpm worker`); como aplicar migrations em produção (`pnpm supabase db push`); como fazer o deploy na VPS (`docker compose -f docker/compose.yml up -d --build`); como criar o primeiro usuário `dra` (criar pelo painel do Supabase Auth e inserir a linha em `profiles` com `role = 'dra'`); e o aviso de que o backup automático do Supabase precisa estar ativo antes de qualquer dado real de paciente entrar no sistema.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/\(app\)/configuracoes/mensagens app/README.md app/tests/db/templates.test.ts
git commit -m "feat: editor de mensagens dos lembretes e documentacao de operacao"
```

---

## Cobertura do spec

| Requisito do spec (Fase 0 e 1) | Task |
|---|---|
| Docker Compose na VPS | 1 |
| Validação de segredos fora do browser | 1 |
| Schema, enums e migrations versionadas | 2, 5, 6, 7, 8, 9, 12 |
| Supabase Auth com e-mail e senha | 3 |
| RLS por papel; secretária lê mas não edita o clínico | 2, 5, 6, 8, 13 |
| `audit_log` append-only | 2, 6 |
| Design system claro e escuro | 4 |
| Catálogo de procedimentos com preço e duração | 5 |
| Funil de 7 estágios em kanban | 6 |
| Agenda com detecção de conflito | 7 |
| Sincronia opcional com Google Calendar | 12 |
| Retorno em 3 níveis (padrão, ajuste, sem retorno) | 8 |
| Fila de retorno com em dia / vencendo / vencido | 8 |
| Os 5 gatilhos de lembrete | 9 |
| Idempotência de envio | 9, 11 |
| Janela de silêncio 21h–08h | 9, 11 |
| Opt-out por paciente e por canal | 6, 9 |
| Envio pela Evolution e por e-mail | 10, 11 |
| Registro de tentativa, status e erro | 11 |
| Templates editáveis pela Dra. | 9, 13 |

Fora desta fase, conforme o spec: chat (Fase 2), prontuário, fotos e PDF (Fase 3), financeiro e impostos (Fase 4).
