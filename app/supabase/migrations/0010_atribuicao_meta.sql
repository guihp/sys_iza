-- 0010_atribuicao_meta.sql
-- Atribuição de anúncio da Meta e a fila de conversões que volta para lá.
-- Idempotente: tipo criado dentro de "do $$ ... $$" que checa pg_type, tabelas e
-- índices com "if not exists", constraints dentro de "do $$ ... $$" que checa
-- pg_constraint, policies recriadas com "drop policy if exists" antes do
-- "create policy".
--
-- Duas tabelas, e elas olham para lados opostos:
--
--   `lead_attribution` é o que ENTRA. Uma linha por pessoa que chegou por um
--   anúncio de clique-para-WhatsApp. Quem grava não é este app: é o fluxo do
--   n8n, que lê o webhook `messages.upsert` da Evolution e extrai o bloco
--   `data.contextInfo.externalAdReply`. A mensagem chega antes de a paciente
--   existir no sistema, então a chave aqui é o TELEFONE, e o vínculo com
--   `patients` acontece depois — às vezes minutos depois, às vezes nunca.
--
--   `meta_conversion_jobs` é o que SAI. Fila de trabalho, gêmea de
--   `reminder_jobs` (0007) inclusive na mecânica de reserva atômica (0008): uma
--   linha por evento de conversão a enviar para a CAPI, consumida pelo mesmo
--   worker.
--
-- O que decide QUAIS eventos existem não mora aqui. É regra pura, vive em
-- src/domain/marketing/plan-conversions.ts e é coberta por teste unitário sem
-- banco — incluindo as duas travas da LGPD (sem `consentimento_lgpd_em` não sai
-- evento; sem `ctwa_clid` também não). O que este arquivo garante é o que só o
-- banco garante: que a atribuição não migre de anúncio sozinha e que
-- reprocessar não mande o mesmo evento duas vezes.

