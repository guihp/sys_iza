-- 0005_agendamentos.sql
-- Agenda de consultas: quem, qual procedimento, quando, e em que situação.
-- Idempotente: tabela e índices com "if not exists", constraints adicionadas
-- dentro de "do $$ ... $$" que checa pg_constraint, policies recriadas com
-- "drop policy if exists" antes do "create policy".
--
-- Escopo desta tabela: dado de AGENDA — logística de horário. Continua não
-- sendo prontuário. O que a Dra. registrar sobre o que foi feito no paciente
-- (evolução, produto, lote, quantidade) vive em `atendimentos`, na 0006, com
-- regra de acesso própria. Essa separação é o que permite dar INSERT e UPDATE
-- à secretária aqui — marcar e remarcar consulta é literalmente a função dela —
-- sem lhe dar escrita em dado clínico.

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),

  -- on delete cascade: se a Dra. apagar o paciente (DELETE é exclusivo dela,
  -- ver 0004), a agenda dele vai junto. Deixar agendamento órfão apontando para
  -- um paciente que não existe mais só produziria linha fantasma na grade.
  patient_id uuid not null references public.patients(id) on delete cascade,

  -- Sem cascade e sem "on delete set null": o procedimento é obrigatório e
  -- define a duração do bloco. Procedimento sai do catálogo por desativação
  -- (`ativo = false`, ver 0003), não por DELETE — e esta FK é o que garante
  -- isso: apagar um procedimento com histórico de agenda passa a ser um erro
  -- explícito do banco em vez de uma perda silenciosa.
  procedure_id uuid not null references public.procedures(id),

  -- timestamptz, sempre. O instante é absoluto; o relógio de parede da clínica
  -- (America/Sao_Paulo) é aplicado na leitura, em src/lib/datetime.ts. Guardar
  -- hora local sem fuso seria escolher errar no dia em que o horário de verão
  -- voltar por decreto.
  inicio timestamptz not null,

  -- Materializado em vez de derivado de procedures.duracao_minutos: a duração
  -- do catálogo muda com o tempo, e mudar o catálogo não pode reescrever
  -- retroativamente o fim de consultas já marcadas. O `fim` gravado é o que foi
  -- combinado com o paciente.
  fim timestamptz not null,

  status public.appointment_status not null default 'agendado',

  -- Observação de LOGÍSTICA: "paciente pediu para chegar mais cedo", "vem
  -- acompanhada". Não é campo de evolução clínica — esse é o da 0006. A
  -- secretária escreve aqui, e é por isso que este campo não pode virar
  -- prontuário disfarçado.
  observacoes text,

  -- Id do evento no Google Calendar, preenchido pela sincronia opcional da
  -- Task 12. Fica nulo enquanto a sincronia não estiver ligada.
  google_event_id text,

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
  -- Consulta que termina antes de começar não existe. Sem este check, um `fim`
  -- invertido passaria despercebido e a detecção de conflito — que compara
  -- inicio < fim do outro — devolveria "livre" para um horário ocupado.
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_fim_depois_do_inicio'
  ) then
    alter table public.appointments add constraint appointments_fim_depois_do_inicio
      check (fim > inicio);
  end if;

  -- Sobreposição de horário barrada pelo próprio banco.
  --
  -- A regra de negócio vive em src/domain/scheduling/conflict.ts e é ela que
  -- produz a mensagem que a secretária lê. Mas a checagem na aplicação é
  -- "ler, decidir, gravar": entre o ler e o gravar cabe outra requisição. Duas
  -- pessoas marcando o mesmo horário ao mesmo tempo — ou a secretária no
  -- computador e a Dra. no celular — passam as duas pela verificação e gravam
  -- as duas. Só uma constraint no banco fecha essa janela.
  --
  -- `[)` é o mesmo intervalo semiaberto de conflict.ts: encostar não colide, e
  -- a consulta das 15:00 pode começar quando a das 14:00 termina. As duas
  -- camadas precisam concordar, senão o banco recusaria agendamentos que a tela
  -- prometeu aceitar.
  --
  -- Sem escopo por profissional porque a clínica tem uma só: a agenda inteira é
  -- de uma pessoa. No dia em que houver uma segunda cadeira, esta constraint
  -- ganha `professional_id with =` (e aí sim precisa da extensão btree_gist).
  --
  -- O `where` deixa cancelado fora: horário cancelado é horário livre, e sem
  -- essa condição um cancelamento continuaria bloqueando a remarcação.
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_sem_sobreposicao'
  ) then
    alter table public.appointments add constraint appointments_sem_sobreposicao
      exclude using gist (tstzrange(inicio, fim, '[)') with &&)
      where (status <> 'cancelado');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

