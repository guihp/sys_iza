-- 0001_extensions_e_enums.sql
-- Extensões e tipos enumerados base do sistema da Clínica Izadora.
-- Escrito de forma idempotente: o banco de destino é compartilhado com outros
-- serviços, então cada objeto só é criado se ainda não existir.

create extension if not exists "pgcrypto";

-- Papéis do sistema: exatamente dois, nenhum outro.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'user_role' and n.nspname = 'public'
  ) then
    create type public.user_role as enum ('dra', 'secretaria');
  end if;
end
$$;

-- Estágios do funil, nesta ordem.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'patient_stage' and n.nspname = 'public'
  ) then
    create type public.patient_stage as enum (
      'lead', 'contato', 'agendado', 'compareceu', 'paciente', 'retorno', 'descartado'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'appointment_status' and n.nspname = 'public'
  ) then
    create type public.appointment_status as enum (
      'agendado', 'confirmado', 'compareceu', 'faltou', 'cancelado'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'reminder_kind' and n.nspname = 'public'
  ) then
    create type public.reminder_kind as enum (
      'confirmacao', 'vespera_curta', 'pos_procedimento', 'avaliacao', 'retorno'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'reminder_channel' and n.nspname = 'public'
  ) then
    create type public.reminder_channel as enum ('whatsapp', 'email');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'reminder_status' and n.nspname = 'public'
  ) then
    create type public.reminder_status as enum ('pendente', 'enviado', 'falhou', 'cancelado');
  end if;
end
$$;
