-- Task 1: identities only. Membership authorization lives in PostgreSQL.
begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'suspended')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.identity_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target_user_id uuid not null,
  operator_name text not null,
  created_at timestamptz not null default now()
);
revoke all on app_private.identity_events from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
revoke all on public.profiles, public.memberships from public, anon, authenticated;
grant select on public.profiles, public.memberships to authenticated;
grant select, insert, update, delete on public.profiles, public.memberships to service_role;
create policy profiles_read_self on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy memberships_read_self on public.memberships for select to authenticated using (user_id = (select auth.uid()));

create function app_private.create_member_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  canonical_phone text;
  chosen_name text;
begin
  if new.phone is null or new.phone !~ '^\+?[1-9][0-9]{7,14}$' then
    raise exception 'A canonical international phone is required';
  end if;
  canonical_phone := '+' || ltrim(new.phone, '+');
  if canonical_phone like '+600%' then raise exception 'Invalid international phone'; end if;
  chosen_name := btrim(new.raw_user_meta_data ->> 'display_name');
  if chosen_name is null or char_length(chosen_name) not between 1 and 80 then
    raise exception 'A display name of 1–80 characters is required';
  end if;
  insert into public.profiles(id, display_name, phone) values (new.id, chosen_name, canonical_phone);
  -- Never trust role/status in user-controlled Auth metadata.
  insert into public.memberships(user_id, role, status) values (new.id, 'member', 'pending');
  return new;
end;
$$;
revoke all on function app_private.create_member_identity() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function app_private.create_member_identity();

-- Supabase's user update API must not bypass administrator phone verification.
-- An audited admin phone-change operation belongs to a later phase.
create function app_private.protect_credential_phone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.phone is distinct from old.phone then raise exception 'PHONE_CHANGE_REQUIRES_ADMIN_VERIFICATION'; end if;
  return new;
end;
$$;
revoke all on function app_private.protect_credential_phone() from public, anon, authenticated;
create trigger on_auth_phone_change before update of phone on auth.users for each row execute function app_private.protect_credential_phone();

create function public.get_my_membership()
returns table (user_id uuid, display_name text, phone text, role text, status text)
language sql stable security invoker set search_path = '' as $$
  select m.user_id, p.display_name, p.phone, m.role, m.status
  from public.memberships m join public.profiles p on p.id = m.user_id
  where m.user_id = (select auth.uid());
$$;

create function public.assert_active_membership() returns uuid
language plpgsql stable security invoker set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1 from public.memberships where user_id = actor and status = 'active'
  ) then raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '42501'; end if;
  return actor;
end;
$$;

create function public.update_my_display_name(display_name_input text) returns void
language plpgsql security definer set search_path = '' as $$
declare chosen_name text := btrim(display_name_input);
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.memberships where user_id = auth.uid() and status = 'active') then
    raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode = '42501';
  end if;
  if chosen_name is null or char_length(chosen_name) not between 1 and 80 then raise exception 'Invalid display name'; end if;
  update public.profiles set display_name = chosen_name, updated_at = clock_timestamp() where id = auth.uid();
end;
$$;

revoke all on function public.get_my_membership() from public, anon;
revoke all on function public.assert_active_membership() from public, anon;
revoke all on function public.update_my_display_name(text) from public, anon;
grant execute on function public.get_my_membership(), public.assert_active_membership(), public.update_my_display_name(text) to authenticated;

-- Trusted SQL operator only. This is deliberately absent from the public API schema.
create function app_private.bootstrap_first_admin(target_phone text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  lock table public.memberships in share row exclusive mode;
  if exists (select 1 from public.memberships where role = 'admin') then raise exception 'ADMIN_ALREADY_EXISTS'; end if;
  select id into target_id from public.profiles where phone = target_phone;
  if target_id is null then raise exception 'REGISTER_ACCOUNT_FIRST'; end if;
  update public.memberships set role = 'admin', status = 'active', approved_at = clock_timestamp(), updated_at = clock_timestamp()
    where user_id = target_id;
  insert into app_private.identity_events(action, target_user_id, operator_name)
    values ('bootstrap_first_admin', target_id, session_user);
  return target_id;
end;
$$;
revoke all on function app_private.bootstrap_first_admin(text) from public, anon, authenticated, service_role;

-- No SMS OTP is allowed. This hook replaces SMS delivery and returns an error
-- without logging or returning the supplied phone/OTP event payload.
create function app_private.reject_sms_delivery(event jsonb) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select '{"error":{"http_code":403,"message":"SMS authentication is disabled for BJBC."}}'::jsonb;
$$;
grant usage on schema app_private to supabase_auth_admin;
revoke all on function app_private.reject_sms_delivery(jsonb) from public, anon, authenticated, service_role;
grant execute on function app_private.reject_sms_delivery(jsonb) to supabase_auth_admin;

commit;