-- A agenda é lida por janela de tempo — "a semana do dia tal" — e é essa a
-- consulta mais frequente do sistema.
create index if not exists appointments_inicio_idx
  on public.appointments (inicio);

-- Histórico do paciente na ficha: as consultas dele, da mais recente para a
-- mais antiga. Composto porque (patient_id, inicio desc) também atende a busca
-- só por patient_id — o contrário não é verdade.
create index if not exists appointments_patient_idx
  on public.appointments (patient_id, inicio desc);

-- O worker de lembretes e a fila de retornos varrem por situação dentro de uma
-- janela ("quem está agendado para amanhã", "quem faltou"). Parcial, deixando
-- cancelado de fora: linha cancelada não é alvo de lembrete nem de cobrança, e
-- manter essas linhas fora do índice o deixa menor.
create index if not exists appointments_status_inicio_idx
  on public.appointments (status, inicio)
  where status <> 'cancelado';

-- ---------------------------------------------------------------------------
-- atualizado_em
-- ---------------------------------------------------------------------------
-- Mesma função da 0004 (`public.tocar_atualizado_em`), reaproveitada. Remarcação
-- é o evento mais sensível desta tabela — muda o horário combinado com o
-- paciente e obriga a refazer os lembretes —, então o carimbo não pode depender
-- de todo caller lembrar de preenchê-lo.

drop trigger if exists appointments_atualizado_em on public.appointments;
create trigger appointments_atualizado_em
  before update on public.appointments
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.appointments enable row level security;

-- A agenda liga paciente a procedimento: quem lê esta tabela sabe que fulana
-- fez toxina botulínica em tal data. É dado de saúde por associação, mesmo sem
-- nenhuma coluna clínica. O papel anônimo não tem o que fazer aqui.
-- Redundante com as policies abaixo, que já exigem auth.uid() — é defesa em
-- profundidade, e o Postgres nega por privilégio antes mesmo de avaliar a RLS.
revoke all on public.appointments from anon;

-- Leitura para toda a equipe autenticada: sem enxergar a agenda a secretária
-- não atende o telefone, não confirma consulta e não sabe o que está livre.
drop policy if exists "equipe le agenda" on public.appointments;
create policy "equipe le agenda"
  on public.appointments for select using (auth.uid() is not null);

-- Marcar consulta é a função da secretária. Negar INSERT aqui seria negar o
-- trabalho dela e empurrar a agenda de volta para o papel. A restrição sobre
-- dado clínico não é violada: nenhuma coluna desta tabela é prontuário —
-- `observacoes` é logística, e evolução clínica fica na 0006, onde ela terá
-- SELECT e nenhuma policy de escrita.
drop policy if exists "equipe agenda" on public.appointments;
create policy "equipe agenda"
  on public.appointments for insert with check (auth.uid() is not null);

-- Remarcar, confirmar e cancelar são a mesma função, do mesmo turno de trabalho:
-- é a secretária que atende o telefone quando a paciente pede para mudar. O
-- `with check` repete a condição do `using` para que a linha não possa ser
-- gravada num estado que a própria policy não deixaria ler.
drop policy if exists "equipe remarca" on public.appointments;
create policy "equipe remarca"
  on public.appointments for update
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- Apagar é exclusivo da Dra. Consulta que não vai acontecer tem destino próprio
-- — o status 'cancelado' —, e é esse o caminho da secretária: preserva o
-- histórico, libera o horário (a constraint de sobreposição ignora cancelado) e
-- deixa rastro de que houve um cancelamento. DELETE destrói esse rastro e, com
-- o atendimento da 0006 apontando para cá, destruiria prontuário junto: é
-- decisão da responsável clínica, não operacional.
drop policy if exists "so a dra apaga agendamento" on public.appointments;
create policy "so a dra apaga agendamento"
  on public.appointments for delete using (public.is_dra());
