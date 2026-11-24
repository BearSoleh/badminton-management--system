-- Task 8: guarded administration, exact aggregates and private bank settings.
begin;
alter table public.club_settings add column revision integer not null default 1 check(revision>0);
create table app_private.admin_membership_guard(id boolean primary key check(id));
create table app_private.settings_guard(id boolean primary key check(id));
insert into app_private.admin_membership_guard values(true);
insert into app_private.settings_guard values(true);
create table app_private.payment_qr_checks(
  object_id uuid primary key,object_path text not null unique,owner_id text,
  size_bytes integer not null check(size_bytes between 1 and 5242880),
  mime_type text not null check(mime_type in ('image/jpeg','image/png')),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),checked_at timestamptz not null default clock_timestamp()
);
alter table app_private.admin_membership_guard enable row level security;
alter table app_private.settings_guard enable row level security;
alter table app_private.payment_qr_checks enable row level security;
revoke all on app_private.admin_membership_guard,app_private.settings_guard,app_private.payment_qr_checks from public,anon,authenticated,service_role;

create function app_private.require_admin() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_active_membership();
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  return auth.uid();
end;
$$;
create function public.admin_set_membership(target_user_id_input uuid,status_input text,role_input text,expected_status_input text,expected_role_input text,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; previous public.memberships; changed public.memberships;
begin
  -- Must precede begin_operation's actor share-lock: two administrators cannot
  -- hold each other's membership while waiting for this global management gate.
  perform 1 from app_private.admin_membership_guard where id for update;
  cached:=app_private.begin_operation('admin_set_membership',jsonb_build_object('target',target_user_id_input,'status',status_input,'role',role_input,'old_status',expected_status_input,'old_role',expected_role_input,'reason',reason_input),request_id);
  perform app_private.require_admin();
  if cached is not null then return cached; end if;
  perform app_private.require_financial_reason(reason_input);
  select * into previous from public.memberships where user_id=target_user_id_input for update;
  if previous.user_id is null then raise exception 'MEMBER_NOT_FOUND' using errcode='42501'; end if;
  if previous.status is distinct from expected_status_input or previous.role is distinct from expected_role_input then raise exception 'MEMBERSHIP_STALE' using errcode='22023'; end if;
  if status_input is null or role_input is null or status_input not in ('active','rejected','suspended') or role_input not in ('member','admin')
    or (role_input='admin' and previous.role<>'admin' and status_input<>'active')
    or (status_input='rejected' and previous.status<>'pending')
    or (status_input='suspended' and previous.status not in ('active','suspended'))
  then raise exception 'INVALID_MEMBERSHIP' using errcode='22023'; end if;
  if target_user_id_input=auth.uid() and (status_input<>previous.status or role_input<>previous.role) then raise exception 'SELF_CHANGE_DENIED' using errcode='22023'; end if;
  if previous.status='active' and previous.role='admin' and (status_input<>'active' or role_input<>'admin') and
    (select count(*) from public.memberships where role='admin' and status='active')<=1 then raise exception 'LAST_ADMIN_REQUIRED' using errcode='22023'; end if;
  if previous.status=status_input and previous.role=role_input then return app_private.finish_operation(request_id,to_jsonb(previous)); end if;
  update public.memberships set status=status_input,role=role_input,
    approved_by=case when status_input='active' and previous.status<>'active' then auth.uid() else approved_by end,
    approved_at=case when status_input='active' and previous.status<>'active' then clock_timestamp() else approved_at end,updated_at=clock_timestamp()
    where user_id=previous.user_id returning * into changed;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'membership_changed','memberships',previous.user_id,btrim(reason_input),jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(changed)));
  return app_private.finish_operation(request_id,to_jsonb(changed));
end;
$$;

create function public.get_admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare received bigint; refunded bigint; pending bigint; outstanding bigint;
begin
  perform app_private.require_admin();
  select coalesce(sum(amount_sen) filter(where status='approved'),0),coalesce(sum(amount_sen) filter(where status='approved' and refund_status='refunded'),0),
    coalesce(sum(amount_sen) filter(where status='approved' and refund_status='pending'),0) into received,refunded,pending from public.payments;
  select coalesce(sum(amount_sen),0) into outstanding from public.charges where is_current and amount_sen>0 and status in ('unpaid','pending_verification');
  return jsonb_build_object('received_sen',received::text,'refunded_sen',refunded::text,'pending_refund_sen',pending::text,'retained_sen',(received-refunded)::text,'outstanding_sen',outstanding::text,
    'pending_receipts',(select count(*) from public.payments where status='submitted'),
    'pending_members',(select count(*) from public.memberships where status='pending'),
    'active_members',(select count(*) from public.memberships where status='active'),
    'upcoming_sessions',(select count(*) from public.sessions where starts_at>statement_timestamp() and operational_status in ('voting_open','joining_open')),
    'server_now',statement_timestamp());
