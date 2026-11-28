-- Named lists: a user groups their own library entries (ruling Q0-c), and each
-- list is public or private. Others read a list only while it's public AND the
-- owner's library is public (ruling Q0-d, INV-002); only the owner writes (INV-001).

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lists_user_id_idx on public.lists (user_id);

create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function public.set_updated_at();

alter table public.lists enable row level security;

create policy "lists are readable by owner, or when public in a public library"
  on public.lists for select
  to anon, authenticated
  using (
    user_id = (select auth.uid())
    or (
      not is_private
      and exists (
        select 1 from public.profiles p
        where p.id = lists.user_id and not p.library_private
      )
    )
  );

create policy "owner inserts own lists"
  on public.lists for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner updates own lists"
  on public.lists for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner deletes own lists"
  on public.lists for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- One row per entry on a list. Deleting the entry (or the list) takes it off.
create table public.list_entries (
  list_id uuid not null references public.lists (id) on delete cascade,
  entry_id uuid not null references public.library_entries (id) on delete cascade,
  -- Finite (Postgres sorts NaN above Infinity, so the bounds refuse all three):
  -- a NaN or infinite place would poison max(), and so every later add's "at the end".
  position double precision not null check (position > '-Infinity' and position < 'Infinity'),
  created_at timestamptz not null default now(),
  primary key (list_id, entry_id)
);

-- The entry foreign key's cascade looks rows up by entry.
create index list_entries_entry_id_idx on public.list_entries (entry_id);

alter table public.list_entries enable row level security;

-- Select follows the list: the same rule, spelled out so it never depends on
-- another table's policy.
create policy "list entries are readable as their list is"
  on public.list_entries for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_entries.list_id
        and (
          l.user_id = (select auth.uid())
          or (
            not l.is_private
            and exists (
              select 1 from public.profiles p
              where p.id = l.user_id and not p.library_private
            )
          )
        )
    )
  );

-- Hide whether a row exists: the check needs both the list and the entry to be
-- the caller's, so it refuses (42501) before the primary key (23505) or a foreign
-- key (23503) could say anything about someone else's list.
create policy "owner adds own entries to own lists"
  on public.list_entries for insert
  to authenticated
  with check (
    exists (
      select 1 from public.lists l
      where l.id = list_entries.list_id and l.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.library_entries e
      where e.id = list_entries.entry_id and e.user_id = (select auth.uid())
    )
  );

create policy "owner takes entries off own lists"
  on public.list_entries for delete
  to authenticated
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_entries.list_id and l.user_id = (select auth.uid())
    )
  );

-- A note holds up to 2000 characters (the Note box on My library).
alter table public.entry_notes
  add constraint entry_notes_body_length check (char_length(body) <= 2000);
