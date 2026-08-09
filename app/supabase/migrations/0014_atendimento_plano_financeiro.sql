-- 0014_atendimento_plano_financeiro.sql
-- Atendimento ligado a um plano (toxina/preenchimento), linhas de execução
-- (planejado vs feito) e cobrança com entrada / próxima consulta / parcelas.
-- Idempotente: add column if not exists, create table if not exists,
-- constraints em bloco do $$ ... $$, policies com drop + create.
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

-- ---------------------------------------------------------------------------
-- attendance_records — vínculo ao plano + status de execução
-- ---------------------------------------------------------------------------

alter table public.attendance_records
  add column if not exists botox_plan_id uuid
    references public.botox_plans (id) on delete set null;

alter table public.attendance_records
  add column if not exists filler_plan_id uuid
    references public.filler_plans (id) on delete set null;

alter table public.attendance_records
  add column if not exists execucao_status text not null default 'nao_aplicavel';

comment on column public.attendance_records.botox_plan_id is
  'Plano de toxina que originou este atendimento (no máximo um plano).';
comment on column public.attendance_records.filler_plan_id is
  'Plano de preenchimento que originou este atendimento (no máximo um plano).';
comment on column public.attendance_records.execucao_status is
  'completo | parcial | nao_aplicavel (avulso sem plano).';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_um_plano_so'
  ) then
    alter table public.attendance_records add constraint attendance_um_plano_so
      check (
        not (botox_plan_id is not null and filler_plan_id is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'attendance_execucao_status_valido'
  ) then
    alter table public.attendance_records
      add constraint attendance_execucao_status_valido
      check (execucao_status in ('completo', 'parcial', 'nao_aplicavel'));
  end if;
end
$$;

create index if not exists attendance_botox_plan_idx
  on public.attendance_records (botox_plan_id)
  where botox_plan_id is not null;

create index if not exists attendance_filler_plan_idx
  on public.attendance_records (filler_plan_id)
  where filler_plan_id is not null;

-- ---------------------------------------------------------------------------
-- attendance_execution_items — snapshot planejado vs feito por linha
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_execution_items (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null
    references public.attendance_records (id) on delete cascade,

  ordem smallint not null default 0,
  rotulo text not null default '',
  unidade text not null,
  procedimento_id uuid references public.procedures (id) on delete set null,
  preco_centavos integer not null default 0,

  planejado_qtd numeric(8, 2) not null default 0,
  feito_qtd numeric(8, 2) not null default 0,
  planejado_centavos integer not null default 0,
  feito_centavos integer not null default 0,

  criado_em timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_exec_unidade_valida'
  ) then
    alter table public.attendance_execution_items
      add constraint attendance_exec_unidade_valida
      check (unidade in ('U', 'ml'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'attendance_exec_qtd_nao_negativa'
  ) then
    alter table public.attendance_execution_items
      add constraint attendance_exec_qtd_nao_negativa
      check (planejado_qtd >= 0 and feito_qtd >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'attendance_exec_centavos_nao_negativos'
  ) then
    alter table public.attendance_execution_items
      add constraint attendance_exec_centavos_nao_negativos
      check (
        preco_centavos >= 0
        and planejado_centavos >= 0
        and feito_centavos >= 0
      );
  end if;
end
$$;

create index if not exists attendance_execution_items_attendance_idx
  on public.attendance_execution_items (attendance_id, ordem);

-- ---------------------------------------------------------------------------
-- patient_charges — cobrança 1:1 com atendimento (quando houver)
-- ---------------------------------------------------------------------------

create table if not exists public.patient_charges (
  id uuid primary key default gen_random_uuid(),

  attendance_id uuid not null unique
    references public.attendance_records (id) on delete cascade,
  patient_id uuid not null
    references public.patients (id) on delete cascade,
  registrado_por uuid not null references auth.users (id),

  valor_total_centavos integer not null default 0,
  valor_entrada_centavos integer not null default 0,
  valor_proxima_consulta_centavos integer not null default 0,
  valor_parcelado_centavos integer not null default 0,
  parcelas_qtd integer not null default 1,

  juros_maquininha_centavos integer not null default 0,
  juros_repassados_ao_cliente boolean not null default false,

  forma_entrada text,
  status text not null default 'em_aberto',

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'patient_charges_valores_nao_negativos'
  ) then
    alter table public.patient_charges
      add constraint patient_charges_valores_nao_negativos
      check (
        valor_total_centavos >= 0
        and valor_entrada_centavos >= 0
        and valor_proxima_consulta_centavos >= 0
        and valor_parcelado_centavos >= 0
        and juros_maquininha_centavos >= 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'patient_charges_parcelas_qtd'
  ) then
    alter table public.patient_charges
      add constraint patient_charges_parcelas_qtd
      check (
        parcelas_qtd >= 1
        and (
          valor_parcelado_centavos = 0
          or valor_parcelado_centavos >= parcelas_qtd
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'patient_charges_forma_entrada'
  ) then
    alter table public.patient_charges
      add constraint patient_charges_forma_entrada
      check (
        forma_entrada is null
        or forma_entrada in ('pix', 'dinheiro', 'debito', 'credito', 'outro')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'patient_charges_status_valido'
  ) then
    alter table public.patient_charges
      add constraint patient_charges_status_valido
      check (status in ('em_aberto', 'parcial', 'quitado'));
  end if;

  -- Composição do recebimento = total clínico + juros se repassados (±1 centavo).
  if not exists (
    select 1 from pg_constraint where conname = 'patient_charges_composicao'
  ) then
    alter table public.patient_charges
      add constraint patient_charges_composicao
      check (
        abs(
          (valor_entrada_centavos + valor_proxima_consulta_centavos + valor_parcelado_centavos)
          - (
            valor_total_centavos
            + case when juros_repassados_ao_cliente then juros_maquininha_centavos else 0 end
          )
        ) <= 1
      );
  end if;
end
$$;

create index if not exists patient_charges_patient_idx
  on public.patient_charges (patient_id, criado_em desc);

create index if not exists patient_charges_status_idx
  on public.patient_charges (status);

drop trigger if exists patient_charges_atualizado_em on public.patient_charges;
create trigger patient_charges_atualizado_em
  before update on public.patient_charges
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- payment_installments — parcelas da cobrança
-- ---------------------------------------------------------------------------

create table if not exists public.payment_installments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null
    references public.patient_charges (id) on delete cascade,

  numero smallint not null,
  valor_centavos integer not null,
  vencimento date not null,
  pago_em timestamptz,
  status text not null default 'pendente',

  criado_em timestamptz not null default now(),

  unique (charge_id, numero)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payment_installments_numero_positivo'
  ) then
    alter table public.payment_installments
      add constraint payment_installments_numero_positivo
      check (numero >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payment_installments_valor_positivo'
  ) then
    alter table public.payment_installments
      add constraint payment_installments_valor_positivo
      check (valor_centavos > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payment_installments_status_valido'
  ) then
    alter table public.payment_installments
      add constraint payment_installments_status_valido
      check (status in ('pendente', 'pago', 'atrasado'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payment_installments_pago_consistente'
  ) then
    alter table public.payment_installments
      add constraint payment_installments_pago_consistente
      check (
        (status = 'pago' and pago_em is not null)
        or (status <> 'pago' and pago_em is null)
      );
  end if;
end
$$;

create index if not exists payment_installments_charge_idx
  on public.payment_installments (charge_id, numero);

create index if not exists payment_installments_vencimento_idx
  on public.payment_installments (vencimento)
  where status <> 'pago';

-- ---------------------------------------------------------------------------
-- RLS — SELECT equipe; escrita só Dra. (padrão 0006 / 0011)
-- ---------------------------------------------------------------------------

alter table public.attendance_execution_items enable row level security;
revoke all on public.attendance_execution_items from anon;

drop policy if exists "equipe le itens execucao" on public.attendance_execution_items;
create policy "equipe le itens execucao"
  on public.attendance_execution_items for select using (auth.uid() is not null);

drop policy if exists "so a dra cria item execucao" on public.attendance_execution_items;
create policy "so a dra cria item execucao"
  on public.attendance_execution_items for insert with check (public.is_dra());

drop policy if exists "so a dra edita item execucao" on public.attendance_execution_items;
create policy "so a dra edita item execucao"
  on public.attendance_execution_items for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga item execucao" on public.attendance_execution_items;
create policy "so a dra apaga item execucao"
  on public.attendance_execution_items for delete using (public.is_dra());

-- patient_charges
alter table public.patient_charges enable row level security;
revoke all on public.patient_charges from anon;

drop policy if exists "equipe le cobrancas" on public.patient_charges;
create policy "equipe le cobrancas"
  on public.patient_charges for select using (auth.uid() is not null);

drop policy if exists "so a dra cria cobranca" on public.patient_charges;
create policy "so a dra cria cobranca"
  on public.patient_charges for insert
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita cobranca" on public.patient_charges;
create policy "so a dra edita cobranca"
  on public.patient_charges for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga cobranca" on public.patient_charges;
create policy "so a dra apaga cobranca"
  on public.patient_charges for delete using (public.is_dra());

-- payment_installments
alter table public.payment_installments enable row level security;
revoke all on public.payment_installments from anon;

drop policy if exists "equipe le parcelas" on public.payment_installments;
create policy "equipe le parcelas"
  on public.payment_installments for select using (auth.uid() is not null);

drop policy if exists "so a dra cria parcela" on public.payment_installments;
create policy "so a dra cria parcela"
  on public.payment_installments for insert with check (public.is_dra());

drop policy if exists "so a dra edita parcela" on public.payment_installments;
create policy "so a dra edita parcela"
  on public.payment_installments for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga parcela" on public.payment_installments;
create policy "so a dra apaga parcela"
  on public.payment_installments for delete using (public.is_dra());