end;
$$;
create function public.get_admin_members(search_input text,page_input integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare total integer; rows_value jsonb;
begin
  perform app_private.require_admin();
  if page_input is null or page_input not between 0 and 100000 or search_input is null or char_length(search_input)>80 then raise exception 'INVALID_PAGE' using errcode='22023'; end if;
  select count(*) into total from public.profiles p where position(lower(btrim(search_input)) in lower(p.display_name||' '||p.phone))>0;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.user_id),'[]'::jsonb) into rows_value from (
    select p.display_name,p.phone,m.* from public.profiles p join public.memberships m on m.user_id=p.id
      where position(lower(btrim(search_input)) in lower(p.display_name||' '||p.phone))>0 order by m.created_at desc,m.user_id limit 25 offset page_input*25
  ) r;
  return jsonb_build_object('total',total,'page',page_input,'members',rows_value);
end;
$$;
create function public.get_admin_audit(search_input text,page_input integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_admin();
  if page_input is null or page_input not between 0 and 100000 or search_input is null or char_length(search_input)>80 then raise exception 'INVALID_PAGE' using errcode='22023'; end if;
  return jsonb_build_object('total',(select count(*) from public.audit_logs where position(lower(btrim(search_input)) in lower(action))>0),'page',page_input,
    'events',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
      select a.*,coalesce(p.display_name,g.name,'System') actor_name from public.audit_logs a left join public.profiles p on p.id=a.actor_user_id left join public.guests g on g.id=a.actor_guest_id
        where position(lower(btrim(search_input)) in lower(a.action))>0 order by a.created_at desc,a.id limit 25 offset page_input*25
    ) r),'[]'::jsonb));
end;
$$;
create function public.get_guest_history(guest_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_admin();
  if not exists(select 1 from public.guests where id=guest_id_input) then raise exception 'GUEST_UNAVAILABLE' using errcode='42501'; end if;
  return jsonb_build_object('guest',(select to_jsonb(g) from public.guests g where id=guest_id_input),
    'participations',coalesce((select jsonb_agg(to_jsonb(r) order by r.starts_at desc,r.id) from (
      select pt.*,s.title session_title,s.starts_at,s.operational_status,
        coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('payments',coalesce((select jsonb_agg(to_jsonb(py) order by py.created_at,py.id) from public.payments py where py.charge_id=c.id),'[]'::jsonb)) order by c.created_at,c.id)
          from public.charges c where c.participant_id=pt.id),'[]'::jsonb) charges
      from public.participants pt join public.players pl on pl.id=pt.player_id join public.sessions s on s.id=pt.session_id where pl.guest_id=guest_id_input
    ) r),'[]'::jsonb));
end;
$$;

create function public.get_admin_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform app_private.require_admin();
  return coalesce((select to_jsonb(c) from public.club_settings c where id),jsonb_build_object('revision',0,'bank_name',null,'bank_account_name',null,'bank_account_number',null,'qr_object_path',null,'timezone','Asia/Kuala_Lumpur','currency','MYR'));
