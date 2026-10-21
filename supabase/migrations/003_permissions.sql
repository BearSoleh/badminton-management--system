begin;

-- Helpers derive privileges from current database membership, never JWT metadata.
-- app_private is not in PostgREST exposed schemas.
create function app_private.is_active_member() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.memberships where user_id=auth.uid() and status='active');
$$;
create function app_private.is_active_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.memberships where user_id=auth.uid() and status='active' and role='admin');
$$;
create function app_private.owns_player(player_id_input uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.players p left join public.guests g on g.id=p.guest_id
    join public.memberships m on m.user_id=auth.uid() and m.status in ('active','suspended')
    where p.id=player_id_input and (p.user_id=m.user_id or g.linked_user_id=m.user_id));
$$;
create function app_private.owns_participant(participant_id_input uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.participants p where p.id=participant_id_input and app_private.owns_player(p.player_id));
$$;
create function app_private.owns_charge(charge_id_input uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.charges c where c.id=charge_id_input and app_private.owns_participant(c.participant_id));
$$;
create function app_private.can_read_session(session_id_input uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.sessions s where s.id=session_id_input and
    (app_private.is_active_admin() or (s.operational_status <> 'draft' and app_private.is_active_member())));
$$;

grant usage on schema app_private to authenticated,service_role;
grant execute on function app_private.is_active_member(),app_private.is_active_admin(),app_private.owns_player(uuid),app_private.owns_participant(uuid),app_private.owns_charge(uuid),app_private.can_read_session(uuid) to authenticated;

grant select on public.guests,public.players,public.sessions,public.polls,public.votes,public.participants,public.waitlist_offers,public.session_costs,public.fee_versions,public.charges,public.payments,public.notifications,public.audit_logs,public.club_settings to authenticated;
grant select,insert,update,delete on public.guests,public.players,public.sessions,public.polls,public.votes,public.participants,public.waitlist_offers,public.session_costs,public.fee_versions,public.charges,public.payments,public.notifications,public.club_settings to service_role;
grant select,insert on public.audit_logs to service_role;
grant select,insert,update,delete on app_private.guest_access_tokens,app_private.recovery_tokens,app_private.notification_outbox to service_role;

create policy profiles_admin_read on public.profiles for select to authenticated using ((select app_private.is_active_admin()));
create policy memberships_admin_read on public.memberships for select to authenticated using ((select app_private.is_active_admin()));
create policy guests_admin_read on public.guests for select to authenticated using ((select app_private.is_active_admin()));
create policy players_read on public.players for select to authenticated using ((select app_private.is_active_admin()) or app_private.owns_player(id));
create policy sessions_read on public.sessions for select to authenticated using (app_private.can_read_session(id));
create policy polls_read on public.polls for select to authenticated using (app_private.can_read_session(session_id) and (status <> 'draft' or (select app_private.is_active_admin())));
create policy votes_read on public.votes for select to authenticated using ((select app_private.is_active_admin()) or (user_id=(select auth.uid()) and (select app_private.is_active_member())));
create policy participants_read on public.participants for select to authenticated using ((select app_private.is_active_admin()) or app_private.owns_player(player_id));
create policy offers_read on public.waitlist_offers for select to authenticated using ((select app_private.is_active_admin()) or ((select app_private.is_active_member()) and app_private.owns_participant(participant_id)));
create policy costs_admin_read on public.session_costs for select to authenticated using ((select app_private.is_active_admin()));
-- A version reveals the full fee, not another player's charge/debt. Suspended
-- members may read versions backing their own existing obligations only.
create policy fees_read on public.fee_versions for select to authenticated using (
  (select app_private.is_active_admin()) or app_private.can_read_session(session_id)
  or exists(select 1 from public.charges c where c.fee_version_id=fee_versions.id and app_private.owns_participant(c.participant_id))
);
create policy charges_read on public.charges for select to authenticated using ((select app_private.is_active_admin()) or app_private.owns_participant(participant_id));
create policy payments_read on public.payments for select to authenticated using ((select app_private.is_active_admin()) or app_private.owns_charge(charge_id));
create policy notifications_read on public.notifications for select to authenticated using (user_id=(select auth.uid()) and (select app_private.is_active_member()));
create policy audit_admin_read on public.audit_logs for select to authenticated using ((select app_private.is_active_admin()));
create policy settings_read on public.club_settings for select to authenticated using ((select app_private.is_active_member()) or exists(select 1 from public.memberships where user_id=(select auth.uid()) and status='suspended'));

