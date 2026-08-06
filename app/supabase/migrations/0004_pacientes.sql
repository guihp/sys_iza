-- 0004_pacientes.sql
-- Cadastro de pacientes e o estágio de cada um no funil.
-- Idempotente: tabela e índices com "if not exists", constraints adicionadas
-- dentro de "do $$ ... $$" que checa pg_constraint, policies recriadas com
-- "drop policy if exists" antes do "create policy".
--
-- Escopo desta tabela: dado CADASTRAL e comercial (quem é a pessoa, como falar
-- com ela, em que ponto do funil está). Dado CLÍNICO — anamnese, evolução,
-- procedimento realizado — vive nas tabelas das Tasks 7 e 8, com regra de
-- acesso própria. Essa separação é o que permite dar escrita à secretária aqui
-- sem dar escrita a ela no prontuário.

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  nome_completo text not null,
  como_prefere_ser_chamado text,
  nascimento date,
  sexo text,
  -- Sempre em E.164 (+5511987654321). Ver o check e o índice único abaixo.
  telefone text,
  email text,
  -- Sem constraint de formato de propósito: não existe ainda normalização de
  -- CPF testada, e um check aqui só empurraria máscara para dentro do banco.
  -- Quando entrar a ficha completa, normalizar e então indexar.
  cpf text,
  nacionalidade text,
  naturalidade text,
  endereco text,
  profissao text,
  lead_source text,                    -- "Como me conheceu"
  contato_emergencia_nome text,
  contato_emergencia_parentesco text,
  contato_emergencia_telefone text,
  stage public.patient_stage not null default 'lead',
  aceita_whatsapp boolean not null default true,
  aceita_email boolean not null default true,
  consentimento_lgpd_em timestamptz,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
-- Em bloco condicional porque "alter table add constraint" não aceita
-- "if not exists" e a migration precisa poder rodar duas vezes.

do $$
begin
  -- Cartão sem nome é cartão inútil no kanban. Espaço em branco não conta.
  if not exists (
    select 1 from pg_constraint where conname = 'patients_nome_nao_vazio'
  ) then
    alter table public.patients add constraint patients_nome_nao_vazio
      check (length(trim(nome_completo)) > 0);
  end if;

  -- O índice único de telefone só deduplica se todo mundo entrar no mesmo
  -- formato: "(11) 98765-4321" e "11987654321" precisam colidir. Quem garante
  -- isso é normalizarTelefone() na aplicação; este check é a rede embaixo —
  -- se alguém gravar por fora e sem normalizar, o banco recusa em vez de
  -- criar um paciente duplicado silencioso.
  if not exists (
    select 1 from pg_constraint where conname = 'patients_telefone_e164'
  ) then
    alter table public.patients add constraint patients_telefone_e164
      check (telefone ~ '^\+[1-9]\d{7,14}$');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

-- Único e parcial: dois pacientes não podem dividir o mesmo telefone (é por ele
-- que o lembrete sai no WhatsApp), mas vários leads podem não ter telefone
-- ainda — e em índice único no Postgres cada null é distinto de qualquer outro,
-- então o "where telefone is not null" é sobre clareza de intenção, não sobre
-- destravar os nulos.
create unique index if not exists patients_telefone_unico
  on public.patients (telefone) where telefone is not null;

-- O kanban lê uma coluna por estágio, do mais recente para o mais antigo.
-- Composto porque um índice em (stage, criado_em) também atende a busca só por
-- stage — o contrário não é verdade.
create index if not exists patients_stage_criado_idx
  on public.patients (stage, criado_em desc);

-- ---------------------------------------------------------------------------
-- atualizado_em
-- ---------------------------------------------------------------------------
-- Em trigger, e não só na Server Action: a coluna vai alimentar "última
-- movimentação" na fila de retornos. Um campo de auditoria que depende de todo
-- caller lembrar de preenchê-lo mente na primeira vez que alguém esquece.

create or replace function public.tocar_atualizado_em() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end
$$;

drop trigger if exists patients_atualizado_em on public.patients;
create trigger patients_atualizado_em
  before update on public.patients
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.patients enable row level security;

-- PII e dado de saúde: o papel anônimo não tem o que fazer nesta tabela.
-- As policies abaixo já exigem auth.uid(), então isto é redundante hoje — é
-- defesa em profundidade para o dia em que alguém escrever uma policy frouxa.
-- O Postgres nega por privilégio antes mesmo de avaliar a RLS.
revoke all on public.patients from anon;

-- Leitura para toda a equipe autenticada: a secretária atende o telefone, e
-- para isso precisa do cadastro inteiro.
drop policy if exists "equipe le pacientes" on public.patients;
create policy "equipe le pacientes"
  on public.patients for select using (auth.uid() is not null);

-- Cadastro e funil são o trabalho da secretária: é ela quem recebe o lead,
-- digita nome e telefone e arrasta o cartão de coluna. Negar INSERT/UPDATE aqui
-- seria negar a própria função dela. A restrição sobre dado clínico não é
-- violada porque nenhuma coluna desta tabela é clínica — anamnese e evolução
-- ficam em outras tabelas, onde ela terá SELECT e nada mais.
drop policy if exists "equipe cria pacientes" on public.patients;
create policy "equipe cria pacientes"
  on public.patients for insert with check (auth.uid() is not null);

drop policy if exists "equipe atualiza pacientes" on public.patients;
create policy "equipe atualiza pacientes"
  on public.patients for update
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- Apagar é exclusivo da Dra. Lead que não virou nada tem destino próprio no
-- funil — o estágio 'descartado' — e é esse o caminho da secretária. DELETE
-- destrói histórico e, quando houver atendimento ligado ao paciente, destruiria
-- prontuário junto: é decisão da responsável clínica, não operacional.
drop policy if exists "so a dra remove pacientes" on public.patients;
create policy "so a dra remove pacientes"
  on public.patients for delete using (public.is_dra());