end;
$$;
create function public.save_club_settings(bank_name_input text,bank_account_name_input text,bank_account_number_input text,qr_path_input text,expected_revision_input integer,recipient_checked_input boolean,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; previous public.club_settings; changed public.club_settings; bank text:=nullif(btrim(bank_name_input),''); account_name text:=nullif(btrim(bank_account_name_input),''); number_value text:=nullif(btrim(bank_account_number_input),'');
begin
  cached:=app_private.begin_operation('save_club_settings',jsonb_build_object('bank',bank_name_input,'name',bank_account_name_input,'number',bank_account_number_input,'qr',qr_path_input,'revision',expected_revision_input,'checked',recipient_checked_input,'reason',reason_input),request_id);
  perform app_private.require_admin();
  if cached is not null then return cached; end if;
  perform app_private.require_financial_reason(reason_input);
  if recipient_checked_input is distinct from true then raise exception 'RECIPIENT_CHECK_REQUIRED' using errcode='22023'; end if;
  if (bank is not null or account_name is not null or number_value is not null) and
    (bank is null or account_name is null or number_value is null or char_length(bank)>120 or char_length(account_name)>120 or number_value !~ '^[0-9 -]{4,40}$')
    then raise exception 'INVALID_BANK_DETAILS' using errcode='22023'; end if;
  perform 1 from app_private.settings_guard where id for update;
  select * into previous from public.club_settings where id for update;
  if expected_revision_input is distinct from coalesce(previous.revision,0) then raise exception 'SETTINGS_STALE' using errcode='22023'; end if;
  if qr_path_input is not null and (qr_path_input !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png)$' or
    (qr_path_input is distinct from previous.qr_object_path and not exists(select 1 from storage.objects o join app_private.payment_qr_checks q on q.object_id=o.id and q.object_path=o.name
      where o.bucket_id='payment-qr' and o.name=qr_path_input and o.metadata->>'size'=q.size_bytes::text and o.metadata->>'mimetype'=q.mime_type and o.owner_id is not distinct from q.owner_id)))
  then raise exception 'QR_NOT_VERIFIED' using errcode='22023'; end if;
  insert into public.club_settings(id,bank_name,bank_account_name,bank_account_number,qr_object_path,revision)
    values(true,bank,account_name,number_value,qr_path_input,coalesce(previous.revision,0)+1)
    on conflict(id) do update set bank_name=excluded.bank_name,bank_account_name=excluded.bank_account_name,bank_account_number=excluded.bank_account_number,
      qr_object_path=excluded.qr_object_path,revision=excluded.revision,updated_at=clock_timestamp() returning * into changed;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'club_settings_changed','club_settings',gen_random_uuid(),btrim(reason_input),jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(changed),'recipient_checked',true));
  return app_private.finish_operation(request_id,to_jsonb(changed));
end;
$$;
create policy payment_qr_admin_insert on storage.objects for insert to authenticated with check(
  bucket_id='payment-qr' and owner_id=(select auth.uid())::text and (select app_private.is_active_admin()) and name ~ '^[a-f0-9-]{36}\.(jpg|jpeg|png)$'
);
create function public.attest_payment_qr(object_path_input text,owner_id_input uuid,size_bytes_input integer,mime_type_input text,sha256_input text) returns boolean
language plpgsql security definer set search_path='' as $$
declare o storage.objects;
begin
  select * into o from storage.objects where bucket_id='payment-qr' and name=object_path_input;
  if o.id is null or o.owner_id is distinct from owner_id_input::text or not exists(select 1 from public.memberships where user_id=owner_id_input and role='admin' and status='active')
    or object_path_input !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png)$' or size_bytes_input is null or size_bytes_input not between 1 and 5242880
    or mime_type_input is null or mime_type_input not in ('image/jpeg','image/png')
    or (case when object_path_input ~ '\.png$' then 'image/png' else 'image/jpeg' end)<>mime_type_input
    or o.metadata->>'size' is distinct from size_bytes_input::text or o.metadata->>'mimetype' is distinct from mime_type_input
    or sha256_input is null or sha256_input !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_QR' using errcode='22023'; end if;
  insert into app_private.payment_qr_checks(object_id,object_path,owner_id,size_bytes,mime_type,sha256) values(o.id,o.name,o.owner_id,size_bytes_input,mime_type_input,sha256_input) on conflict(object_id) do nothing;
  return true;
end;
$$;
revoke all on function app_private.require_admin() from public,anon,authenticated,service_role;
revoke all on function public.admin_set_membership(uuid,text,text,text,text,text,uuid),public.get_admin_dashboard(),public.get_admin_members(text,integer),public.get_admin_audit(text,integer),public.get_guest_history(uuid),public.get_admin_settings(),public.save_club_settings(text,text,text,text,integer,boolean,text,uuid) from public,anon,service_role;
grant execute on function public.admin_set_membership(uuid,text,text,text,text,text,uuid),public.get_admin_dashboard(),public.get_admin_members(text,integer),public.get_admin_audit(text,integer),public.get_guest_history(uuid),public.get_admin_settings(),public.save_club_settings(text,text,text,text,integer,boolean,text,uuid) to authenticated;
revoke all on function public.attest_payment_qr(text,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.attest_payment_qr(text,uuid,integer,text,text) to service_role;
commit;
