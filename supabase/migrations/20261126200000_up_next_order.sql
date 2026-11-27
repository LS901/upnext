-- Renumbers one of the caller's Up next queues 1..n, in the order given, in a
-- single statement, so a renumber happens in full or not at all. The app calls
-- it only when a move can't fit between two neighbours (their positions are
-- too close, or tied by two adds at once).
--
-- security invoker: it runs as the caller, so RLS applies as for any update,
-- and it only touches the caller's own entries that are still queued in
-- Backlog. Rows that left Backlog meanwhile are skipped, never re-queued.
create function public.set_up_next_order(entry_ids uuid[])
returns integer
language sql
security invoker
set search_path = ''
as $$
  with ordered as (
    select id, ordinality::double precision as position
    from unnest(entry_ids) with ordinality as t (id, ordinality)
  ),
  changed as (
    update public.library_entries e
    set up_next_position = o.position
    from ordered o
    where e.id = o.id
      and e.user_id = (select auth.uid())
      and e.status = 'backlog'
      and e.up_next_position is not null
    returning 1
  )
  select count(*)::integer from changed;
$$;

revoke execute on function public.set_up_next_order(uuid[]) from public, anon;
grant execute on function public.set_up_next_order(uuid[]) to authenticated;
