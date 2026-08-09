-- 0019_marca_clinica.sql
-- Foto do login + logo: Storage público + colunas em clinic_settings.
-- Substitui o mapa em disco `public/marca/` (some no Docker standalone).
--
-- AVISO: quem escreve o arquivo avisa; aplicar via MCP ou pelo dono.
-- Nunca `supabase db push` pela IA.

-- ---------------------------------------------------------------------------
-- clinic_settings — URLs públicas da marca
-- ---------------------------------------------------------------------------

alter table public.clinic_settings
  add column if not exists hero_url text,
  add column if not exists logo_url text;

comment on column public.clinic_settings.hero_url is
  'URL pública da foto do painel esquerdo do login (bucket marca-clinica).';

comment on column public.clinic_settings.logo_url is
  'URL pública da logo (login + sidebar). Bucket marca-clinica.';

-- ---------------------------------------------------------------------------
-- Storage: bucket público (login não autenticado precisa enxergar a imagem)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marca-clinica',
  'marca-clinica',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura aberta: a URL pública do Storage depende desta policy.
drop policy if exists "leitura publica da marca" on storage.objects;
create policy "leitura publica da marca"
  on storage.objects for select
  using (bucket_id = 'marca-clinica');

drop policy if exists "so a dra sobe marca" on storage.objects;
create policy "so a dra sobe marca"
  on storage.objects for insert
  with check (
    bucket_id = 'marca-clinica'
    and public.is_dra()
  );

drop policy if exists "so a dra atualiza marca" on storage.objects;
create policy "so a dra atualiza marca"
  on storage.objects for update
  using (
    bucket_id = 'marca-clinica'
    and public.is_dra()
  )
  with check (
    bucket_id = 'marca-clinica'
    and public.is_dra()
  );

drop policy if exists "so a dra apaga marca" on storage.objects;
create policy "so a dra apaga marca"
  on storage.objects for delete
  using (
    bucket_id = 'marca-clinica'
    and public.is_dra()
  );