-- Deliberate narrow SECURITY DEFINER projection rather than an owner-privileged
-- view or grants on foreign profiles/participants. Only safe fields can escape.
create function public.get_session_roster(session_id_input uuid)
returns table(session_id uuid,participant_id uuid,display_name text,participation_status text,attendance text)
language sql stable security definer set search_path='' as $$
  select p.session_id,p.id,coalesce(pr.display_name,g.name),p.participation_status,p.attendance
  from public.participants p join public.players pl on pl.id=p.player_id
  left join public.profiles pr on pr.id=pl.user_id left join public.guests g on g.id=pl.guest_id
  where p.session_id=session_id_input and app_private.can_read_session(p.session_id)
  order by p.queue_joined_at,p.id;
$$;
revoke all on function public.get_session_roster(uuid) from public,anon;
grant execute on function public.get_session_roster(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('receipts','receipts',false,5242880,array['image/jpeg','image/png','application/pdf']);

create function app_private.can_upload_receipt(object_path_input text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare charge_id_value uuid;
begin
  if auth.uid() is null or object_path_input !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|pdf)$' then return false; end if;
  if split_part(object_path_input,'/',1) <> auth.uid()::text then return false; end if;
  begin charge_id_value := split_part(object_path_input,'/',2)::uuid; exception when invalid_text_representation then return false; end;
  return exists(select 1 from public.charges c where c.id=charge_id_value and c.is_current and c.status='unpaid'
    and app_private.owns_participant(c.participant_id)
    and not exists(select 1 from public.payments p where p.charge_id=c.id and p.status in ('submitted','approved')));
end;
$$;
grant execute on function app_private.can_upload_receipt(text) to authenticated;
create policy receipts_insert_own on storage.objects for insert to authenticated with check (
  bucket_id='receipts' and owner_id=(select auth.uid())::text and app_private.can_upload_receipt(name)
);
-- No SELECT/UPDATE/DELETE policy for receipts. In particular, clients cannot
-- call Storage signing directly and choose their own unbounded URL lifetime.

create function public.authorize_receipt_view(object_path_input text) returns text
language plpgsql stable security definer set search_path='' as $$
declare charge_id_value uuid; owner_id_value uuid;
begin
  if auth.uid() is null or object_path_input !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|pdf)$' then
    raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501';
  end if;
  begin
    charge_id_value := split_part(object_path_input,'/',2)::uuid;
    owner_id_value := split_part(object_path_input,'/',1)::uuid;
  exception when invalid_text_representation then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end;
  if not exists(select 1 from public.charges c join public.participants p on p.id=c.participant_id
    join public.players pl on pl.id=p.player_id left join public.guests g on g.id=pl.guest_id
    where c.id=charge_id_value and (pl.user_id=owner_id_value or g.linked_user_id=owner_id_value)
    and (app_private.is_active_admin() or (owner_id_value=auth.uid() and app_private.owns_participant(p.id))))
    or not exists(select 1 from storage.objects o where o.bucket_id='receipts' and o.name=object_path_input and o.owner_id=owner_id_value::text)
  then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  return object_path_input;
end;
$$;
revoke all on function public.authorize_receipt_view(text) from public,anon;
grant execute on function public.authorize_receipt_view(text) to authenticated;

commit;
