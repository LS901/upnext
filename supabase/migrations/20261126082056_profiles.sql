-- One profile per auth user. Never holds the email (INV-009 proposal); the
-- username is random, never derived from the email.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  library_private boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable by everyone"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Creates the profile when a user signs up. Retries on the (unlikely)
-- username collision.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chars constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  candidate text;
begin
  loop
    candidate := 'user-' || (
      select string_agg(substr(chars, 1 + floor(random() * 36)::int, 1), '')
      from generate_series(1, 8)
    );
    begin
      insert into public.profiles (id, username) values (new.id, candidate);
      return new;
    exception when unique_violation then
      if exists (select 1 from public.profiles where id = new.id) then
        return new;
      end if;
    end;
  end loop;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
