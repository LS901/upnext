-- Backlog and Up next are one queue per type (owner said, 2026-11-27): every
-- Backlog entry has a place in its type's queue, always. A user's queue for an
-- item is their entries with the same item_media_type (movie, game, book; print
-- and audio books share one); for a season, their entries with any season_id (TV).

-- Places every Backlog entry that has none, per user and queue, after the queue's
-- current bottom, oldest first, so existing Up next order stays on top. A
-- function, not inline SQL, so the boundary tests can run it too. security
-- definer, so it reaches every user's rows; only the migration and the service
-- role may call it.
create function public.backfill_up_next()
returns integer
language sql
security definer
set search_path = ''
as $$
  with keyed as (
    select id, user_id, status, up_next_position, created_at,
      case when season_id is not null then 'show' else item_media_type::text end as queue
    from public.library_entries
  ),
  bottoms as (
    select user_id, queue, max(up_next_position) as bottom
    from keyed
    where up_next_position is not null
    group by user_id, queue
  ),
  unqueued as (
    select id, user_id, queue,
      row_number() over (partition by user_id, queue order by created_at, id) as n
    from keyed
    where status = 'backlog' and up_next_position is null
  ),
  changed as (
    update public.library_entries e
    set up_next_position = coalesce(b.bottom, 0) + u.n
    from unqueued u
    left join bottoms b on b.user_id = u.user_id and b.queue = u.queue
    where e.id = u.id
    returning 1
  )
  select count(*)::integer from changed;
$$;

revoke execute on function public.backfill_up_next() from public, anon, authenticated;

-- The updated_at trigger is paused so the backfill doesn't move updated_at itself.
alter table public.library_entries disable trigger library_entries_set_updated_at;
select public.backfill_up_next();
alter table public.library_entries enable trigger library_entries_set_updated_at;

-- Was: a place only in Backlog. Now: in Backlog exactly when it has a place.
-- The old check was created unnamed; library_entries_check2 is its generated name.
alter table public.library_entries
  drop constraint library_entries_check2,
  add constraint library_entries_up_next_position_check
    check ((status = 'backlog') = (up_next_position is not null));

-- The database owns the place: an entry arriving in Backlog with none goes to the
-- bottom of its queue (an explicit place, given on insert, is kept), one staying
-- in Backlog keeps its place, and one leaving Backlog loses it, whatever the
-- caller sent. Ties from two adds at once are allowed: the order settles them by
-- id, and a move renumbers the queue.
--
-- security invoker: the user's own client reads its own rows under RLS, and the
-- service role reads past it. Only the entry's own user's rows are read.
create function public.queue_backlog_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'backlog' then
    new.up_next_position = null;
  elsif new.up_next_position is null then
    select coalesce(max(e.up_next_position), 0) + 1
      into new.up_next_position
      from public.library_entries e
     where e.user_id = new.user_id
       and case
             when new.season_id is not null then e.season_id is not null
             else e.item_media_type = new.item_media_type
           end;
  end if;
  return new;
end;
$$;

create trigger library_entries_queue_backlog
  before insert or update of status on public.library_entries
  for each row execute function public.queue_backlog_entry();
