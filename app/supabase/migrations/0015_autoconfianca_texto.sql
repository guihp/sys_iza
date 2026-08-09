-- 0015_autoconfianca_texto.sql
-- Impacto na autoconfiança deixa de ser escala 0–10 (smallint) e passa a
-- texto livre — número e/ou notas da Dra.
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

alter table public.anamneses
  drop constraint if exists anamneses_autoconfianca_0_10;

alter table public.anamneses
  alter column autoconfianca_rosto type text
  using (
    case
      when autoconfianca_rosto is null then null
      else autoconfianca_rosto::text
    end
  );

comment on column public.anamneses.autoconfianca_rosto is
  'Impacto na autoconfiança — texto livre (ex.: nota 0–10 e/ou observação).';
