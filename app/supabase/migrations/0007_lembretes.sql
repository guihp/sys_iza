-- 0007_lembretes.sql
-- Fila de lembretes e os textos que vão para o paciente.
-- Idempotente: tabelas e índices com "if not exists", constraints adicionadas
-- dentro de "do $$ ... $$" que checa pg_constraint, policies recriadas com
-- "drop policy if exists" antes do "create policy", e os textos-semente com
-- "on conflict do nothing".
--
-- Duas tabelas com naturezas opostas, e por isso regras de acesso diferentes:
--
--   `message_templates` é CONFIGURAÇÃO. Texto institucional, um por tipo e
--   canal, editado raramente. É a voz da clínica falando com o paciente: quem
--   escreve é a responsável clínica, e a equipe lê para saber o que foi
--   enviado.
--
--   `reminder_jobs` é FILA DE TRABALHO. Uma linha por mensagem a enviar, criada
--   pelo sistema, consumida pelo worker de despacho (Task 11). Não é prontuário,
--   mas é dado de saúde por associação, do mesmo jeito que a agenda: quem lê
--   sabe que fulana fez um procedimento e volta em dezembro.
--
-- O planejamento — quantos lembretes, quando, por qual canal — não mora aqui.
-- Ele é regra pura, vive em src/domain/reminders/plan-reminders.ts e é coberto
-- por teste unitário sem banco. O que este arquivo garante é o que só o banco
-- pode garantir: que reprocessar não duplique mensagem.

-- ---------------------------------------------------------------------------
-- message_templates
-- ---------------------------------------------------------------------------

create table if not exists public.message_templates (
  -- Chave composta em vez de id sintético: existe exatamente um texto por tipo
  -- e canal, e é essa combinação que o worker procura na hora de montar a
  -- mensagem. Um `id uuid` aqui só criaria a possibilidade de dois textos
  -- concorrentes para 'confirmacao' + 'whatsapp' — e nenhuma forma de o worker
  -- escolher entre eles.
  kind public.reminder_kind not null,
  channel public.reminder_channel not null,

  -- Só o e-mail tem assunto. No WhatsApp fica nulo — ver a constraint
  -- `templates_email_tem_assunto` abaixo, que impede o inverso: e-mail sem
  -- assunto, que os provedores tratam como spam.
  assunto text,

  -- Texto com variáveis `{{nome}}`, renderizado por
  -- src/domain/reminders/template.ts. A sintaxe é só substituição — sem
  -- condicional e sem laço —, então nada do que for gravado nesta coluna
  -- executa em lugar nenhum.
  corpo text not null,

  -- Desligar um tipo de lembrete sem apagar o texto escrito. O worker pula o
  -- template inativo; a Dra. religa quando quiser, com a redação preservada.
  ativo boolean not null default true,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  primary key (kind, channel)
);

do $$
begin
  -- Corpo em branco é template quebrado: o worker montaria uma mensagem vazia e
  -- a enviaria — o paciente recebe um WhatsApp em branco da clínica. Desligar um
  -- lembrete se faz com `ativo = false`, não apagando o texto.
  if not exists (
    select 1 from pg_constraint where conname = 'templates_corpo_nao_vazio'
  ) then
    alter table public.message_templates add constraint templates_corpo_nao_vazio
      check (length(btrim(corpo)) > 0);
  end if;

  -- E-mail sem assunto cai em spam ou chega como "(sem assunto)". Já o WhatsApp
  -- não tem onde exibir um assunto, então preenchê-lo ali seria texto morto.
  if not exists (
    select 1 from pg_constraint where conname = 'templates_email_tem_assunto'
  ) then
    alter table public.message_templates add constraint templates_email_tem_assunto
      check (
        (channel = 'email' and assunto is not null and length(btrim(assunto)) > 0)
        or (channel <> 'email' and assunto is null)
      );
  end if;
end
$$;

drop trigger if exists message_templates_atualizado_em on public.message_templates;
create trigger message_templates_atualizado_em
  before update on public.message_templates
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- Textos iniciais
-- ---------------------------------------------------------------------------
-- Um por par (kind, channel) que o planejador de fato produz — sete ao todo.
-- Sem isso o sistema entra em produção mudo: o worker não tem o que enviar e
-- falha job por job.
--
-- `on conflict do nothing`, e não `do update`: rodar a migration de novo não
-- pode reescrever por cima do texto que a Dra. ajustou na tela de mensagens.
-- Semente é ponto de partida, não valor imposto a cada deploy.
--
-- Português do Brasil, tratamento na segunda pessoa e assinatura implícita da
-- clínica: é a Dra. Izadora quem aparece no remetente do WhatsApp.

