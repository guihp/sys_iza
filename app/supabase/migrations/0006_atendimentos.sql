-- 0006_atendimentos.sql
-- Prontuário: o que foi de fato feito no paciente, e quando ele volta.
-- Idempotente: tabela e índices com "if not exists", constraints adicionadas
-- dentro de "do $$ ... $$" que checa pg_constraint, policies recriadas com
-- "drop policy if exists" antes do "create policy".
--
-- Escopo desta tabela: dado CLÍNICO. É a primeira do banco que é prontuário de
-- verdade — região tratada, quantidade aplicada, evolução. As migrations 0004 e
-- 0005 abriram INSERT e UPDATE para toda a equipe com o argumento de que
-- nenhuma coluna delas era clínica: cadastrar paciente e marcar consulta são
-- literalmente a função da secretária, e `patients.observacoes` e
-- `appointments.observacoes` são cadastro e logística. Esse argumento acaba
-- aqui. Nesta tabela a secretária tem SELECT e nenhuma policy de escrita —
-- ver a seção de RLS no fim do arquivo.

-- ---------------------------------------------------------------------------
-- attendance_records
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),

  -- on delete cascade, igual à agenda: DELETE em `patients` é exclusivo da Dra.
  -- (ver 0004), e o caminho normal para lead que não virou nada é o estágio
  -- 'descartado', não o DELETE. Quando a responsável clínica decide de fato
  -- apagar uma pessoa do sistema — pedido de exclusão sob a LGPD, por exemplo —
  -- o prontuário dela tem que ir junto: deixar evolução clínica órfã apontando
  -- para um paciente que não existe mais seria guardar dado de saúde de alguém
  -- que pediu para ser esquecido.
  patient_id uuid not null references public.patients(id) on delete cascade,

  -- Nullable e "on delete set null", ao contrário do paciente. Duas razões.
  -- A primeira: nem todo atendimento nasce de uma consulta na agenda — encaixe,
  -- retoque de cortesia e registro feito depois do fato existem, e exigir
  -- agendamento aqui empurraria a Dra. a inventar consulta para poder registrar
  -- o que já fez. A segunda: apagar um agendamento não pode apagar prontuário.
  -- O vínculo com a agenda é uma conveniência de rastreio; o registro clínico
  -- sobrevive a ele.
  appointment_id uuid references public.appointments(id) on delete set null,

  -- Obrigatório e sem cascade. É o procedimento que diz o que foi feito, e é
  -- dele que sai o `default_return_interval_days` que alimenta o nível 1 do
  -- cálculo de retorno. Procedimento sai do catálogo por desativação
  -- (`ativo = false`, ver 0003), nunca por DELETE — e esta FK transforma a
  -- tentativa de apagar um procedimento com prontuário em erro explícito do
  -- banco, em vez de perda silenciosa de histórico.
  procedure_id uuid not null references public.procedures(id),

  -- timestamptz: instante absoluto. O dia de calendário da clínica é aplicado
  -- na leitura, por src/lib/datetime.ts. Registro feito às 22:00 de Brasília já
  -- é o dia seguinte em UTC, e guardar data solta faria o atendimento aparecer
  -- na ficha com a data errada.
  realizado_em timestamptz not null default now(),

  -- Evolução clínica. Texto livre de propósito: "malar direito", "1,5 ml",
  -- "20 U" e "paciente relatou edema leve" não cabem em enum, e forçá-los a
  -- caber produziria campo "outro" com tudo dentro.
  regiao_tratada text,
  quantidade text,
  observacoes text,

  -- ------------------------------------------------------------------------
  -- Retorno — os três níveis de precedência, do mais fraco ao mais forte
  -- ------------------------------------------------------------------------
  -- Nível 1 não mora aqui: é `procedures.default_return_interval_days`, no
  -- catálogo. As colunas abaixo são os níveis 2 e 3, decididos pela Dra. no
  -- registro deste atendimento, e o que estiver preenchido vence o catálogo.
  -- A conta em si vive em src/domain/returns/compute-return.ts, coberta por
  -- teste unitário; o banco guarda tanto as entradas quanto o resultado.

  -- Nível 2a: intervalo em dias para esta paciente. Vence o padrão do catálogo.
  retorno_ajuste_dias integer,

  -- Nível 2b: data escolhida no calendário. Vence o ajuste em dias.
  -- `date` e não `timestamptz`: retorno é dia de calendário, não instante — não
  -- existe "voltar às 14:32 de 3 de dezembro".
  retorno_data date,

  -- Nível 3: esta paciente não volta. Vence tudo, inclusive a data acima.
  -- `not null default false` para que "não decidido" e "decidiu que não" não
  -- fiquem os dois em null, indistinguíveis.
  sem_retorno boolean not null default false,

  -- Resultado dos três níveis, materializado.
  --
  -- Redundante com as colunas acima por escolha, não por descuido: a fila de
  -- retornos precisa de um índice sobre a data de vencimento para não varrer o
  -- prontuário inteiro a cada abertura de tela, e não dá para indexar o
  -- resultado de uma regra que mora na aplicação. Materializar também congela a
  -- decisão: mudar o intervalo padrão de um procedimento no catálogo não pode
  -- reescrever retroativamente o retorno já combinado com quem foi atendida no
  -- ano passado.
  --
  -- Nulo quando não há retorno — seja por `sem_retorno`, seja porque o
  -- procedimento não gera retorno e ninguém ajustou nada.
  retorno_vencimento date,

  -- Quem registrou. Sem cascade e sem "set null": prontuário sem autor não é
  -- prontuário, e apagar o usuário não pode apagar a autoria. Na prática isto
  -- impede o DELETE de um usuário que já registrou atendimento — que é o
  -- comportamento certo para registro clínico.
  registrado_por uuid not null references auth.users(id),

  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
