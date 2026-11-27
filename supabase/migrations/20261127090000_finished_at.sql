-- finished_at: when an entry moved into Finished (owner said, 2026-11-27), so the
-- dashboard's "Recently finished" can order by it. The database owns the column:
-- app code never writes it.
alter table public.library_entries add column finished_at timestamptz;

-- Entries already Finished: the best time we have is their last update. The
-- updated_at trigger is paused so the backfill doesn't move updated_at itself.
alter table public.library_entries disable trigger library_entries_set_updated_at;
update public.library_entries set finished_at = updated_at where status = 'finished';
alter table public.library_entries enable trigger library_entries_set_updated_at;

alter table public.library_entries
  add constraint library_entries_finished_at_check
  check (finished_at is null or status = 'finished');

-- Stamps on the way into Finished, clears on the way out, otherwise leaves it alone
-- (so a repeated save of Finished, or a play_count edit, keeps the time).
create function public.set_finished_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'finished' then
    if tg_op = 'INSERT' or old.status <> 'finished' then
      new.finished_at = now();
    end if;
  else
    new.finished_at = null;
  end if;
  return new;
end;
$$;

create trigger library_entries_set_finished_at
  before insert or update of status on public.library_entries
  for each row execute function public.set_finished_at();