insert into public.message_templates (kind, channel, assunto, corpo) values
  ('confirmacao', 'whatsapp', null,
   'Olá, {{nome}}! Passando para confirmar sua consulta amanhã, {{data}}, às {{hora}}, com a Dra. Izadora Barros. Podemos confirmar sua presença?'),
  ('confirmacao', 'email', 'Sua consulta é amanhã, {{data}}',
   'Olá, {{nome}}! Sua consulta está marcada para {{data}} às {{hora}}. Qualquer imprevisto, é só responder esta mensagem.'),
  ('vespera_curta', 'whatsapp', null,
   'Oi, {{nome}}! Seu horário com a Dra. Izadora é hoje às {{hora}}. Te esperamos!'),
  ('pos_procedimento', 'whatsapp', null,
   'Oi, {{nome}}! Como você está depois do seu {{procedimento}}? Lembrando dos cuidados: evite exposição solar, calor intenso e exercícios pesados nas primeiras 24 horas. Qualquer dúvida, me chame por aqui.'),
  ('avaliacao', 'whatsapp', null,
   'Oi, {{nome}}! Já faz uma semana do seu {{procedimento}}. Como está se sentindo com o resultado? Sua opinião ajuda muito a Dra. Izadora.'),
  ('retorno', 'whatsapp', null,
   'Oi, {{nome}}! Seu retorno de {{procedimento}} está chegando ({{data_retorno}}). Quer que eu já reserve um horário para você?'),
  ('retorno', 'email', 'Seu retorno está chegando',
   'Olá, {{nome}}! O retorno do seu {{procedimento}} está previsto para {{data_retorno}}. Responda esta mensagem para agendarmos.')
on conflict (kind, channel) do nothing;

-- ---------------------------------------------------------------------------
-- reminder_jobs
-- ---------------------------------------------------------------------------

create table if not exists public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),

  -- Origem do lembrete: ou uma consulta na agenda (confirmação, véspera curta),
  -- ou um atendimento registrado (cuidados, avaliação, retorno). Exatamente uma
  -- das duas — ver `reminder_jobs_uma_origem`.
  --
  -- `on delete cascade` nas duas: lembrete é sobre um evento, e apagado o
  -- evento o lembrete perde sentido. Deixá-lo pendente faria o worker enviar
  -- "sua consulta é amanhã" sobre uma consulta que não existe mais — que é
  -- exatamente o pior erro que este sistema pode cometer.
  appointment_id uuid references public.appointments(id) on delete cascade,
  attendance_id uuid references public.attendance_records(id) on delete cascade,

  -- Redundante com as duas colunas acima por escolha: o destinatário é lido em
  -- todo despacho e mostrado na ficha, e resolvê-lo por join a cada leitura
  -- pagaria caro por um dado que não muda. Também é o que permite o índice por
  -- paciente lá embaixo.
  patient_id uuid not null references public.patients(id) on delete cascade,

  kind public.reminder_kind not null,
  channel public.reminder_channel not null,

  -- timestamptz, sempre. A janela de silêncio raciocina no relógio de São Paulo
  -- (src/domain/reminders/quiet-hours.ts) e é aplicada no DESPACHO, não aqui:
  -- entre planejar e enviar cabe atraso do worker, e o que decide se é hora
  -- decente de tocar o celular de alguém é o relógio do envio.
  agendado_para timestamptz not null,

  status public.reminder_status not null default 'pendente',

  -- Quantas vezes o worker já tentou. Serve ao backoff e ao desistir depois de
  -- N falhas, na Task 11.
  tentativas integer not null default 0,

  enviado_em timestamptz,

  -- Última mensagem de erro do provedor. Texto livre porque é isso que a
  -- Evolution API e o Resend devolvem, e recortá-lo em código de erro perderia
  -- justamente o detalhe que faz alguém entender por que não chegou.
  erro text,

  -- Id da mensagem no provedor, para rastrear entrega do lado de lá.
  provider_message_id text,

  -- ------------------------------------------------------------------------
  -- A garantia de não-reenvio
  -- ------------------------------------------------------------------------
  -- `{origem}:{tipo}:{canal}`, montada em plan-reminders.ts. É o `unique` desta
  -- coluna que impede duplicata, e é de propósito que ele esteja no banco e não
  -- na aplicação: planejar é "ler se já existe, decidir, gravar", e entre o ler
  -- e o gravar cabe outra requisição. Duas chamadas simultâneas — a secretária
  -- salvando duas vezes por impaciência, um retry de rede, o worker reprocessando
  -- — passariam as duas pela checagem e gravariam as duas, e a paciente receberia
  -- a mesma mensagem em dobro. Com o `unique`, o segundo insert simplesmente
  -- falha, e o caller trata isso como "já estava planejado".
  --
  -- A chave não inclui o horário, e isso é uma decisão com consequência:
  -- replanejar a mesma consulta é no-op, mas remarcá-la NÃO reescreve sozinha os
  -- jobs pendentes. Quando a remarcação existir, ela terá de cancelar os
  -- pendentes (status 'cancelado') e replanejar — explicitamente. Preferível a
  -- uma chave que inclua o horário e vá acumulando um lembrete por remarcação.
  chave_idempotencia text not null unique,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

