-- 0019_push_subscriptions.sql
-- Subscriptions Web Push da equipe (dra + secretaria) por dispositivo.
-- Idempotente: tabela com "if not exists", policies recriadas.
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

-- ---------------------------------------------------------------------------
-- push_subscriptions — um endpoint por device/browser
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- URL do push service (Chrome/Firefox/Safari). Unique: o mesmo device
  -- re-inscrevendo faz upsert em vez de duplicar.
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

comment on table public.push_subscriptions is
  'Web Push da equipe interna. Pacientes não recebem push deste canal.';

comment on column public.push_subscriptions.endpoint is
  'URL do serviço de push do browser; chave natural do upsert.';

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Cada pessoa gerencia só as próprias subscriptions (ligar/desligar no device).
drop policy if exists "usuario gerencia a propria subscription" on public.push_subscriptions;
create policy "usuario gerencia a propria subscription"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Leitura para envio em massa fica no server com service role (bypass RLS).
-- Sem policy de SELECT ampla de propósito: a secretária não lista endpoints
-- da Dra. e vice-versa.
