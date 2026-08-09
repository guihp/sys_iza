-- 0018_clinic_meta_mensal.sql
-- Meta de faturamento por mês (histórico). O valor global em
-- clinic_settings.meta_mensal_centavos continua como fallback / espelho do mês
-- corrente para o cartão da sidebar.
-- Idempotente: tabela com "if not exists", policies recriadas.
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

-- ---------------------------------------------------------------------------
-- clinic_meta_mensal — uma linha por YYYY-MM
-- ---------------------------------------------------------------------------

create table if not exists public.clinic_meta_mensal (
  -- Calendário da clínica em texto `YYYY-MM` (ex.: 2026-08). Sem dia: a meta
  -- é do mês inteiro, não de uma data.
  ano_mes text primary key
    check (ano_mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  meta_centavos integer not null
    check (meta_centavos >= 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);

comment on table public.clinic_meta_mensal is
  'Meta de faturamento por mês (YYYY-MM). Alimenta histórico e o cartão da sidebar.';

comment on column public.clinic_meta_mensal.ano_mes is
  'Mês no calendário da clínica, formato YYYY-MM.';

comment on column public.clinic_meta_mensal.meta_centavos is
  'Alvo de faturamento daquele mês, em centavos.';

create index if not exists clinic_meta_mensal_atualizado_em_idx
  on public.clinic_meta_mensal (atualizado_em desc);

alter table public.clinic_meta_mensal enable row level security;

-- Equipe lê: a secretária enxerga o cartão (meta do mês corrente) na lateral.
drop policy if exists "equipe le clinic_meta_mensal" on public.clinic_meta_mensal;
create policy "equipe le clinic_meta_mensal"
  on public.clinic_meta_mensal for select
  using (auth.uid() is not null);

-- Só a Dra. define / altera metas.
drop policy if exists "so a dra altera clinic_meta_mensal" on public.clinic_meta_mensal;
create policy "so a dra altera clinic_meta_mensal"
  on public.clinic_meta_mensal for all
  using (public.is_dra())
  with check (public.is_dra());

-- Semente: mês corrente (fuso da clínica) herda o valor global já configurado,
-- se ainda não houver linha. Assim o histórico começa com o mês de hoje.
insert into public.clinic_meta_mensal (ano_mes, meta_centavos)
select
  to_char((now() at time zone 'America/Sao_Paulo'), 'YYYY-MM'),
  s.meta_mensal_centavos
from public.clinic_settings s
where s.id = true
on conflict (ano_mes) do nothing;
