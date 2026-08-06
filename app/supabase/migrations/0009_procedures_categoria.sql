-- 0009_procedures_categoria.sql
-- Categoria opcional no catálogo de procedimentos.
-- Aparece sob o nome na tela de Procedimentos (rótulo miúdo).
-- Valores de exemplo dos mockups: Diagnóstico, Injetáveis, Bioestimulação,
-- Hidratação profunda, Sustentação, Rejuvenescimento.
--
-- Idempotente: `add column if not exists`.
-- AVISO: escreva e avise; NÃO aplique automaticamente (regra do projeto).

alter table public.procedures
  add column if not exists categoria text;
