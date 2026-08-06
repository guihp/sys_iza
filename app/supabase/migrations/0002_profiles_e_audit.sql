-- 0002_profiles_e_audit.sql
-- Perfis da equipe (papel dra/secretaria) e log de auditoria append-only.
-- Idempotente: tabelas com "if not exists", funções com "create or replace",
-- policies recriadas com "drop policy if exists" antes do "create policy".

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  role public.user_role not null default 'secretaria',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Definidas como security definer para não recursar na RLS de profiles:
-- a policy de profiles chama is_dra(), que por sua vez lê profiles.
create or replace function public.current_role_of() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_dra() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_of() = 'dra', false)
$$;

-- Toda a equipe autenticada enxerga os perfis (para exibir nomes na UI).
drop policy if exists "perfil proprio e da equipe visivel" on public.profiles;
create policy "perfil proprio e da equipe visivel"
  on public.profiles for select using (auth.uid() is not null);

-- Escrita em profiles é exclusiva da Dra. — a secretária não consegue
-- alterar o próprio papel nem o de ninguém.
drop policy if exists "so a dra altera perfis" on public.profiles;
create policy "so a dra altera perfis"
  on public.profiles for all using (public.is_dra()) with check (public.is_dra());

-- ---------------------------------------------------------------------------
-- audit_log — APPEND-ONLY
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  ator uuid references auth.users(id),
  acao text not null,
  entidade text not null,
  registro_id text,
  ip inet,
  criado_em timestamptz not null default now()
);

alter table public.audit_log enable row level security;

drop policy if exists "so a dra le a auditoria" on public.audit_log;
create policy "so a dra le a auditoria"
  on public.audit_log for select using (public.is_dra());

drop policy if exists "qualquer usuario autenticado registra" on public.audit_log;
create policy "qualquer usuario autenticado registra"
  on public.audit_log for insert with check (auth.uid() is not null);

-- Append-only, garantido em duas camadas:
--   1) RLS: existem APENAS as policies de select e insert acima. Nenhuma policy
--      de update ou de delete é criada para ninguém, nem para a Dra. Com RLS
--      habilitada, comando sem policy permissiva correspondente não afeta linha
--      alguma.
--   2) Privilégio: os grants padrão do Supabase em public são removidos para
--      update, delete e truncate, então nem por engano um client autenticado
--      consegue adulterar ou apagar um registro — o Postgres nega antes da RLS.
--      Truncate entra na lista porque ignora a RLS por completo.
-- Se alguma migration futura precisar mexer aqui, isso é um sinal de erro:
-- auditoria não se corrige, se complementa com um novo registro.
revoke update, delete, truncate on public.audit_log from anon, authenticated;

create index if not exists audit_log_entidade_idx
  on public.audit_log (entidade, registro_id, criado_em desc);