do $$
begin
  -- Uma origem, nunca duas e nunca nenhuma. Sem isto caberia um job órfão, que
  -- o `on delete cascade` de nenhuma das duas FKs alcançaria — ele sobreviveria
  -- ao cancelamento da consulta e ao apagamento do prontuário, e continuaria na
  -- fila para ser enviado.
  if not exists (
    select 1 from pg_constraint where conname = 'reminder_jobs_uma_origem'
  ) then
    alter table public.reminder_jobs add constraint reminder_jobs_uma_origem
      check ((appointment_id is not null) <> (attendance_id is not null));
  end if;

  -- Contador de tentativas não anda para trás.
  if not exists (
    select 1 from pg_constraint where conname = 'reminder_jobs_tentativas_nao_negativas'
  ) then
    alter table public.reminder_jobs add constraint reminder_jobs_tentativas_nao_negativas
      check (tentativas >= 0);
  end if;

  -- Job marcado como enviado sem hora de envio é auditoria que não responde a
  -- "quando foi que a paciente recebeu isso?". Como o status é o que impede o
  -- reenvio, ele precisa vir sempre acompanhado do carimbo que o justifica.
  if not exists (
    select 1 from pg_constraint where conname = 'reminder_jobs_enviado_tem_carimbo'
  ) then
    alter table public.reminder_jobs add constraint reminder_jobs_enviado_tem_carimbo
      check (status <> 'enviado' or enviado_em is not null);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

-- A consulta do worker, a cada cinco minutos: "o que está pendente e já venceu".
-- Parcial em `status = 'pendente'` — e é isso que faz o índice valer a pena a
-- longo prazo. Job enviado nunca mais é lido pela fila, e com o tempo eles serão
-- a esmagadora maioria das linhas; mantê-los fora deixa o índice do tamanho da
-- fila real, não do histórico inteiro.
--
-- `status` não entra na chave de propósito: dentro de um índice parcial que já
-- filtra por ele, a coluna teria o mesmo valor em toda entrada e só ocuparia
-- espaço. A ordenação que importa é a de `agendado_para`.
create index if not exists reminder_jobs_fila_idx
  on public.reminder_jobs (agendado_para)
  where status = 'pendente';

-- Histórico do paciente: o que já foi mandado para ele, do mais recente para o
-- mais antigo. É como a secretária responde "a senhora recebeu a confirmação?"
-- sem varrer a tabela.
create index if not exists reminder_jobs_patient_idx
  on public.reminder_jobs (patient_id, agendado_para desc);

-- Ao cancelar ou remarcar uma consulta é preciso achar os lembretes dela.
-- Parcial porque metade das linhas tem `appointment_id` nulo (as de origem em
-- atendimento) e essas nunca são alvo desta busca.
create index if not exists reminder_jobs_appointment_idx
  on public.reminder_jobs (appointment_id)
  where appointment_id is not null;

-- ---------------------------------------------------------------------------
-- atualizado_em
-- ---------------------------------------------------------------------------
-- Mesma função das migrations anteriores (`public.tocar_atualizado_em`). Aqui
-- ela é mais que carimbo: é a única forma de responder "quando foi que este job
-- mudou de estado?" quando um envio começa a falhar em série e alguém precisa
-- descobrir desde quando.

drop trigger if exists reminder_jobs_atualizado_em on public.reminder_jobs;
create trigger reminder_jobs_atualizado_em
  before update on public.reminder_jobs
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- RLS — message_templates
-- ---------------------------------------------------------------------------

alter table public.message_templates enable row level security;

