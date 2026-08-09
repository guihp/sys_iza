-- 0017_clinic_settings.sql
-- Configuração da clínica em linha única: meta mensal de faturamento.
-- Idempotente: tabela com "if not exists", policies recriadas.
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

-- ---------------------------------------------------------------------------
-- clinic_settings — uma linha só (id = true)
-- ---------------------------------------------------------------------------

create table if not exists public.clinic_settings (
  -- Chave booleana travada em `true`: impede segunda linha sem constraint
  -- parcial nem trigger. Upsert sempre bate em `id = true`.
  id boolean primary key default true check (id),
  meta_mensal_centavos integer not null default 4500000
    check (meta_mensal_centavos >= 0),
  atualizado_em timestamptz not null default now()
);

comment on table public.clinic_settings is
  'Configuração da clínica (linha única). Hoje: meta mensal em centavos.';

comment on column public.clinic_settings.meta_mensal_centavos is
  'Alvo de faturamento do mês, em centavos. Alimenta o cartão da sidebar.';

insert into public.clinic_settings (id, meta_mensal_centavos)
values (true, 4500000)
on conflict (id) do nothing;

alter table public.clinic_settings enable row level security;

-- Equipe lê: a secretária enxerga o cartão da meta na lateral.
drop policy if exists "equipe le clinic_settings" on public.clinic_settings;
create policy "equipe le clinic_settings"
  on public.clinic_settings for select
  using (auth.uid() is not null);

-- Só a Dra. altera o alvo.
drop policy if exists "so a dra altera clinic_settings" on public.clinic_settings;
create policy "so a dra altera clinic_settings"
  on public.clinic_settings for all
  using (public.is_dra())
  with check (public.is_dra());
