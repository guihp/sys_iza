-- 0020_api_key_clinic_settings.sql
-- Chave da API HTTP gerada no painel: só hash + prefixo (nunca plaintext).
-- Auth aceita esta chave OU API_KEY / AGENDA_API_KEY no env (fallback Coolify).
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

alter table public.clinic_settings
  add column if not exists api_key_hash text,
  add column if not exists api_key_prefix text,
  add column if not exists api_key_criado_em timestamptz;

comment on column public.clinic_settings.api_key_hash is
  'SHA-256 hex da chave da API HTTP. Plaintext nunca é persistido.';

comment on column public.clinic_settings.api_key_prefix is
  'Primeiros caracteres da chave (exibição no painel). Não autentica sozinho.';

comment on column public.clinic_settings.api_key_criado_em is
  'Quando a chave do banco foi gerada ou rotacionada pela última vez.';
