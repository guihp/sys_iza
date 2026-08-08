-- 0011_prontuario_clinico.sql
-- Completa o prontuário digital: anamnese (págs. 1–2 do PDF), avaliação de
-- pele + exame físico (pág. 3), planos de toxina e preenchimento (págs. 4–5),
-- pasta de fotos/arquivos, e os campos que faltavam em attendance_records
-- (produto, lote, termo assinado em papel).
--
-- Idempotente: tabelas/índices com "if not exists", enums em bloco condicional,
-- constraints em "do $$" checando pg_constraint, policies recriadas com
-- "drop policy if exists".
--
-- Escopo clínico: SELECT para a equipe; escrita exclusiva da Dra. (mesmo
-- padrão da 0006). Cadastro (`patients`) continua editável pela secretária.
--
-- NÃO aplicar automaticamente — o dono roda `pnpm supabase db push`.

-- ---------------------------------------------------------------------------
-- Enums fechados do PDF (não jsonb opaco)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'sono_qualidade' and n.nspname = 'public'
  ) then
    create type public.sono_qualidade as enum ('bom', 'regular', 'ruim');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'pele_declarada' and n.nspname = 'public'
  ) then
    create type public.pele_declarada as enum ('seca', 'oleosa', 'mista', 'sensivel');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'gestacao_amamentacao' and n.nspname = 'public'
  ) then
    create type public.gestacao_amamentacao as enum ('nao', 'gestante', 'amamentando');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'biotipo_pele' and n.nspname = 'public'
  ) then
    create type public.biotipo_pele as enum ('normal', 'seca', 'oleosa', 'mista');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'hidratacao_pele' and n.nspname = 'public'
  ) then
    create type public.hidratacao_pele as enum ('adequada', 'desidratada');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'espessura_pele' and n.nspname = 'public'
  ) then
    create type public.espessura_pele as enum ('fina', 'normal', 'espessa');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'fototipo_fitzpatrick' and n.nspname = 'public'
  ) then
    create type public.fototipo_fitzpatrick as enum ('I', 'II', 'III', 'IV', 'V', 'VI');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'cor_pele' and n.nspname = 'public'
  ) then
    create type public.cor_pele as enum ('branca', 'parda', 'preta');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'grau_acne' and n.nspname = 'public'
  ) then
    create type public.grau_acne as enum ('ausente', 'I', 'II', 'III');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'glogau' and n.nspname = 'public'
  ) then
    create type public.glogau as enum ('leve', 'moderado', 'avancado', 'severo');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'marcha' and n.nspname = 'public'
  ) then
    create type public.marcha as enum ('normal', 'dificuldade', 'cadeirante');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'angulo_foto' and n.nspname = 'public'
  ) then
    create type public.angulo_foto as enum (
      'frontal', 'perfil_direito', 'perfil_esquerdo', 'obliquo', 'detalhe'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- attendance_records — campos que faltavam da pág. 6
-- ---------------------------------------------------------------------------

alter table public.attendance_records
  add column if not exists produto text;

alter table public.attendance_records
  add column if not exists lote text;

alter table public.attendance_records
  add column if not exists termo_assinado boolean not null default false;

-- ---------------------------------------------------------------------------
-- anamneses — págs. 1–2 (uma ficha ativa por paciente)
-- ---------------------------------------------------------------------------

create table if not exists public.anamneses (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,

  -- Página 1 — queixa e procedimentos prévios
  queixa_principal text,
  autoconfianca_rosto smallint,
  incomodo_rosto text,
  rosto_cansado boolean,

  prev_botox boolean not null default false,
  prev_acido_hialuronico boolean not null default false,
  prev_bioestimulador boolean not null default false,
  prev_fios boolean not null default false,
  prev_pmma boolean not null default false,
  prev_cirurgia boolean not null default false,
  prev_outros boolean not null default false,
  prev_outros_texto text,
  ultimo_procedimento text,
  ultimo_procedimento_regiao text,

  tratamento_medico_atual text,
  medicacao_continua text,
  alergias text,

  -- Página 2 — doenças
  doenca_diabetes boolean not null default false,
  doenca_hipertensao boolean not null default false,
  doenca_cardiaca boolean not null default false,
  doenca_autoimune boolean not null default false,
  doenca_tireoide boolean not null default false,
  doenca_hepatica boolean not null default false,
  doenca_renal boolean not null default false,
  doenca_coagulacao boolean not null default false,
  doenca_osteoporose boolean not null default false,
  doenca_asma_bronquite boolean not null default false,
  doenca_epilepsia boolean not null default false,
  doenca_cancer boolean not null default false,
  doenca_outra boolean not null default false,
  doenca_outra_texto text,

  gestacao_amamentacao public.gestacao_amamentacao,
  fuma boolean,
  alcool_frequente boolean,
  ingere_agua text,
  exercicios_fisicos text,
  boa_alimentacao text,
  sono public.sono_qualidade,
  pele_declarada public.pele_declarada,

  incomoda_flacidez boolean not null default false,
  incomoda_linhas boolean not null default false,
  incomoda_manchas boolean not null default false,
  incomoda_poros boolean not null default false,
  incomoda_falta_vico boolean not null default false,
  incomoda_outro boolean not null default false,
  incomoda_outro_texto text,

  protetor_solar_diario boolean,
  acidos_cosmeticos text,
  roacutan_retinoides boolean,
  reacao_cosmeticos_procedimentos boolean,
  reacao_detalhe text,
  medico_assistente_nome text,
  medico_assistente_telefone text,

  registrado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (patient_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'anamneses_autoconfianca_0_10'
  ) then
    alter table public.anamneses add constraint anamneses_autoconfianca_0_10
      check (
        autoconfianca_rosto is null
        or (autoconfianca_rosto >= 0 and autoconfianca_rosto <= 10)
      );
  end if;
end
$$;

drop trigger if exists anamneses_atualizado_em on public.anamneses;
create trigger anamneses_atualizado_em
  before update on public.anamneses
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- skin_assessments — pág. 3
-- ---------------------------------------------------------------------------

create table if not exists public.skin_assessments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,

  -- Pigmentação
  pig_melasma_manchas boolean not null default false,
  pig_hipopigmentacao boolean not null default false,
  pig_sardas boolean not null default false,

  -- Vasculares
  vas_eritema boolean not null default false,
  vas_telangiectasias boolean not null default false,
  vas_hematoma boolean not null default false,

  -- Lesões
  les_acne boolean not null default false,
  les_comedoes boolean not null default false,
  les_verrugas boolean not null default false,
  les_nodulos boolean not null default false,
  les_feridas_ulceras boolean not null default false,
  les_descamacao boolean not null default false,

  -- Cicatrizes
  cic_atrofica boolean not null default false,
  cic_hipertrofica boolean not null default false,
  cic_queloide boolean not null default false,

  biotipo public.biotipo_pele,
  hidratacao public.hidratacao_pele,
  espessura public.espessura_pele,
  fototipo public.fototipo_fitzpatrick,
  cor_pele public.cor_pele,

  textura_lisa boolean not null default false,
  textura_aspera boolean not null default false,
  textura_flacida boolean not null default false,
  textura_rugas_finas boolean not null default false,

  acne public.grau_acne,
  glogau public.glogau,

  rugas_dinamicas boolean not null default false,
  rugas_estaticas boolean not null default false,
  rugas_superficiais boolean not null default false,
  rugas_profundas boolean not null default false,

  -- Exame físico
  estado_geral text,
  peso_kg numeric(5, 2),
  altura_m numeric(3, 2),
  fc_bpm integer,
  pa_mmhg text,
  ritmo_respiratorio text,
  marcha public.marcha,
  musculos_mastigacao text,

  registrado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (patient_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'skin_peso_positivo'
  ) then
    alter table public.skin_assessments add constraint skin_peso_positivo
      check (peso_kg is null or peso_kg > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'skin_altura_positiva'
  ) then
    alter table public.skin_assessments add constraint skin_altura_positiva
      check (altura_m is null or altura_m > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'skin_fc_positiva'
  ) then
    alter table public.skin_assessments add constraint skin_fc_positiva
      check (fc_bpm is null or fc_bpm > 0);
  end if;
end
$$;

drop trigger if exists skin_assessments_atualizado_em on public.skin_assessments;
create trigger skin_assessments_atualizado_em
  before update on public.skin_assessments
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- botox_plans + botox_plan_items — pág. 4
-- ---------------------------------------------------------------------------

create table if not exists public.botox_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,

  produto_nome text,
  validade date,
  lote text,
  marca text,

  registrado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists botox_plans_patient_idx
  on public.botox_plans (patient_id, criado_em desc);

drop trigger if exists botox_plans_atualizado_em on public.botox_plans;
create trigger botox_plans_atualizado_em
  before update on public.botox_plans
  for each row execute function public.tocar_atualizado_em();

create table if not exists public.botox_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.botox_plans(id) on delete cascade,

  musculo text not null,
  diluicao_seringa text,
  quantidade_unidades numeric(8, 2),
  total_unidades numeric(8, 2),
  ordem smallint not null default 0,

  criado_em timestamptz not null default now()
);

create index if not exists botox_plan_items_plan_idx
  on public.botox_plan_items (plan_id, ordem);

-- ---------------------------------------------------------------------------
-- filler_plans + filler_plan_items — pág. 5
-- ---------------------------------------------------------------------------

create table if not exists public.filler_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,

  produto_nome text,
  validade date,
  lote text,
  marca text,

  registrado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists filler_plans_patient_idx
  on public.filler_plans (patient_id, criado_em desc);

drop trigger if exists filler_plans_atualizado_em on public.filler_plans;
create trigger filler_plans_atualizado_em
  before update on public.filler_plans
  for each row execute function public.tocar_atualizado_em();

create table if not exists public.filler_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.filler_plans(id) on delete cascade,

  produto text not null,
  regiao text,
  camada text,
  tecnica text,
  quantidade_ml numeric(8, 2),
  ordem smallint not null default 0,

  criado_em timestamptz not null default now()
);

