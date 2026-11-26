-- INV-002: the insert check must reject before the primary key or foreign key
-- can answer, otherwise another user could learn whether a note exists on an
-- entry (23505 vs 23503). Require that the caller owns the entry.
drop policy "owner inserts own notes" on public.entry_notes;

create policy "owner inserts own notes"
  on public.entry_notes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.library_entries e
      where e.id = entry_notes.entry_id and e.user_id = (select auth.uid())
    )
  );
