-- 0012_procedimento_interesse.sql
-- Procedimento de interesse do lead (catálogo → preço no funil).
-- Nullable: lead sem procedimento escolhido continua "A definir".
-- Idempotente: `add column if not exists` + índice condicional.
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

alter table public.patients
  add column if not exists procedimento_interesse_id uuid
    references public.procedures (id) on delete set null;

-- Funil e filtros por procedimento de interesse.
create index if not exists patients_procedimento_interesse_idx
  on public.patients (procedimento_interesse_id)
  where procedimento_interesse_id is not null;

comment on column public.patients.procedimento_interesse_id is
  'Procedimento desejado no funil (catálogo). Preço alimenta potencial da coluna.';