create index if not exists filler_plan_items_plan_idx
  on public.filler_plan_items (plan_id, ordem);

-- ---------------------------------------------------------------------------
-- photo_sessions + photos — pasta de fotos clínicas
-- ---------------------------------------------------------------------------

create table if not exists public.photo_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  realizado_em timestamptz not null default now(),
  observacao text,
  registrado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now()
);

create index if not exists photo_sessions_patient_idx
  on public.photo_sessions (patient_id, realizado_em desc);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.photo_sessions(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  angulo public.angulo_foto not null default 'frontal',
  -- Caminho no bucket privado `paciente-arquivos` (nunca URL pública).
  storage_path text not null,
  mime_type text,
  tamanho_bytes integer,
  registrado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now()
);

create index if not exists photos_patient_idx
  on public.photos (patient_id, criado_em desc);

create index if not exists photos_session_idx
  on public.photos (session_id);

-- ---------------------------------------------------------------------------
-- patient_files — termos, exames, PDF/JPG
-- ---------------------------------------------------------------------------

create table if not exists public.patient_files (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  titulo text not null,
  -- termo | exame | outro — texto livre curto; UI ofereceulos fixos
  categoria text not null default 'outro',
  storage_path text not null,
  mime_type text,
  tamanho_bytes integer,
  registrado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now()
);

