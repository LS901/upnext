-- Private notes (owner-only, kept apart so a public library can never leak
-- one) and per-user progress exclusions.

create table public.entry_notes (
  entry_id uuid primary key,
  user_id uuid not null default auth.uid(),
  body text not null,
  updated_at timestamptz not null default now(),
  -- a note can only sit on its owner's entry
  foreign key (entry_id, user_id)
    references public.library_entries (id, user_id) on delete cascade
);

create index entry_notes_user_id_idx on public.entry_notes (user_id);

create trigger entry_notes_set_updated_at
  before update on public.entry_notes
  for each row execute function public.set_updated_at();

alter table public.entry_notes enable row level security;

-- INV-002: notes are never public, not even when the library is
create policy "owner reads own notes"
  on public.entry_notes for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "owner inserts own notes"
  on public.entry_notes for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner updates own notes"
  on public.entry_notes for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner deletes own notes"
  on public.entry_notes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Seasons a user leaves out of a show's progress count. Its own table because
-- a user can exclude a season they never track.
create table public.progress_exclusions (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  -- INV-003: removing a catalogue row must never silently delete user data
  season_id uuid not null references public.seasons (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

alter table public.progress_exclusions enable row level security;

create policy "exclusions are readable by owner or when library is public"
  on public.progress_exclusions for select
  to anon, authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = progress_exclusions.user_id and not p.library_private
    )
  );

create policy "owner inserts own exclusions"
  on public.progress_exclusions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "owner updates own exclusions"
  on public.progress_exclusions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "owner deletes own exclusions"
  on public.progress_exclusions for delete
  to authenticated
  using (user_id = (select auth.uid()));
