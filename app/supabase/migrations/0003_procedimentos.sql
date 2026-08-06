-- 0003_procedimentos.sql
-- Catálogo de procedimentos da clínica: duração, preço e o intervalo de
-- retorno padrão que alimenta a fila de retornos.
-- Idempotente: tabela com "if not exists", índices com "if not exists",
-- policies recriadas com "drop policy if exists" antes do "create policy" e
-- catálogo inicial com "on conflict do nothing".

-- ---------------------------------------------------------------------------
-- procedures
-- ---------------------------------------------------------------------------

create table if not exists public.procedures (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  duracao_minutos integer not null check (duracao_minutos between 5 and 480),
  preco_centavos integer not null check (preco_centavos >= 0),
  -- Intervalo de retorno em DIAS. `null` = este procedimento não gera retorno;
  -- é assim que a avaliação inicial fica fora da fila. O check exige > 0 para
  -- que "sem retorno" tenha uma única representação: null, nunca 0.
  default_return_interval_days integer check (default_return_interval_days > 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Nome é a chave de negócio: evita catálogo com duas "Toxina botulínica" e é
-- o que torna o seed abaixo repetível.
create unique index if not exists procedures_nome_unico on public.procedures (nome);

-- A listagem padrão é "ativos, em ordem alfabética".
create index if not exists procedures_ativo_nome_idx on public.procedures (ativo, nome);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.procedures enable row level security;

-- Leitura para toda a equipe autenticada: a secretária precisa do catálogo
-- para agendar (duração e preço saem daqui), então SELECT não é exclusivo da
-- Dra. Procedimento não é dado clínico de paciente — é configuração da clínica.
drop policy if exists "equipe le procedimentos" on public.procedures;
create policy "equipe le procedimentos"
  on public.procedures for select using (auth.uid() is not null);

-- Escrita exclusiva da Dra. O catálogo define preço e, principalmente, o
-- intervalo de retorno — que vira agendamento e mensagem para o paciente.
-- É decisão clínica e comercial, não operacional: a secretária tem SELECT e
-- nenhuma policy de INSERT/UPDATE/DELETE. Com RLS habilitada, comando sem
-- policy permissiva correspondente não afeta linha alguma.
-- `for all` cobre insert, update e delete de uma vez; o `with check` impede
-- que uma linha seja gravada num estado que a própria policy não permitiria.
drop policy if exists "so a dra escreve procedimentos" on public.procedures;
create policy "so a dra escreve procedimentos"
  on public.procedures for all using (public.is_dra()) with check (public.is_dra());

-- ---------------------------------------------------------------------------
-- Catálogo inicial
-- ---------------------------------------------------------------------------
-- Preços em centavos, sem ponto flutuante em dinheiro. O retorno da avaliação
-- é null de propósito: primeira consulta não agenda retorno automático.

insert into public.procedures (nome, duracao_minutos, preco_centavos, default_return_interval_days)
values
  ('Toxina botulínica', 60, 180000, 120),
  ('Preenchimento facial', 60, 250000, 365),
  ('Bioestimulador de colágeno', 60, 220000, 180),
  ('Avaliação / primeira consulta', 45, 0, null)
on conflict (nome) do nothing;
