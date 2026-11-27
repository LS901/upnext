-- finished_at is the database's alone: a user's own client can't forge it. The first
-- trigger only fired on updates that named status, so a direct write to finished_at
-- (or Finished plus an explicit time on a Finished row) slipped through.
-- Now every update goes through the function. When the status doesn't change, the old
-- finished_at is kept, unless the caller is the service role or postgres (migrations,
-- and tests that need deterministic finish times).
create or replace function public.set_finished_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.finished_at = case when new.status = 'finished' then now() else null end;
  elsif new.status is distinct from old.status then
    new.finished_at = case when new.status = 'finished' then now() else null end;
  elsif current_user not in ('service_role', 'postgres') then
    new.finished_at = old.finished_at;
  end if;
  return new;
end;
$$;

drop trigger library_entries_set_finished_at on public.library_entries;
create trigger library_entries_set_finished_at
  before insert or update on public.library_entries
  for each row execute function public.set_finished_at();
