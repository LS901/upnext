-- "Other": a user's own entries. A manual item is an `items` row owned by one
-- user (provider 'manual', media type 'other'); the enum values are added in the
-- previous migration. Unlike the catalogue, its title is the owner's own text, so
-- it is visible only as far as the owner's library is (INV-002).

alter table public.items
  add column owner_id uuid references auth.users (id) on delete cascade,
  add column length_note text check (char_length(length_note) <= 100),
  -- manual exactly when owned, and manual exactly when Other
  add constraint items_manual_has_owner check ((provider = 'manual') = (owner_id is not null)),
  add constraint items_manual_is_other check ((provider = 'manual') = (media_type = 'other'));

create index items_owner_id_idx on public.items (owner_id) where owner_id is not null;

-- The catalogue stays readable by everyone (owner_id is null). A manual item is
-- readable by its owner, or by anyone while the owner's library isn't private,
-- the same rule as library_entries.
drop policy "items are readable by everyone" on public.items;

create policy "items are readable by everyone, manual ones by library visibility"
  on public.items for select
  to anon, authenticated
  using (
    owner_id is null
    or owner_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = items.owner_id and not p.library_private
    )
  );

-- Users write only their own manual items; every other item is still written by
-- the service role alone.
create policy "owner inserts own manual items"
  on public.items for insert
  to authenticated
  with check (
    provider = 'manual' and media_type = 'other' and owner_id = (select auth.uid())
  );

create policy "owner updates own manual items"
  on public.items for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    provider = 'manual' and media_type = 'other' and owner_id = (select auth.uid())
  );

create policy "owner deletes own manual items"
  on public.items for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- An entry can be Other, too.
alter table public.library_entries
  drop constraint library_entries_item_media_type_check,
  add constraint library_entries_item_media_type_check
    check (item_media_type in ('movie', 'game', 'book', 'other'));
