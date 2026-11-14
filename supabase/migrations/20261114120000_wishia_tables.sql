-- Wish.ia — tables et règles d'accès.
-- À exécuter dans l'éditeur SQL du projet Supabase « Divers.ia »
-- (le même que Coach.ia, Brain.ia, Inventory.ia et Pause : même compte).
-- Tout est préfixé "wishia_" : ce script ne touche à aucun objet des autres apps.
-- Il peut être relancé sans danger (if not exists / drop policy if exists).
--
-- Archivage (comme dans Coach.ia et Brain.ia) : rien n'est effacé.
-- « Supprimer » renseigne archived_at et l'élément est simplement masqué.
-- Il n'y a donc aucune règle de suppression (delete).

-- ---------------------------------------------------------------------------
-- Listes (catégories) : Sport, Maison, Tech, Mode…
-- ---------------------------------------------------------------------------

create table if not exists wishia_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wishia_lists_user_position on wishia_lists (user_id, position);

alter table wishia_lists enable row level security;

drop policy if exists "wishia_lists_select_own" on wishia_lists;
drop policy if exists "wishia_lists_insert_own" on wishia_lists;
drop policy if exists "wishia_lists_update_own" on wishia_lists;
create policy "wishia_lists_select_own" on wishia_lists
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "wishia_lists_insert_own" on wishia_lists
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "wishia_lists_update_own" on wishia_lists
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Objets
-- site = nom de domaine extrait de l'URL ; image_path = chemin dans le bucket
-- "wishia" ; image_source_url = adresse d'origine de la photo.
-- ---------------------------------------------------------------------------

create table if not exists wishia_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id uuid not null references wishia_lists(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  price numeric(10, 2) check (price is null or price >= 0),
  url text,
  site text,
  image_path text,
  image_source_url text,
  note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wishia_items_user_list on wishia_items (user_id, list_id);
create index if not exists wishia_items_user_created on wishia_items (user_id, created_at desc);

alter table wishia_items enable row level security;

-- Un objet ne peut être rangé que dans une de ses propres listes.
drop policy if exists "wishia_items_select_own" on wishia_items;
drop policy if exists "wishia_items_insert_own" on wishia_items;
drop policy if exists "wishia_items_update_own" on wishia_items;
create policy "wishia_items_select_own" on wishia_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "wishia_items_insert_own" on wishia_items
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from wishia_lists l where l.id = list_id and l.user_id = (select auth.uid()))
  );
create policy "wishia_items_update_own" on wishia_items
  for update to authenticated using ((select auth.uid()) = user_id) with check (
    (select auth.uid()) = user_id
    and exists (select 1 from wishia_lists l where l.id = list_id and l.user_id = (select auth.uid()))
  );

-- updated_at tenu à jour automatiquement à chaque modification.
create or replace function wishia_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wishia_items_set_updated_at on wishia_items;
create trigger wishia_items_set_updated_at
  before update on wishia_items
  for each row execute function wishia_set_updated_at();