-- Em bloco condicional porque "alter table add constraint" não aceita
-- "if not exists" e a migration precisa poder rodar duas vezes.

do $$
begin
  -- Mesma regra do catálogo (ver 0003): "sem retorno" tem uma representação só,
  -- e não é o zero. Sem este check, `retorno_ajuste_dias = 0` produziria um
  -- retorno marcado para o próprio dia do atendimento, e `-30` marcaria um
  -- retorno no passado — as duas coisas caem na fila como vencidas no dia em que
  -- foram criadas.
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_ajuste_dias_positivo'
  ) then
    alter table public.attendance_records add constraint attendance_ajuste_dias_positivo
      check (retorno_ajuste_dias is null or retorno_ajuste_dias > 0);
  end if;

  -- O nível 3 vence tudo, garantido pelo banco e não só pela aplicação.
  --
  -- `sem_retorno = true` com `retorno_vencimento` preenchido é um estado que a
  -- regra de negócio não consegue produzir — `calcularRetorno` devolve null
  -- assim que vê a marca —, mas que uma gravação por fora do fluxo, um update
  -- parcial que marque `sem_retorno` sem limpar o vencimento, ou um caller
  -- futuro distraído produziriam sem esforço. O resultado seria uma paciente que
  -- a Dra. dispensou do retorno aparecendo na fila e recebendo mensagem de
  -- cobrança. Erro caro e silencioso, e por isso barrado aqui.
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_sem_retorno_sem_vencimento'
  ) then
    alter table public.attendance_records add constraint attendance_sem_retorno_sem_vencimento
      check (not sem_retorno or retorno_vencimento is null);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

-- A consulta da fila de retornos: quem vence dentro da janela. Parcial porque a
-- maioria das linhas com o tempo terá vencimento nulo (procedimento sem retorno
-- padrão, ou paciente dispensado) e essas nunca são alvo da fila — mantê-las
-- fora deixa o índice menor e a varredura mais barata.
create index if not exists attendance_retorno_idx
  on public.attendance_records (retorno_vencimento)
  where retorno_vencimento is not null;

