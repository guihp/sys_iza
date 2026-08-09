-- 0013_planos_anotacao.sql
-- Planos clínicos: data do plano, anotação (JSON dos traços) e vínculo
-- ao catálogo para calculadora R$/U (toxina) e R$/mL (preenchimento).
-- Idempotente: `add column if not exists` + índices condicionais.
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

-- ---------------------------------------------------------------------------
-- botox_plans
-- ---------------------------------------------------------------------------

alter table public.botox_plans
  add column if not exists realizado_em date not null default (current_date);

alter table public.botox_plans
  add column if not exists anotacao_json jsonb;

comment on column public.botox_plans.realizado_em is
  'Data do plano (diferenciador na galeria). Default: dia corrente.';
comment on column public.botox_plans.anotacao_json is
  'Traços da anotação sobre a capa (JSON serializado pelo canvas).';

create index if not exists botox_plans_patient_realizado_idx
  on public.botox_plans (patient_id, realizado_em desc, criado_em desc);

-- ---------------------------------------------------------------------------
-- botox_plan_items — procedimento do catálogo (R$/U)
-- ---------------------------------------------------------------------------

alter table public.botox_plan_items
  add column if not exists procedimento_id uuid
    references public.procedures (id) on delete set null;

comment on column public.botox_plan_items.procedimento_id is
  'Procedimento do catálogo cujo preco_centavos é R$ por unidade.';

create index if not exists botox_plan_items_procedimento_idx
  on public.botox_plan_items (procedimento_id)
  where procedimento_id is not null;

-- ---------------------------------------------------------------------------
-- filler_plans
-- ---------------------------------------------------------------------------

alter table public.filler_plans
  add column if not exists realizado_em date not null default (current_date);

alter table public.filler_plans
  add column if not exists anotacao_json jsonb;

comment on column public.filler_plans.realizado_em is
  'Data do plano (diferenciador na galeria). Default: dia corrente.';
comment on column public.filler_plans.anotacao_json is
  'Traços da anotação sobre a capa (JSON serializado pelo canvas).';

create index if not exists filler_plans_patient_realizado_idx
  on public.filler_plans (patient_id, realizado_em desc, criado_em desc);

-- ---------------------------------------------------------------------------
-- filler_plan_items — procedimento do catálogo (R$/mL)
-- ---------------------------------------------------------------------------

alter table public.filler_plan_items
  add column if not exists procedimento_id uuid
    references public.procedures (id) on delete set null;

comment on column public.filler_plan_items.procedimento_id is
  'Procedimento do catálogo cujo preco_centavos é R$ por mL.';

create index if not exists filler_plan_items_procedimento_idx
  on public.filler_plan_items (procedimento_id)
  where procedimento_id is not null;