-- Não há coluna de paciente aqui, mas também não há motivo para o papel anônimo
-- ler a comunicação institucional da clínica antes de ela ser enviada.
revoke all on public.message_templates from anon;

-- LEITURA: toda a equipe autenticada. A secretária precisa saber o texto exato
-- que a paciente recebeu para continuar a conversa de onde a mensagem parou.
drop policy if exists "equipe le templates" on public.message_templates;
create policy "equipe le templates"
  on public.message_templates for select using (auth.uid() is not null);

-- ESCRITA: exclusiva da Dra. As três policies abaixo exigem is_dra().
--
-- O argumento aqui não é de dado clínico — é de responsabilidade pela voz. O
-- texto sai assinado pela profissional, fala de cuidado pós-procedimento
-- ("evite exposição solar, calor intenso e exercícios pesados") e chega a todas
-- as pacientes de uma vez. Orientação de cuidado é ato clínico mesmo quando
-- escrita fora do prontuário, e quem responde por ela tem registro no CRO.
drop policy if exists "so a dra cria template" on public.message_templates;
create policy "so a dra cria template"
  on public.message_templates for insert with check (public.is_dra());

drop policy if exists "so a dra edita template" on public.message_templates;
create policy "so a dra edita template"
  on public.message_templates for update
  -- O `with check` repete a condição do `using` para que a linha não possa ser
  -- gravada num estado que a própria policy não deixaria ler de volta.
  using (public.is_dra()) with check (public.is_dra());

-- DELETE é da Dra., e mesmo para ela é o caminho errado: template apagado deixa
-- o worker sem o que enviar naquele tipo. Desligar se faz com `ativo = false`.
drop policy if exists "so a dra apaga template" on public.message_templates;
create policy "so a dra apaga template"
  on public.message_templates for delete using (public.is_dra());

-- ---------------------------------------------------------------------------
-- RLS — reminder_jobs
-- ---------------------------------------------------------------------------

alter table public.reminder_jobs enable row level security;

-- Fila de mensagens para pacientes: quem lê esta tabela sabe quem fez qual
-- procedimento e quando volta. Dado de saúde por associação, igual à agenda.
-- O papel anônimo não tem o que fazer aqui.
revoke all on public.reminder_jobs from anon;

-- LEITURA: toda a equipe autenticada. É o que responde "a paciente já recebeu a
-- confirmação?" antes de a secretária ligar — sem isso ela liga por cima de uma
-- mensagem que acabou de sair, ou não liga confiando numa que falhou.
drop policy if exists "equipe le lembretes" on public.reminder_jobs;
create policy "equipe le lembretes"
  on public.reminder_jobs for select using (auth.uid() is not null);

-- INSERT para a equipe autenticada, porque quem planeja lembrete é a Server
-- Action rodando com a sessão de quem operou: a secretária ao marcar a consulta
-- (`agendarConsulta`) e a Dra. ao registrar o atendimento
-- (`registrarAtendimento`). Negar aqui quebraria o agendamento inteiro para a
-- secretária, que é justamente quem marca consulta nesta clínica.
--
-- Não é escrita em dado clínico: o job é logística de envio — para quem, quando,
-- por qual canal. O conteúdo clínico da mensagem mora em `message_templates`, e
-- lá só a Dra. escreve.
drop policy if exists "equipe planeja lembretes" on public.reminder_jobs;
create policy "equipe planeja lembretes"
  on public.reminder_jobs for insert with check (auth.uid() is not null);

-- UPDATE para a equipe: cancelar o lembrete de uma consulta que a paciente
-- desmarcou por telefone é trabalho de secretária, e o caminho é
-- `status = 'cancelado'`. Quem marca 'enviado' é o worker, que roda com
-- service_role e não passa por RLS.
drop policy if exists "equipe cancela lembretes" on public.reminder_jobs;
create policy "equipe cancela lembretes"
  on public.reminder_jobs for update
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- DELETE é exclusivo da Dra., e mesmo assim não é o caminho normal: apagar o job
-- destrói o rastro de que uma mensagem foi enviada a uma paciente, e esse rastro
-- é o que sustenta "eu avisei" numa discussão sobre pós-procedimento. Cancelar
-- preserva; apagar não. A policy existe para o job criado por engano, não para
-- limpar histórico.
drop policy if exists "so a dra apaga lembrete" on public.reminder_jobs;
create policy "so a dra apaga lembrete"
  on public.reminder_jobs for delete using (public.is_dra());
