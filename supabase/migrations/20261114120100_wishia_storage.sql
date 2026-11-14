-- Wish.ia — bucket des photos et ses règles d'accès.
-- À exécuter après 20261114120000_wishia_tables.sql, dans l'éditeur SQL
-- du projet Supabase « Divers.ia ». Peut être relancé sans danger.
--
-- Bucket privé "wishia" : images uniquement, 5 Mo au plus par fichier.
-- Chaque photo est rangée dans un dossier au nom de son propriétaire :
--   <user_id>/<item_id>.jpg
-- Les règles ci-dessous ne concernent que ce bucket (bucket_id = 'wishia') :
-- elles ne changent rien aux autres buckets du projet.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wishia', 'wishia', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "wishia_storage_select_own" on storage.objects;
drop policy if exists "wishia_storage_insert_own" on storage.objects;
drop policy if exists "wishia_storage_update_own" on storage.objects;
drop policy if exists "wishia_storage_delete_own" on storage.objects;

create policy "wishia_storage_select_own" on storage.objects
  for select to authenticated using (
    bucket_id = 'wishia' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "wishia_storage_insert_own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'wishia' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "wishia_storage_update_own" on storage.objects
  for update to authenticated using (
    bucket_id = 'wishia' and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'wishia' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
-- Sert uniquement à retirer la photo d'un objet depuis le formulaire.
create policy "wishia_storage_delete_own" on storage.objects
  for delete to authenticated using (
    bucket_id = 'wishia' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
