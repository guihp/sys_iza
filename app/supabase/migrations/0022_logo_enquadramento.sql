-- 0022_logo_enquadramento.sql
-- Zoom ampliado + posição do recorte da logo (object-position).
-- AVISO: aplicar via MCP ou pelo dono. Nunca `supabase db push` pela IA.

alter table public.clinic_settings
  add column if not exists logo_pos_x numeric(5, 2) not null default 50.00,
  add column if not exists logo_pos_y numeric(5, 2) not null default 50.00;

alter table public.clinic_settings
  drop constraint if exists clinic_settings_logo_escala_ck;

alter table public.clinic_settings
  add constraint clinic_settings_logo_escala_ck
  check (logo_escala >= 0.50 and logo_escala <= 4.00);

alter table public.clinic_settings
  drop constraint if exists clinic_settings_logo_pos_x_ck;

alter table public.clinic_settings
  add constraint clinic_settings_logo_pos_x_ck
  check (logo_pos_x >= 0 and logo_pos_x <= 100);

alter table public.clinic_settings
  drop constraint if exists clinic_settings_logo_pos_y_ck;

alter table public.clinic_settings
  add constraint clinic_settings_logo_pos_y_ck
  check (logo_pos_y >= 0 and logo_pos_y <= 100);

comment on column public.clinic_settings.logo_escala is
  'Fator de zoom da logo (0.50–4.00). 1.00 = tamanho padrão.';

comment on column public.clinic_settings.logo_pos_x is
  'Foco horizontal do recorte (0=esquerda, 100=direita).';

comment on column public.clinic_settings.logo_pos_y is
  'Foco vertical do recorte (0=topo, 100=base).';