create index if not exists patient_files_patient_idx
  on public.patient_files (patient_id, criado_em desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'patient_files_titulo_nao_vazio'
  ) then
    alter table public.patient_files add constraint patient_files_titulo_nao_vazio
      check (length(trim(titulo)) > 0);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para fotos e arquivos clínicos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'paciente-arquivos',
  'paciente-arquivos',
  false,
  15728640, -- 15 MB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path esperado: {patient_id}/{fotos|arquivos}/{uuid}.{ext}
-- Equipe autenticada lê; só a Dra. grava/apaga.

drop policy if exists "equipe le arquivos do paciente" on storage.objects;
create policy "equipe le arquivos do paciente"
  on storage.objects for select
  using (
    bucket_id = 'paciente-arquivos'
    and auth.uid() is not null
  );

drop policy if exists "so a dra sobe arquivos do paciente" on storage.objects;
create policy "so a dra sobe arquivos do paciente"
  on storage.objects for insert
  with check (
    bucket_id = 'paciente-arquivos'
    and public.is_dra()
  );

drop policy if exists "so a dra atualiza arquivos do paciente" on storage.objects;
create policy "so a dra atualiza arquivos do paciente"
  on storage.objects for update
  using (
    bucket_id = 'paciente-arquivos'
    and public.is_dra()
  )
  with check (
    bucket_id = 'paciente-arquivos'
    and public.is_dra()
  );