-- Histórico do paciente na ficha: os atendimentos dele, do mais recente para o
-- mais antigo. É também a consulta que a fila usa para descobrir qual é o
-- atendimento mais recente de cada pessoa. Composto porque
-- (patient_id, realizado_em desc) também atende a busca só por patient_id — o
-- contrário não é verdade.
create index if not exists attendance_patient_idx
  on public.attendance_records (patient_id, realizado_em desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.attendance_records enable row level security;

-- Prontuário. O papel anônimo não tem absolutamente nada a fazer aqui.
-- Redundante com as policies abaixo, que já exigem sessão — é defesa em
-- profundidade, e o Postgres nega por privilégio antes mesmo de avaliar a RLS.
revoke all on public.attendance_records from anon;

-- LEITURA: toda a equipe autenticada.
--
-- A secretária lê porque sem isso ela não trabalha: é ela quem abre a fila de
-- retornos, liga para a paciente e sabe dizer "seu retorno da toxina venceu no
-- mês passado". Negar SELECT aqui esvaziaria a tela de retornos justamente para
-- quem a opera.
drop policy if exists "equipe le atendimentos" on public.attendance_records;
create policy "equipe le atendimentos"
  on public.attendance_records for select using (auth.uid() is not null);

-- ESCRITA: exclusiva da Dra. — as três policies abaixo exigem is_dra().
--
-- E é só isso. Não existe, em lugar nenhum deste arquivo, policy de INSERT,
-- UPDATE ou DELETE que a secretária satisfaça. Com RLS habilitada, comando sem
-- policy permissiva correspondente não afeta linha alguma: o INSERT dela volta
-- em erro de permissão, e o UPDATE e o DELETE voltam sem erro e sem ter tocado
-- em nada. É esse o efeito pretendido — a Global Constraint pede SELECT e
-- nenhuma escrita, não uma versão mais frouxa disso.
--
-- O argumento de conveniência operacional que abriu escrita para ela em
-- `patients` (0004) e `appointments` (0005) não vale aqui, e a diferença não é
-- de grau: lá nenhuma coluna era clínica, aqui todas são. Quem responde pelo que
-- foi aplicado, em que região e em que quantidade é a responsável clínica, com
-- registro no CRO — não a operação da clínica. Anotar procedimento em nome de
-- outra pessoa é o tipo de erro que ninguém percebe até virar problema.
--
-- Se um dia a rotina exigir que a secretária ajude a preencher prontuário, o
-- caminho não é afrouxar estas policies: é uma tabela de rascunho, que a Dra.
-- revisa e assina.

drop policy if exists "so a dra registra atendimento" on public.attendance_records;
create policy "so a dra registra atendimento"
  on public.attendance_records for insert
  -- `registrado_por = auth.uid()` além do papel: a coluna de autoria não pode
  -- ser preenchida com o id de outra pessoa. Sem isso, "quem registrou" seria
  -- apenas o que o caller disse ter sido, e a auditoria de prontuário mentiria.
  with check (public.is_dra() and registrado_por = auth.uid());

drop policy if exists "so a dra edita atendimento" on public.attendance_records;
create policy "so a dra edita atendimento"
  on public.attendance_records for update
  -- O `with check` repete a condição do `using` para que a linha não possa ser
  -- gravada num estado que a própria policy não deixaria ler de volta.
  using (public.is_dra()) with check (public.is_dra());

-- DELETE também é da Dra., e mesmo para ela é o caminho errado: corrigir
-- prontuário é editar ou registrar de novo, não apagar. A policy existe para o
-- registro criado por engano no mesmo dia — não para reescrever histórico.
drop policy if exists "so a dra apaga atendimento" on public.attendance_records;
create policy "so a dra apaga atendimento"
  on public.attendance_records for delete using (public.is_dra());
