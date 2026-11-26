-- upnext is email sign-in only (magic link or 6-digit code). Supabase Auth still
-- accepts passwords through its API (sign-up, updateUser), so the database refuses
-- to keep one. Without this, anyone could sign up with a password for an address
-- they don't own and still get in after the real owner confirms it (INV-001, INV-002).
--
-- Supabase Auth gives every new account a random password it never reveals,
-- including accounts made by the magic-link and code flow, so an insert can't be
-- told apart from a password sign-up. On insert the password is therefore dropped,
-- not refused. Setting a password on an existing account raises.

-- Clear any password stored before this migration.
update auth.users set encrypted_password = '' where encrypted_password <> '';

create function public.refuse_passwords()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.encrypted_password := '';
  elsif coalesce(new.encrypted_password, '') <> ''
    and new.encrypted_password is distinct from old.encrypted_password then
    raise exception 'upnext uses email sign-in only; passwords are not accepted';
  end if;
  return new;
end;
$$;

-- Only ever runs as a trigger; keep it off the Data API.
revoke execute on function public.refuse_passwords() from public, anon, authenticated;

create trigger refuse_passwords
  before insert or update of encrypted_password on auth.users
  for each row execute function public.refuse_passwords();