-- ---------------------------------------------------------------------------
-- meta_conversion_status
-- ---------------------------------------------------------------------------
-- Enum próprio, e não o `reminder_status` de 0001, embora hoje os rótulos
-- coincidam. São duas filas com ciclos de vida independentes: o dia em que uma
-- delas precisar de um estado a mais — 'descartado_sem_consentimento', digamos —
-- o enum compartilhado obrigaria a outra a conviver com um valor que ela nunca
-- usa, e o `check` de nenhuma das duas conseguiria dizer isso.
--
-- Nota sobre a pegadinha de 0008: lá o problema era `alter type ... add value`,
-- cujo valor novo não pode ser USADO na mesma transação — por isso aquela
-- migration só adicionou o rótulo e não pôde criar índice sobre ele. Aqui é
-- `create type`, caso diferente: o Postgres libera o uso dos rótulos de um enum
-- criado na própria transação, e é por isso que o índice parcial em
-- `status = 'pendente'`, lá embaixo, é seguro neste arquivo.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'meta_conversion_status' and n.nspname = 'public'
  ) then
    create type public.meta_conversion_status as enum (
      'pendente', 'enviando', 'enviado', 'falhou', 'cancelado'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- lead_attribution
-- ---------------------------------------------------------------------------

create table if not exists public.lead_attribution (
  id uuid primary key default gen_random_uuid(),

  -- A chave de verdade desta tabela. Em E.164 (+5511987654321), o mesmo formato
  -- de `patients.telefone`, com o mesmo check — ver `lead_attribution_telefone_e164`.
  -- Quem normaliza é o n8n antes de gravar (o `remoteJid` da Evolution vem como
  -- `5511987654321@s.whatsapp.net`, e pode vir como LID quando
  -- `addressingMode = 'lid'`, caso em que o certo é o `remoteJidAlt`).
  -- O check aqui é a rede embaixo: sem formato único, o índice único não
  -- deduplica nada e a mesma pessoa vira duas atribuições.
  telefone text not null,

  -- `externalAdReply.ctwaClid` — o identificador do clique no anúncio. É ele que
  -- a Meta usa para casar a conversão com o anúncio que a gerou; sem ele o
  -- evento é ruído para lá e exposição de dado para nada. Não anulável: linha
  -- sem clid não tem por que existir, e o fluxo do n8n só grava quando o bloco
  -- `externalAdReply` traz o campo (mensagem sem ele é conversa orgânica).
  ctwa_clid text not null,

  -- `externalAdReply.sourceId`. É a coluna por onde a página /marketing cruza o
  -- gasto vindo da Marketing API com o funil daqui. Anulável porque o webhook
  -- pode entregar o clid sem o id do anúncio, e perder a atribuição inteira por
  -- causa disso seria pior do que ficar sem saber qual anúncio foi.
  ad_id text,

  -- `externalAdReply.sourceApp`: 'instagram' ou 'facebook'. Ver o check.
  source_app text,

  -- O que a pessoa viu antes de mandar mensagem: título, corpo, destino e a
  -- saudação pré-preenchida do anúncio. Não são dados operacionais — são o que
  -- permite ler a tabela e entender de qual criativo veio o lead sem ir ao
  -- Gerenciador. Todos anuláveis: o webhook entrega o que tem.
  ad_title text,
  ad_body text,
  source_url text,
  greeting_message text,

  -- `data.pushName`: o nome que a pessoa usa no WhatsApp. Serve à secretária
  -- para saber com quem está falando antes de existir cadastro. Não é o nome do
  -- cadastro e não deve virar um — quem digita `nome_completo` é gente.
  push_name text,

  -- `data.messageTimestamp`, que vem em SEGUNDOS. Multiplicar por 1000 na hora
  -- errada joga o evento para 1970 e a Meta descarta; a conversão é
  -- responsabilidade do n8n, e o tipo aqui é timestamptz como no resto do
  -- sistema.
  primeiro_contato_em timestamptz not null default now(),

  -- ------------------------------------------------------------------------
  -- O vínculo com a paciente
  -- ------------------------------------------------------------------------
  -- A FK mora AQUI, e não como uma coluna `lead_attribution_id` em `patients`.
  -- Três motivos, em ordem de peso:
  --
  --   1. A ordem dos acontecimentos. Esta linha nasce ANTES de a paciente
  --      existir — é esse o fato que originou a tabela. Uma coluna em `patients`
  --      só poderia ser preenchida no momento do cadastro, e quando a mensagem
  --      chega DEPOIS de a secretária ter cadastrado a pessoa à mão (que
  --      acontece: ela liga, é cadastrada, e só então manda WhatsApp pelo
  --      anúncio) nada mais reescreveria aquela linha de `patients`. Com a FK
  --      deste lado, quem chega por último resolve o vínculo pelo telefone,
  --      seja quem for.
  --
  --   2. Quem escreve. Preencher uma coluna em `patients` obrigaria o n8n a
  --      escrever na tabela de cadastro — a mais sensível do sistema — por uma
  --      necessidade de marketing. Com a FK aqui, o n8n toca uma tabela só, que
  --      é a dele.
  --
  --   3. Cardinalidade. Uma pessoa pode falar de dois números (o próprio e o do
  --      marido) e gerar duas atribuições para o mesmo cadastro. Do lado de
  --      `patients` isso exigiria uma terceira tabela; deste lado é só duas
  --      linhas apontando para o mesmo `patient_id`.
  --
  -- `on delete cascade`, e não `set null`: esta linha guarda um telefone, que é
  -- dado pessoal. Apagar a paciente e deixar o telefone dela vivo numa tabela de
  -- marketing é cumprir o direito ao esquecimento pela metade. O custo é real e
  -- é aceito conscientemente — o anúncio perde o desfecho que gerou —, mas ele
  -- desaparece junto com a própria paciente das contagens do funil, então os
  -- números continuam coerentes entre si.
  patient_id uuid references public.patients(id) on delete cascade,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

do $$
begin
  -- Mesmo formato e mesma justificativa de `patients_telefone_e164` (0004): é o
  -- formato único que faz o índice único deduplicar. Aqui pesa ainda mais, porque
  -- o telefone é a ÚNICA chave de junção entre esta tabela e o cadastro.
  if not exists (
    select 1 from pg_constraint where conname = 'lead_attribution_telefone_e164'
  ) then
    alter table public.lead_attribution add constraint lead_attribution_telefone_e164
      check (telefone ~ '^\+[1-9]\d{7,14}$');
  end if;

  -- String vazia não é clid; é `not null` satisfeito por acidente. Uma linha
  -- assim passaria pelo `not null`, ocuparia o índice único do telefone e
  -- bloquearia para sempre a gravação da atribuição de verdade daquela pessoa —
  -- por causa do `on conflict do nothing`, que é justamente o que não sobrescreve.
  if not exists (
    select 1 from pg_constraint where conname = 'lead_attribution_clid_nao_vazio'
  ) then
    alter table public.lead_attribution add constraint lead_attribution_clid_nao_vazio
      check (length(btrim(ctwa_clid)) > 0);
  end if;

  -- Os dois valores que a Evolution entrega em `sourceApp`. Não é enum porque a
  -- Meta pode acrescentar uma superfície nova (Threads, um dia) e trocar um check
  -- é uma migration trivial, enquanto `alter type ... add value` arrasta a
  -- restrição de transação descrita em 0008.
  if not exists (
    select 1 from pg_constraint where conname = 'lead_attribution_source_app_conhecido'
  ) then
    alter table public.lead_attribution add constraint lead_attribution_source_app_conhecido
      check (source_app is null or source_app in ('instagram', 'facebook'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Um registro por telefone
-- ---------------------------------------------------------------------------
-- Único e NÃO parcial, ao contrário de `patients_telefone_unico`: lá o telefone é
-- opcional (existe lead sem número), aqui ele é `not null` e é a identidade da
-- linha.
--
-- É este índice que o `on conflict (telefone) do nothing` do n8n usa. Sem ele o
-- `on conflict` não teria em que se apoiar e a segunda mensagem da mesma pessoa
-- criaria uma segunda linha — com o clid do anúncio novo. A partir daí a
-- atribuição dela dependeria de qual das duas linhas o relatório lesse primeiro.
create unique index if not exists lead_attribution_telefone_unico
  on public.lead_attribution (telefone);

-- Não há índice único em `ctwa_clid`, e é decisão, não esquecimento. Ele parece
-- naturalmente único (um clique, uma pessoa) e o índice pegaria dados corrompidos
-- — mas ao custo de transformar essa corrupção num erro 23505 que ABORTA o insert
-- do n8n, em vez de ser ignorado pelo `on conflict (telefone)`. A unicidade que
-- importa é a do telefone; esta seria uma segunda porta por onde o fluxo do n8n
-- poderia quebrar em produção sem ninguém olhando.

-- ---------------------------------------------------------------------------
-- A trava do ctwa_clid
-- ---------------------------------------------------------------------------
-- O índice único acima só funciona se quem grava usar `on conflict do nothing`.
-- Um `do update` — que é o que qualquer pessoa escreve por reflexo ao consertar
-- um fluxo do n8n às onze da noite — passaria por ele sem ruído e reescreveria o
-- clid com o da mensagem mais recente. O efeito não aparece em lugar nenhum: a
-- tabela continua com uma linha por telefone, os relatórios continuam somando, e
-- a paciente simplesmente passa a ser creditada ao anúncio errado.
--
-- Por isso a garantia não fica na forma do insert. Fica aqui, num trigger que
-- recusa a alteração do bloco que descreve QUEM TROUXE a pessoa. As colunas de
-- fora desse bloco — `patient_id`, `push_name`, os textos do criativo — continuam
-- alteráveis, porque o vínculo com o cadastro é justamente o que se resolve
-- depois.
--
-- O `is distinct from` (e não `<>`) é o que faz a comparação funcionar com nulo:
-- `null <> null` é null, que num `if` não dispara, e um update que apagasse o
-- `ad_id` passaria batido.

create or replace function public.congelar_atribuicao() returns trigger
language plpgsql as $$
begin
  if new.ctwa_clid is distinct from old.ctwa_clid then
    raise exception
      'ctwa_clid é imutável: a atribuição da % pertence ao primeiro anúncio que a trouxe', old.telefone
      using errcode = 'check_violation';
  end if;
  if new.ad_id is distinct from old.ad_id then
    raise exception 'ad_id é imutável: ele descreve o mesmo clique que o ctwa_clid'
      using errcode = 'check_violation';
  end if;
  if new.telefone is distinct from old.telefone then
    raise exception 'telefone é imutável: é a identidade da linha de atribuição'
      using errcode = 'check_violation';
  end if;
  if new.primeiro_contato_em is distinct from old.primeiro_contato_em then
    raise exception 'primeiro_contato_em é imutável: é o instante do clique, não um carimbo de edição'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists lead_attribution_congelada on public.lead_attribution;
create trigger lead_attribution_congelada
  before update on public.lead_attribution
  for each row execute function public.congelar_atribuicao();

-- ---------------------------------------------------------------------------
-- Índices de leitura
-- ---------------------------------------------------------------------------

-- A consulta da página /marketing: "por anúncio, quantos leads chegaram no
-- período". Composto e nesta ordem porque o agrupamento é sempre por `ad_id` e o
-- recorte é sempre de datas dentro dele. Parcial porque a linha sem `ad_id`
-- nunca aparece nesse cruzamento — ela existe, conta como contato, mas não tem
-- anúncio a que ser somada.
create index if not exists lead_attribution_anuncio_idx
  on public.lead_attribution (ad_id, primeiro_contato_em desc)
  where ad_id is not null;

-- O caminho inverso: partindo da paciente, de qual anúncio ela veio. É o que a
-- ficha usa. Parcial porque a maioria das linhas nunca vira paciente — a pessoa
-- manda mensagem, não agenda, e o `patient_id` fica nulo para sempre.
create index if not exists lead_attribution_patient_idx
  on public.lead_attribution (patient_id)
  where patient_id is not null;

-- ---------------------------------------------------------------------------
-- atualizado_em
-- ---------------------------------------------------------------------------
-- `public.tocar_atualizado_em`, a mesma de 0004. Aqui ela responde a uma pergunta
-- específica: quando foi que esta atribuição foi ligada a um cadastro? O
-- `criado_em` é do webhook, o `atualizado_em` é do vínculo.

drop trigger if exists lead_attribution_atualizado_em on public.lead_attribution;
create trigger lead_attribution_atualizado_em
  before update on public.lead_attribution
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- RLS — lead_attribution
-- ---------------------------------------------------------------------------

alter table public.lead_attribution enable row level security;

-- Telefone e nome de WhatsApp de gente que procurou uma clínica de estética. É
-- PII, e o suficiente para inferir interesse em procedimento. O papel anônimo não
-- tem o que fazer aqui — como em `patients`, isso é defesa em profundidade: o
-- Postgres nega por privilégio antes de sequer avaliar a policy.
revoke all on public.lead_attribution from anon;

-- LEITURA: toda a equipe autenticada. É o que responde "essa pessoa que está
-- ligando veio de anúncio?" antes de a secretária cadastrar, e é o que a página
-- /marketing lê para cruzar com o gasto.
drop policy if exists "equipe le atribuicao" on public.lead_attribution;
create policy "equipe le atribuicao"
  on public.lead_attribution for select using (auth.uid() is not null);

-- ESCRITA: NÃO EXISTE POLICY, e isso é deliberado.
--
-- Quem grava nesta tabela é o n8n, com a chave `service_role`, que não passa por
-- RLS — policy nenhuma se aplica a ele. Escrever uma "policy de insert para a
-- equipe" aqui daria a impressão de que alguém a usa; ninguém usa, e ela só
-- abriria caminho para uma secretária corrigir à mão uma atribuição que é fato
-- registrado, não campo de cadastro.
--
-- O vínculo com `patients` (a coluna `patient_id`) também é resolvido por
-- `service_role`, pelo client admin do app (src/lib/supabase/admin.ts, o mesmo do
-- worker): é uma dedução a partir do telefone, feita pelo sistema, não uma
-- escolha de quem opera.
--
-- DELETE é a exceção, e é da Dra., por um motivo concreto: uma pessoa que mandou
-- mensagem pelo anúncio e NUNCA virou paciente não tem linha em `patients`, então
-- o cascade não a alcança. Se ela pedir a exclusão dos dados dela, este é o único
-- caminho para atender o pedido dentro do sistema.
drop policy if exists "so a dra apaga atribuicao" on public.lead_attribution;
create policy "so a dra apaga atribuicao"
  on public.lead_attribution for delete using (public.is_dra());

-- ---------------------------------------------------------------------------
-- meta_conversion_jobs
-- ---------------------------------------------------------------------------
-- Gêmea de `reminder_jobs`: mesma mecânica de reserva atômica, mesma coluna de
-- idempotência, mesmo worker. O que muda é o destinatário — em vez de uma
-- paciente do outro lado do WhatsApp, é a Conversions API da Meta.

create table if not exists public.meta_conversion_jobs (
  id uuid primary key default gen_random_uuid(),

  -- `on delete cascade` pelo mesmo argumento de LGPD de `lead_attribution`: o
  -- payload guarda o hash do telefone e o clid da pessoa. Some a paciente, some o
  -- que sobrou dela na fila. Um evento pendente de alguém que pediu exclusão é
  -- exatamente o que não pode sair depois.
  patient_id uuid not null references public.patients(id) on delete cascade,

  -- Nome do evento padrão da Meta: 'Lead', 'Contact', 'Schedule',
  -- 'CompleteRegistration', 'Purchase'. Text com check, e não enum: a lista é
  -- vocabulário DA META, não do domínio da clínica, e ela muda no ritmo dela.
  -- Trocar um check é uma migration trivial; `alter type ... add value` traz
  -- junto a restrição de transação de 0008.
  evento text not null,

  -- ------------------------------------------------------------------------
  -- As duas chaves, que parecem uma
  -- ------------------------------------------------------------------------
  -- Ambas saem do mesmo par `(patient_id, evento)` e são calculadas em
  -- src/domain/marketing/plan-conversions.ts. Elas existem separadas porque são
  -- lidas por dois olhos diferentes:
  --
  --   `chave_idempotencia` é NOSSA. Legível ('uuid:Schedule'), com o `unique`
  --   que transforma reprocessamento em no-op — o mesmo desenho de
  --   `reminder_jobs`, e pelo mesmo motivo: planejar é "ler, decidir, gravar", e
  --   entre o ler e o gravar cabe outra requisição. Arrastar o cartão duas vezes
  --   no kanban não pode virar dois eventos.
  --
  --   `event_id` é o que VAI PARA A META, e é o SHA-256 daquela mesma string. A
  --   Meta usa esse campo para deduplicar reenvio do lado dela, então ele precisa
  --   ser estável — mas não precisa ser legível, e mandar o uuid interno da
  --   paciente em claro para um terceiro seria entregar de graça um identificador
  --   estável capaz de casar bases. O hash é igualmente estável e não diz nada.
  chave_idempotencia text not null unique,
  event_id text not null,

  -- `event_time` do evento, em timestamptz aqui e convertido para segundos pelo
  -- adaptador. Separado de `criado_em` de propósito: um job que fica preso na
  -- fila por três horas ainda descreve um agendamento que aconteceu às 14h.
  ocorrido_em timestamptz not null,

  -- O corpo do evento, congelado no instante em que o funil andou.
  --
  -- Congelar, e não montar na hora do envio, é o que impede uma edição posterior
  -- de reescrever o passado: mudar o preço do procedimento no catálogo em outubro
  -- não pode alterar o valor do `Purchase` de agosto que já está na fila.
  --
  -- O que cabe aqui está definido pela restrição legal do plano e é curto: tipo
  -- do evento, instante, identificadores com hash, o clid e — só no `Purchase` —
  -- um valor arredondado à centena. NOME DE PROCEDIMENTO, OBSERVAÇÃO CLÍNICA E
  -- QUALQUER CAMPO DE PRONTUÁRIO ESTÃO FORA. Quem garante isso é o domínio, que
  -- sequer aceita esses campos na entrada, com teste que prova que não vazam.
  payload jsonb not null,

  status public.meta_conversion_status not null default 'pendente',

  -- Quantas vezes o worker já tentou. Alimenta o backoff e o desistir depois de
  -- N falhas, igual à fila de lembretes.
  tentativas integer not null default 0,

  enviado_em timestamptz,

  -- Última mensagem de erro da CAPI. Aparece na tela de configuração, e é por
  -- isso que o adaptador tem de sanitizar antes de gravar: o token de acesso vai
  -- na querystring da chamada, e um erro que ecoe a URL inteira despejaria o
  -- token nesta coluna, que a equipe inteira lê.
  erro text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

do $$
begin
  -- Os cinco eventos do mapa de estágios do plano. `descartado` e `retorno` não
  -- aparecem porque não geram evento nenhum — ver plan-conversions.ts.
  if not exists (
    select 1 from pg_constraint where conname = 'meta_conversion_jobs_evento_conhecido'
  ) then
    alter table public.meta_conversion_jobs add constraint meta_conversion_jobs_evento_conhecido
      check (evento in ('Lead', 'Contact', 'Schedule', 'CompleteRegistration', 'Purchase'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'meta_conversion_jobs_tentativas_nao_negativas'
  ) then
    alter table public.meta_conversion_jobs add constraint meta_conversion_jobs_tentativas_nao_negativas
      check (tentativas >= 0);
  end if;

  -- Mesma trava de `reminder_jobs_enviado_tem_carimbo`: é o status que impede o
  -- reenvio, então ele não pode existir sem o carimbo que o justifica. Sem isso
  -- ninguém responde "quando este evento chegou na Meta?" ao comparar com o
  -- Teste de Eventos do Gerenciador — que é a única fonte de verdade do outro
  -- lado.
  if not exists (
    select 1 from pg_constraint where conname = 'meta_conversion_jobs_enviado_tem_carimbo'
  ) then
    alter table public.meta_conversion_jobs add constraint meta_conversion_jobs_enviado_tem_carimbo
      check (status <> 'enviado' or enviado_em is not null);
  end if;

  -- `event_id` é o que a Meta usa para deduplicar. Vazio, ela trata cada
  -- retentativa como conversão nova e a mesma paciente vira três `Schedule`.
  if not exists (
    select 1 from pg_constraint where conname = 'meta_conversion_jobs_event_id_nao_vazio'
  ) then
    alter table public.meta_conversion_jobs add constraint meta_conversion_jobs_event_id_nao_vazio
      check (length(btrim(event_id)) > 0);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

-- A varredura do worker: "o que está pendente". Parcial em `status = 'pendente'`
-- pela mesma razão de `reminder_jobs_fila_idx` — job enviado nunca mais é lido
-- pela fila e com o tempo será a esmagadora maioria das linhas.
--
-- É seguro aqui, e não era em 0008, porque o enum é CRIADO nesta migration em vez
-- de receber um rótulo novo por `alter type`. Ver a nota no topo do arquivo.
--
-- Ordena por `ocorrido_em` e não por `criado_em`: numa fila represada, o evento
-- mais antigo é o que mais corre risco de estourar a janela de atribuição da Meta,
-- então é ele que sai primeiro.
create index if not exists meta_conversion_jobs_fila_idx
  on public.meta_conversion_jobs (ocorrido_em)
  where status = 'pendente';

-- "O que já mandamos sobre esta paciente", do mais recente para o mais antigo.
-- É como se confere na ficha se o `Purchase` dela chegou a sair.
create index if not exists meta_conversion_jobs_patient_idx
  on public.meta_conversion_jobs (patient_id, ocorrido_em desc);

-- ---------------------------------------------------------------------------
-- atualizado_em
-- ---------------------------------------------------------------------------

drop trigger if exists meta_conversion_jobs_atualizado_em on public.meta_conversion_jobs;
create trigger meta_conversion_jobs_atualizado_em
  before update on public.meta_conversion_jobs
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- RLS — meta_conversion_jobs
-- ---------------------------------------------------------------------------

alter table public.meta_conversion_jobs enable row level security;

-- O payload guarda o hash do telefone e o clid, e a linha em si diz que fulana
-- agendou e pagou. Dado de saúde por associação, como a agenda e a fila de
-- lembretes.
revoke all on public.meta_conversion_jobs from anon;

-- LEITURA: toda a equipe autenticada. É o que a tela de configuração mostra para
-- responder "os eventos estão saindo?" sem obrigar a abrir o Gerenciador.
drop policy if exists "equipe le conversoes" on public.meta_conversion_jobs;
create policy "equipe le conversoes"
  on public.meta_conversion_jobs for select using (auth.uid() is not null);

-- INSERT para a equipe autenticada, pelo mesmo motivo de `reminder_jobs`: quem
-- enfileira o evento é a Server Action rodando com a sessão de quem operou — a
-- secretária arrastando o cartão de 'contato' para 'agendado'. Negar aqui
-- quebraria o kanban para ela, que é justamente quem move o funil.
--
-- Não é escrita em dado clínico. A linha é logística de envio, e o que vai nela
-- está limitado pelo domínio, não pela boa vontade do caller.
drop policy if exists "equipe enfileira conversoes" on public.meta_conversion_jobs;
create policy "equipe enfileira conversoes"
  on public.meta_conversion_jobs for insert with check (auth.uid() is not null);

-- UPDATE para a equipe: desligar o envio na tela de configuração cancela o que
-- está pendente (`status = 'cancelado'`), e esse é o efeito "valendo na hora" que
-- a restrição legal exige. Quem marca 'enviado' é o worker, com service_role, que
-- não passa por RLS.
drop policy if exists "equipe cancela conversoes" on public.meta_conversion_jobs;
create policy "equipe cancela conversoes"
  on public.meta_conversion_jobs for update
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- DELETE é da Dra., e não é o caminho normal: apagar o job destrói o rastro de
-- que um dado de uma paciente foi enviado para um terceiro, e é justamente esse
-- rastro que responde a um pedido de prestação de contas sob a LGPD. Cancelar
-- preserva; apagar não.
drop policy if exists "so a dra apaga conversao" on public.meta_conversion_jobs;
create policy "so a dra apaga conversao"
  on public.meta_conversion_jobs for delete using (public.is_dra());