drop policy if exists "so a dra apaga arquivos do paciente" on storage.objects;
create policy "so a dra apaga arquivos do paciente"
  on storage.objects for delete
  using (
    bucket_id = 'paciente-arquivos'
    and public.is_dra()
  );

-- ---------------------------------------------------------------------------
-- RLS — padrão 0006: SELECT equipe, escrita só Dra.
-- ---------------------------------------------------------------------------

-- anamneses
alter table public.anamneses enable row level security;
revoke all on public.anamneses from anon;

drop policy if exists "equipe le anamneses" on public.anamneses;
create policy "equipe le anamneses"
  on public.anamneses for select using (auth.uid() is not null);

drop policy if exists "so a dra cria anamnese" on public.anamneses;
create policy "so a dra cria anamnese"
  on public.anamneses for insert
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita anamnese" on public.anamneses;
create policy "so a dra edita anamnese"
  on public.anamneses for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga anamnese" on public.anamneses;
create policy "so a dra apaga anamnese"
  on public.anamneses for delete using (public.is_dra());

-- skin_assessments
alter table public.skin_assessments enable row level security;
revoke all on public.skin_assessments from anon;

drop policy if exists "equipe le avaliacoes" on public.skin_assessments;
create policy "equipe le avaliacoes"
  on public.skin_assessments for select using (auth.uid() is not null);

drop policy if exists "so a dra cria avaliacao" on public.skin_assessments;
create policy "so a dra cria avaliacao"
  on public.skin_assessments for insert
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita avaliacao" on public.skin_assessments;
create policy "so a dra edita avaliacao"
  on public.skin_assessments for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga avaliacao" on public.skin_assessments;
create policy "so a dra apaga avaliacao"
  on public.skin_assessments for delete using (public.is_dra());

-- botox_plans
alter table public.botox_plans enable row level security;
revoke all on public.botox_plans from anon;

drop policy if exists "equipe le planos botox" on public.botox_plans;
create policy "equipe le planos botox"
  on public.botox_plans for select using (auth.uid() is not null);

drop policy if exists "so a dra cria plano botox" on public.botox_plans;
create policy "so a dra cria plano botox"
  on public.botox_plans for insert
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita plano botox" on public.botox_plans;
create policy "so a dra edita plano botox"
  on public.botox_plans for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga plano botox" on public.botox_plans;
create policy "so a dra apaga plano botox"
  on public.botox_plans for delete using (public.is_dra());

-- botox_plan_items
alter table public.botox_plan_items enable row level security;
revoke all on public.botox_plan_items from anon;

drop policy if exists "equipe le itens botox" on public.botox_plan_items;
create policy "equipe le itens botox"
  on public.botox_plan_items for select using (auth.uid() is not null);

