-- 0016_forma_restante.sql
-- Forma de pagamento do restante após a entrada (PIX à vista ou cartão).
-- Idempotente: add column if not exists + constraint em bloco do $$.
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

alter table public.patient_charges
  add column if not exists forma_restante text;

comment on column public.patient_charges.forma_restante is
  'Como o restante após a entrada será pago: pix | cartao.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'patient_charges_forma_restante'
  ) then
    alter table public.patient_charges
      add constraint patient_charges_forma_restante
      check (
        forma_restante is null
        or forma_restante in ('pix', 'cartao')
      );
  end if;
end
$$;
