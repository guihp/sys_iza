-- 0021_logo_escala.sql
-- Zoom da logo de identidade (login + sidebar + ícone do app).
-- AVISO: aplicar via MCP ou pelo dono. Nunca `supabase db push` pela IA.

alter table public.clinic_settings
  add column if not exists logo_escala numeric(4, 2) not null default 1.00;

alter table public.clinic_settings
  drop constraint if exists clinic_settings_logo_escala_ck;

alter table public.clinic_settings
  add constraint clinic_settings_logo_escala_ck
  check (logo_escala >= 0.50 and logo_escala <= 2.50);

comment on column public.clinic_settings.logo_escala is
  'Fator de zoom da logo (0.50–2.50). 1.00 = tamanho padrão.';