drop policy if exists "so a dra cria item botox" on public.botox_plan_items;
create policy "so a dra cria item botox"
  on public.botox_plan_items for insert with check (public.is_dra());

drop policy if exists "so a dra edita item botox" on public.botox_plan_items;
create policy "so a dra edita item botox"
  on public.botox_plan_items for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga item botox" on public.botox_plan_items;
create policy "so a dra apaga item botox"
  on public.botox_plan_items for delete using (public.is_dra());

-- filler_plans
alter table public.filler_plans enable row level security;
revoke all on public.filler_plans from anon;

drop policy if exists "equipe le planos filler" on public.filler_plans;
create policy "equipe le planos filler"
  on public.filler_plans for select using (auth.uid() is not null);

drop policy if exists "so a dra cria plano filler" on public.filler_plans;
create policy "so a dra cria plano filler"
  on public.filler_plans for insert
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita plano filler" on public.filler_plans;
create policy "so a dra edita plano filler"
  on public.filler_plans for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga plano filler" on public.filler_plans;
create policy "so a dra apaga plano filler"
  on public.filler_plans for delete using (public.is_dra());

-- filler_plan_items
alter table public.filler_plan_items enable row level security;
revoke all on public.filler_plan_items from anon;

drop policy if exists "equipe le itens filler" on public.filler_plan_items;
create policy "equipe le itens filler"
  on public.filler_plan_items for select using (auth.uid() is not null);

drop policy if exists "so a dra cria item filler" on public.filler_plan_items;
create policy "so a dra cria item filler"
  on public.filler_plan_items for insert with check (public.is_dra());

drop policy if exists "so a dra edita item filler" on public.filler_plan_items;
create policy "so a dra edita item filler"
  on public.filler_plan_items for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga item filler" on public.filler_plan_items;
create policy "so a dra apaga item filler"
  on public.filler_plan_items for delete using (public.is_dra());

-- photo_sessions
alter table public.photo_sessions enable row level security;
revoke all on public.photo_sessions from anon;

drop policy if exists "equipe le sessoes de foto" on public.photo_sessions;
create policy "equipe le sessoes de foto"
  on public.photo_sessions for select using (auth.uid() is not null);

drop policy if exists "so a dra cria sessao de foto" on public.photo_sessions;
create policy "so a dra cria sessao de foto"
  on public.photo_sessions for insert
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita sessao de foto" on public.photo_sessions;
create policy "so a dra edita sessao de foto"
  on public.photo_sessions for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga sessao de foto" on public.photo_sessions;
create policy "so a dra apaga sessao de foto"
  on public.photo_sessions for delete using (public.is_dra());

-- photos
alter table public.photos enable row level security;
revoke all on public.photos from anon;

drop policy if exists "equipe le fotos" on public.photos;
create policy "equipe le fotos"
  on public.photos for select using (auth.uid() is not null);

drop policy if exists "so a dra cria foto" on public.photos;
create policy "so a dra cria foto"
  on public.photos for insert
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita foto" on public.photos;
create policy "so a dra edita foto"
  on public.photos for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga foto" on public.photos;
create policy "so a dra apaga foto"
  on public.photos for delete using (public.is_dra());

-- patient_files
alter table public.patient_files enable row level security;
revoke all on public.patient_files from anon;

drop policy if exists "equipe le arquivos" on public.patient_files;
create policy "equipe le arquivos"
  on public.patient_files for select using (auth.uid() is not null);

drop policy if exists "so a dra cria arquivo" on public.patient_files;
create policy "so a dra cria arquivo"
  on public.patient_files for insert
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita arquivo" on public.patient_files;
create policy "so a dra edita arquivo"
  on public.patient_files for update
  using (public.is_dra()) with check (public.is_dra());

drop policy if exists "so a dra apaga arquivo" on public.patient_files;
create policy "so a dra apaga arquivo"
  on public.patient_files for delete using (public.is_dra());
