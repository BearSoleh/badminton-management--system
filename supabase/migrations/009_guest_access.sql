-- Task 7 only. All capabilities remain outside exposed schemas; no guest JWT/RLS bypass.
begin;

alter table app_private.guest_access_tokens add column exchanged_at timestamptz;
alter table app_private.guest_access_tokens add column issued_by uuid references public.profiles(id);
alter table app_private.recovery_tokens add column revoked_at timestamptz;
alter table app_private.recovery_tokens add column completed_at timestamptz;
alter table app_private.recovery_tokens add column outcome text check(outcome in ('completed','provider_failed'));
alter table public.participants add column merged_into_id uuid references public.participants(id);
alter table public.participants add constraint participant_merge_same_session foreign key(merged_into_id,session_id) references public.participants(id,session_id);
alter table public.participants add constraint participant_not_self_merge check(merged_into_id<>id);
alter table app_private.receipt_checks add column guest_id uuid references public.guests(id);

create table app_private.guest_sessions (
  id uuid primary key default gen_random_uuid(), invitation_id uuid not null references app_private.guest_access_tokens(id),
  session_hash text not null unique check(session_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp()
);
create table app_private.guest_operations (
  guest_id uuid not null references public.guests(id), request_id uuid not null,
  operation text not null, payload jsonb not null, result jsonb, primary key(guest_id,request_id)
);
create table app_private.capability_budgets (
  bucket text primary key, window_at timestamptz not null, attempts integer not null
);
-- A short global serialization point avoids guest-row/session-row lock inversions
-- in existing scheduler paths. It is held only by a quota transition transaction.
create table app_private.guest_reservation_guard(id boolean primary key check(id));
insert into app_private.guest_reservation_guard values(true);
alter table app_private.guest_sessions enable row level security;
alter table app_private.guest_operations enable row level security;
alter table app_private.capability_budgets enable row level security;
alter table app_private.guest_reservation_guard enable row level security;
revoke all on app_private.guest_sessions,app_private.guest_operations,app_private.capability_budgets,app_private.guest_reservation_guard,
  app_private.guest_access_tokens,app_private.recovery_tokens from public,anon,authenticated,service_role;

-- Budget is a separate committed RPC before capability processing, so failed
-- validation cannot roll back the limiter. No raw capability/IP is stored.
create function public.consume_capability_budget(bucket_input text,limit_input integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer; at_value timestamptz:=clock_timestamp();
begin
  if bucket_input is null or char_length(bucket_input)>100 or limit_input not between 1 and 1000 then return false; end if;
  delete from app_private.capability_budgets where window_at<at_value-interval '2 minutes';
  insert into app_private.capability_budgets(bucket,window_at,attempts) values(bucket_input,at_value,1)
    on conflict(bucket) do update set attempts=case when capability_budgets.window_at<=at_value-interval '1 minute' then 1 else capability_budgets.attempts+1 end,
      window_at=case when capability_budgets.window_at<=at_value-interval '1 minute' then at_value else capability_budgets.window_at end returning attempts into n;
  return n<=limit_input;
end;
$$;

create function app_private.guest_uses(guest_id_input uuid,exclude_participant_input uuid) returns integer
language sql volatile security definer set search_path='' as $$
  select count(*)::integer from public.participants p join public.players pl on pl.id=p.player_id join public.sessions s on s.id=p.session_id
  where pl.guest_id=guest_id_input and p.id is distinct from exclude_participant_input and p.merged_into_id is null and s.operational_status<>'cancelled'
    and (p.participation_status in ('confirmed','late_cancelled') or p.liability_percent>0 or
      (p.participation_status='offered' and s.starts_at>clock_timestamp() and exists(select 1 from public.waitlist_offers o where o.participant_id=p.id and o.state='pending' and o.expires_at>clock_timestamp())));
$$;
create function app_private.enforce_guest_reservation() returns trigger
language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
  if new.merged_into_id is not null or new.participation_status not in ('confirmed','offered') then return new; end if;
  select g.id into gid from public.players pl join public.guests g on g.id=pl.guest_id where pl.id=new.player_id and g.linked_user_id is null;
  if gid is null then return new; end if;
  if exists(select 1 from public.sessions where id=new.session_id and operational_status='cancelled') then return new; end if;
  perform 1 from app_private.guest_reservation_guard where id for update;
  if app_private.guest_uses(gid,new.id)>=2 then raise exception 'GUEST_ACCOUNT_REQUIRED' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger guest_reservation_limit before insert or update of participation_status,player_id,merged_into_id on public.participants
  for each row execute function app_private.enforce_guest_reservation();

create or replace function app_private.waitlist_eligible(player_id_input uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from public.players p left join public.guests g on g.id=p.guest_id left join public.memberships m on m.user_id=coalesce(p.user_id,g.linked_user_id)
    where p.id=player_id_input and (m.status='active' or (g.id is not null and g.linked_user_id is null and app_private.guest_uses(g.id,null)<2)));
$$;

-- Eligibility excludes this candidate's own accrued use. A held/confirmed
-- rejoin of an already-counted late cancellation does not consume a third use.
create function app_private.waitlist_eligible(player_id_input uuid,participant_id_input uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from public.participants pt join public.players p on p.id=pt.player_id
    left join public.guests g on g.id=p.guest_id left join public.memberships m on m.user_id=coalesce(p.user_id,g.linked_user_id)
    where pt.id=participant_id_input and p.id=player_id_input and pt.merged_into_id is null
      and (m.status='active' or (g.id is not null and g.linked_user_id is null and app_private.guest_uses(g.id,pt.id)<2)));
$$;

create function public.issue_guest_invitation(session_id_input uuid,guest_id_input uuid,name_input text,phone_input text,token_hash_input text,verified_input boolean,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.guests; s public.sessions; t app_private.guest_access_tokens;
begin
  cached:=app_private.begin_operation('issue_guest_invitation',jsonb_build_object('session_id',session_id_input,'guest_id',guest_id_input,'name',name_input,'phone',phone_input,'hash',token_hash_input,'verified',verified_input,'reason',reason_input),request_id);
  if cached is not null then return cached; end if;
  if token_hash_input is null or token_hash_input !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
  select * into s from public.sessions where id=session_id_input;
  if s.id is null or s.operational_status='draft' then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  if guest_id_input is null then
    if exists(select 1 from public.guests where phone=phone_input) then raise exception 'ADMIN_VERIFICATION_REQUIRED' using errcode='42501'; end if;
    if s.operational_status not in ('voting_open','joining_open') or clock_timestamp()>=s.starts_at then raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
    insert into public.guests(name,phone,sponsor_user_id,verified_by) values(btrim(name_input),phone_input,auth.uid(),case when app_private.is_active_admin() and verified_input then auth.uid() end) returning * into g;
    insert into public.players(guest_id) values(g.id);
  else
    if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
    if verified_input is distinct from true then raise exception 'IDENTITY_VERIFICATION_REQUIRED' using errcode='22023'; end if;
    perform app_private.require_financial_reason(reason_input);
    select * into g from public.guests where id=guest_id_input;
    if g.id is null or g.linked_user_id is not null then raise exception 'GUEST_UNAVAILABLE' using errcode='42501'; end if;

  end if;
  update app_private.guest_access_tokens set revoked_at=clock_timestamp() where guest_id=g.id and session_id=s.id and revoked_at is null;
  if guest_id_input is not null then update public.guests set verified_by=auth.uid(),updated_at=clock_timestamp() where id=g.id; end if;
  insert into app_private.guest_access_tokens(guest_id,session_id,token_hash,expires_at,scope,issued_by)
    values(g.id,s.id,token_hash_input,clock_timestamp()+interval '30 days','session_payment',auth.uid()) returning * into t;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'guest_invitation_issued','guests',g.id,nullif(btrim(reason_input),''),jsonb_build_object('session_id',s.id,'invitation_id',t.id,'verified',verified_input is true,'expires_at',t.expires_at));
  return app_private.finish_operation(request_id,jsonb_build_object('guest_id',g.id,'token_id',t.id,'expires_at',t.expires_at));
end;
$$;
create function public.revoke_guest_invitation(token_id_input uuid,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb;
begin
  cached:=app_private.begin_operation('revoke_guest_invitation',jsonb_build_object('token_id',token_id_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  perform app_private.require_financial_reason(reason_input);
  update app_private.guest_access_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=token_id_input;
  if not found then raise exception 'GUEST_UNAVAILABLE' using errcode='42501'; end if;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason) values(auth.uid(),'guest_invitation_revoked','guest_access_tokens',token_id_input,btrim(reason_input));
  return app_private.finish_operation(request_id,jsonb_build_object('revoked',true));
end;
$$;
create function public.exchange_guest_capability(token_hash_input text,session_hash_input text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t app_private.guest_access_tokens; expiry timestamptz;
begin
  select * into t from app_private.guest_access_tokens where token_hash=token_hash_input for update;
  if t.id is null or t.revoked_at is not null or t.exchanged_at is not null or t.expires_at<=clock_timestamp()
    or exists(select 1 from public.guests where id=t.guest_id and linked_user_id is not null)
    or session_hash_input is null or session_hash_input !~ '^[a-f0-9]{64}$'
  then raise exception 'ACCESS_UNAVAILABLE' using errcode='42501'; end if;
  expiry:=least(t.expires_at,clock_timestamp()+interval '30 minutes');
  update app_private.guest_access_tokens set exchanged_at=clock_timestamp() where id=t.id;
  insert into app_private.guest_sessions(invitation_id,session_hash,expires_at) values(t.id,session_hash_input,expiry);
  return jsonb_build_object('expires_at',expiry);
end;
$$;
create function app_private.guest_scope(session_hash_input text) returns app_private.guest_access_tokens
language plpgsql security definer set search_path='' as $$
declare t app_private.guest_access_tokens;
begin
  -- Invitation share-lock serializes revocation/linking with each request.
  select t0.* into t from app_private.guest_access_tokens t0 join app_private.guest_sessions gs on gs.invitation_id=t0.id
    join public.guests g on g.id=t0.guest_id where gs.session_hash=session_hash_input and gs.expires_at>clock_timestamp()
      and t0.expires_at>clock_timestamp() and t0.revoked_at is null and g.linked_user_id is null for share of t0;
  if t.id is null then raise exception 'ACCESS_UNAVAILABLE' using errcode='42501'; end if;
  return t;
end;
$$;

-- Shared full-payment implementation: members and scoped guests both take the
-- session lock, enforce byte attestation and retain the same immutable history.
create function app_private.submit_payment_locked(charge_id_input uuid,receipt_path_input text,request_id_input uuid,guest_id_input uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.charges; s public.sessions; pid uuid; owner_value text:=coalesce(guest_id_input,auth.uid())::text;
begin
  select * into s from public.sessions where id=(select session_id from public.charges where id=charge_id_input) for update;
  select * into c from public.charges where id=charge_id_input for update;
  if c.id is null or s.operational_status='cancelled' or not c.is_current or c.status<>'unpaid' or c.amount_sen<=0
    or exists(select 1 from public.payments where charge_id=c.id and status in ('submitted','approved')) then raise exception 'CHARGE_NOT_PAYABLE' using errcode='22023'; end if;
  if receipt_path_input is null or split_part(receipt_path_input,'/',1)<>owner_value or split_part(receipt_path_input,'/',2)<>c.id::text
    or not exists(select 1 from storage.objects o join app_private.receipt_checks rc on rc.object_id=o.id and rc.object_path=o.name
      where o.bucket_id='receipts' and o.name=receipt_path_input and rc.owner_id=owner_value and rc.guest_id is not distinct from guest_id_input
        and (o.owner_id=owner_value or (guest_id_input is not null and o.owner_id is null))
        and o.metadata->>'size'=rc.size_bytes::text and o.metadata->>'mimetype'=rc.mime_type)
  then raise exception 'RECEIPT_NOT_READY' using errcode='22023'; end if;
  if exists(select 1 from public.payments where receipt_object_path=receipt_path_input) then raise exception 'RECEIPT_ALREADY_USED' using errcode='22023'; end if;
  insert into public.payments(charge_id,method,amount_sen,receipt_object_path,submitted_by,idempotency_key)
    values(c.id,'transfer',c.amount_sen,receipt_path_input,case when guest_id_input is null then auth.uid() end,request_id_input) returning id into pid;
  update public.charges set status='pending_verification' where id=c.id;
  insert into public.audit_logs(actor_user_id,actor_guest_id,action,entity,entity_id,safe_metadata)
    values(case when guest_id_input is null then auth.uid() end,guest_id_input,'payment_submitted','payments',pid,jsonb_build_object('charge_id',c.id,'amount_sen',c.amount_sen));
  return jsonb_build_object('payment_id',pid,'status','submitted','amount_sen',c.amount_sen);
end;
$$;
create or replace function public.submit_payment(charge_id_input uuid,receipt_path_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb;
begin
  cached:=app_private.begin_payment_operation('submit_payment',jsonb_build_object('charge_id',charge_id_input,'receipt_path',receipt_path_input),request_id);
  if not app_private.owns_charge(charge_id_input) then raise exception 'CHARGE_ACCESS_DENIED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  return app_private.finish_operation(request_id,app_private.submit_payment_locked(charge_id_input,receipt_path_input,request_id,null));
end;
$$;

create or replace function public.attest_receipt_upload(object_path_input text,size_bytes_input integer,mime_type_input text,sha256_input text) returns boolean
language plpgsql security definer set search_path='' as $$
declare o storage.objects; gid uuid;
begin
  select * into o from storage.objects where bucket_id='receipts' and name=object_path_input;
  if o.owner_id is null then
    select g.id into gid from public.guests g join public.players pl on pl.guest_id=g.id join public.participants pt on pt.player_id=pl.id join public.charges c on c.participant_id=pt.id
      where g.id::text=split_part(object_path_input,'/',1) and c.id::text=split_part(object_path_input,'/',2);
  end if;
  if o.id is null or object_path_input !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|pdf)$'
    or (o.owner_id is distinct from split_part(object_path_input,'/',1) and gid is null)
    or size_bytes_input is null or size_bytes_input not between 1 and 5242880
    or mime_type_input is null or mime_type_input not in ('image/jpeg','image/png','application/pdf')
    or (case when object_path_input ~ '\.pdf$' then 'application/pdf' when object_path_input ~ '\.png$' then 'image/png' else 'image/jpeg' end)<>mime_type_input
    or o.metadata->>'size' is distinct from size_bytes_input::text or o.metadata->>'mimetype' is distinct from mime_type_input
    or sha256_input is null or sha256_input !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_RECEIPT' using errcode='22023'; end if;
  insert into app_private.receipt_checks(object_id,object_path,owner_id,size_bytes,mime_type,sha256,guest_id)
    values(o.id,o.name,coalesce(o.owner_id,gid::text),size_bytes_input,mime_type_input,sha256_input,gid) on conflict(object_id) do nothing;
  return true;
end;
$$;

create or replace function public.authorize_receipt_view(object_path_input text) returns text
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or object_path_input !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|pdf)$'
    or not exists(select 1 from public.charges c join public.participants p on p.id=c.participant_id join public.players pl on pl.id=p.player_id
      left join public.guests g on g.id=pl.guest_id join storage.objects o on o.bucket_id='receipts' and o.name=object_path_input
      where c.id::text=split_part(object_path_input,'/',2) and
        ((o.owner_id=split_part(object_path_input,'/',1) and (pl.user_id=o.owner_id::uuid or g.linked_user_id=o.owner_id::uuid))
          or (o.owner_id is null and g.id::text=split_part(object_path_input,'/',1)))
        and (app_private.is_active_admin() or app_private.owns_participant(p.id)))
  then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  return object_path_input;
end;
$$;

create function public.guest_portal_action(session_hash_input text,operation_input text,payload_input jsonb,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t app_private.guest_access_tokens; s public.sessions; p public.participants; previous public.participants; plid uuid; at_value timestamptz; result_value jsonb; ledger app_private.guest_operations; c public.charges; path_value text; oid uuid; new_status text;
begin
  t:=app_private.guest_scope(session_hash_input);
  select id into plid from public.players where guest_id=t.guest_id;
  -- Every read/mutation is constrained by both invitation identities, regardless of payload.
  if operation_input not in ('snapshot','join','withdraw','respond','submit_payment','authorize_upload','authorize_receipt','authorize_qr') then raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
  if operation_input in ('join','withdraw','respond','submit_payment') then
    if request_id is null then raise exception 'INVALID_REQUEST_ID' using errcode='22023'; end if;
    insert into app_private.guest_operations(guest_id,request_id,operation,payload) values(t.guest_id,request_id,operation_input,payload_input||jsonb_build_object('scope_session',t.session_id)) on conflict do nothing;
    select * into ledger from app_private.guest_operations where guest_id=t.guest_id and guest_operations.request_id=guest_portal_action.request_id for update;
    if ledger.operation<>operation_input or ledger.payload is distinct from payload_input||jsonb_build_object('scope_session',t.session_id) then raise exception 'REQUEST_ID_CONFLICT' using errcode='22023'; end if;
    if ledger.result is not null then return ledger.result; end if;
  end if;
  select * into s from public.sessions where id=t.session_id for update;
  at_value:=clock_timestamp();
  select * into p from public.participants where session_id=s.id and player_id=plid and merged_into_id is null;
  if operation_input='snapshot' then
    return jsonb_build_object('guest',(select jsonb_build_object('id',id,'name',name,'uses_reserved_or_counted',app_private.guest_uses(id,null)) from public.guests where id=t.guest_id),
      'session',jsonb_build_object('id',s.id,'title',s.title,'venue',s.venue,'starts_at',s.starts_at,'ends_at',s.ends_at,'operational_status',s.operational_status,'billing_status',s.billing_status),
      'server_now',at_value,'participation',case when p.id is not null then to_jsonb(p) end,
      'offer',(select to_jsonb(o) from public.waitlist_offers o where o.participant_id=p.id and o.state='pending'),
      'withdrawal_percent',greatest(coalesce(p.liability_percent,0),app_private.withdrawal_percentage(s.starts_at,at_value,coalesce(p.participation_status='confirmed',false))),
      'bank',(select jsonb_build_object('bank_name',bank_name,'bank_account_name',bank_account_name,'bank_account_number',bank_account_number,'has_qr',qr_object_path is not null) from public.club_settings where id),
      'charges',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from (
        select c0.*,f.version fee_version,coalesce((select jsonb_agg(to_jsonb(py) order by py.created_at,py.id) from public.payments py where py.charge_id=c0.id),'[]'::jsonb) payments
        from public.charges c0 join public.fee_versions f on f.id=c0.fee_version_id where c0.participant_id=p.id and c0.session_id=s.id) r),'[]'::jsonb));
  elsif operation_input in ('join','withdraw','respond') then
    if s.operational_status not in ('voting_open','joining_open') or at_value>=s.starts_at then raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
    if operation_input='join' then
      if p.participation_status in ('confirmed','waitlisted','offered') then result_value:=app_private.participation_result(p.id);
      else
        previous:=p;
        new_status:=case when app_private.waitlist_occupancy(s.id,at_value)<s.capacity and not exists(select 1 from public.participants where session_id=s.id and merged_into_id is null and participation_status in ('waitlisted','offered')) then 'confirmed' else 'waitlisted' end;
        if p.id is null then
          insert into public.participants(session_id,player_id,source,queue_joined_at,participation_status,attendance,confirmed_at,charge_percent)
            values(s.id,plid,'guest',at_value,new_status,case when new_status='confirmed' then 'unmarked' else 'not_applicable' end,case when new_status='confirmed' then at_value end,case when new_status='confirmed' then 100 else 0 end) returning * into p;
        else
          update public.participants set queue_joined_at=at_value,participation_status=new_status,attendance=case when new_status='confirmed' then 'unmarked' else 'not_applicable' end,
            confirmed_at=case when new_status='confirmed' then at_value end,withdrawn_at=null,charge_percent=case when new_status='confirmed' then 100 else liability_percent end where id=p.id returning * into p;
        end if;
        perform app_private.audit_participation(previous,p);result_value:=app_private.participation_result(p.id);
      end if;
    elsif operation_input='withdraw' then
      if p.id is null then raise exception 'ACCESS_UNAVAILABLE' using errcode='42501'; end if;
      result_value:=app_private.withdraw_locked(p.id,s,at_value);
    else
      if jsonb_typeof(payload_input->'accept') is distinct from 'boolean' then raise exception 'INVALID_RESPONSE' using errcode='22023'; end if;
      select id into oid from public.waitlist_offers where participant_id=p.id and state='pending';
      if oid is null then raise exception 'OFFER_NOT_PENDING' using errcode='22023'; end if;
      result_value:=app_private.resolve_offer_locked(oid,(payload_input->>'accept')::boolean,at_value);
    end if;
    perform app_private.reconcile_waitlist(s.id,at_value);
    insert into public.audit_logs(actor_guest_id,action,entity,entity_id) values(t.guest_id,'guest_'||operation_input,'participants',p.id);
  elsif operation_input='authorize_qr' then
    select qr_object_path into path_value from public.club_settings where id;
    if path_value is null or path_value !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png)$' then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
    return jsonb_build_object('path',path_value);
  elsif operation_input='authorize_receipt' then
    path_value:=payload_input->>'path';
    if path_value is null or path_value !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|pdf)$' or split_part(path_value,'/',1)<>t.guest_id::text
      or not exists(select 1 from public.charges c0 join public.payments py on py.charge_id=c0.id where c0.participant_id=p.id and c0.session_id=s.id and py.receipt_object_path=path_value)
    then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
    return jsonb_build_object('path',path_value);
  else
    select * into c from public.charges where id=(payload_input->>'charge_id')::uuid and participant_id=p.id and session_id=s.id;
    if c.id is null then raise exception 'CHARGE_ACCESS_DENIED' using errcode='42501'; end if;
    if operation_input='authorize_upload' then
      if s.operational_status='cancelled' or not c.is_current or c.status<>'unpaid' or c.amount_sen<=0 then raise exception 'CHARGE_NOT_PAYABLE' using errcode='22023'; end if;
      return jsonb_build_object('owner',t.guest_id,'charge_id',c.id);
    end if;
    result_value:=app_private.submit_payment_locked(c.id,payload_input->>'path',request_id,t.guest_id);
  end if;
  update app_private.guest_operations set result=result_value where guest_id=t.guest_id and guest_operations.request_id=guest_portal_action.request_id;
  return result_value;
end;
$$;

create function public.issue_recovery_capability(user_id_input uuid,token_hash_input text,verified_input boolean,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; t app_private.recovery_tokens;
begin
  cached:=app_private.begin_operation('issue_recovery_capability',jsonb_build_object('target',user_id_input,'hash',token_hash_input,'verified',verified_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  if verified_input is distinct from true then raise exception 'IDENTITY_VERIFICATION_REQUIRED' using errcode='22023'; end if;
  perform app_private.require_financial_reason(reason_input);
  perform 1 from public.memberships where user_id=user_id_input and status in ('active','suspended') for update;
  if not found then raise exception 'RECOVERY_UNAVAILABLE' using errcode='42501'; end if;
  update app_private.recovery_tokens set revoked_at=clock_timestamp() where user_id=user_id_input and revoked_at is null and consumed_at is null;
  insert into app_private.recovery_tokens(user_id,token_hash,expires_at,issued_by) values(user_id_input,token_hash_input,clock_timestamp()+interval '15 minutes',auth.uid()) returning * into t;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'recovery_issued','profiles',user_id_input,btrim(reason_input),jsonb_build_object('recovery_id',t.id,'expires_at',t.expires_at,'identity_verified_outside_app',true));
  return app_private.finish_operation(request_id,jsonb_build_object('recovery_id',t.id,'expires_at',t.expires_at));
end;
$$;
create function public.claim_recovery_capability(token_hash_input text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t app_private.recovery_tokens;
begin
  select * into t from app_private.recovery_tokens where token_hash=token_hash_input for update;
  if t.id is null or t.consumed_at is not null or t.revoked_at is not null or t.expires_at<=clock_timestamp()
    or not exists(select 1 from public.memberships where user_id=t.issued_by and role='admin' and status='active')
    or not exists(select 1 from public.memberships where user_id=t.user_id and status in ('active','suspended'))
  then raise exception 'RECOVERY_UNAVAILABLE' using errcode='42501'; end if;
  update app_private.recovery_tokens set consumed_at=clock_timestamp() where id=t.id;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata) values(t.issued_by,'recovery_claimed','profiles',t.user_id,jsonb_build_object('recovery_id',t.id));
  return jsonb_build_object('recovery_id',t.id,'user_id',t.user_id);
end;
$$;
create function public.finish_recovery_capability(recovery_id_input uuid,success_input boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare t app_private.recovery_tokens;
begin
  update app_private.recovery_tokens set completed_at=clock_timestamp(),outcome=case when success_input is true then 'completed' else 'provider_failed' end
    where id=recovery_id_input and consumed_at is not null and completed_at is null returning * into t;
  if t.id is null then return false; end if;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata) values(t.issued_by,'recovery_'||t.outcome,'profiles',t.user_id,jsonb_build_object('recovery_id',t.id,'refresh_sessions','provider_password_update','access_jwt','valid_until_expiry'));
  return true;
end;
$$;

-- Verified linking keeps stable identities/history. A duplicate is retired with a
-- pointer, never deleted/reparented across immutable financial records.
create function public.verify_and_link_guest(guest_id_input uuid,user_id_input uuid,verified_input boolean,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.guests; r record; canonical public.participants; retired public.participants; duplicates integer:=0;
begin
  cached:=app_private.begin_operation('verify_and_link_guest',jsonb_build_object('guest',guest_id_input,'user',user_id_input,'verified',verified_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  if verified_input is distinct from true then raise exception 'IDENTITY_VERIFICATION_REQUIRED' using errcode='22023'; end if;
  perform app_private.require_financial_reason(reason_input);
  -- First revoke capabilities (same lock order as guest_scope -> session).
  update app_private.guest_access_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where guest_id=guest_id_input;
  select * into g from public.guests where id=guest_id_input for update;
  if g.id is null or g.linked_user_id is not null then raise exception 'GUEST_UNAVAILABLE' using errcode='42501'; end if;
  perform 1 from public.memberships where user_id=user_id_input and status='active' for share;
  if not found then raise exception 'ACTIVE_MEMBER_REQUIRED' using errcode='42501'; end if;
  -- Lock every affected session in deterministic order before changing identity.
  perform 1 from public.sessions s where exists(select 1 from public.participants p join public.players pl on pl.id=p.player_id where p.session_id=s.id and (pl.user_id=user_id_input or pl.guest_id=g.id)) order by s.id for update;
  update public.guests set linked_user_id=user_id_input,verified_by=auth.uid(),updated_at=clock_timestamp() where id=g.id;
  for r in select p.session_id from public.participants p join public.players pl on pl.id=p.player_id
    where (pl.user_id=user_id_input or pl.guest_id=g.id) and p.merged_into_id is null group by p.session_id having count(*)>1 loop
    -- Prefer a confirmed participation, then a held offer, then waiting; earliest
    -- original priority breaks ties. Original timestamps on both rows stay intact.
    select p.* into canonical from public.participants p join public.players pl on pl.id=p.player_id where p.session_id=r.session_id and (pl.user_id=user_id_input or pl.guest_id=g.id) and p.merged_into_id is null
      order by case p.participation_status when 'confirmed' then 0 when 'offered' then 1 when 'waitlisted' then 2 when 'late_cancelled' then 3 else 4 end,p.queue_joined_at,p.id limit 1;
    select p.* into retired from public.participants p join public.players pl on pl.id=p.player_id where p.session_id=r.session_id and (pl.user_id=user_id_input or pl.guest_id=g.id) and p.merged_into_id is null and p.id<>canonical.id;
    update public.waitlist_offers set state='revoked' where participant_id=retired.id and state='pending';
    update public.participants set merged_into_id=canonical.id where id=retired.id;
    update public.participants set liability_percent=greatest(liability_percent,retired.liability_percent),charge_percent=greatest(charge_percent,retired.liability_percent) where id=canonical.id;
    insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata) values(auth.uid(),'guest_duplicate_resolved','participants',retired.id,btrim(reason_input),jsonb_build_object('canonical_id',canonical.id,'canonical_before',to_jsonb(canonical),'retired_before',to_jsonb(retired),'financial_history','retained_review_adjustments_separately'));
    duplicates:=duplicates+1;
  end loop;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata) values(auth.uid(),'guest_linked','guests',g.id,btrim(reason_input),jsonb_build_object('user_id',user_id_input,'duplicates',duplicates,'identity_verified_outside_app',true));
  return app_private.finish_operation(request_id,jsonb_build_object('linked',true,'duplicates',duplicates));
end;
$$;

create function public.get_guest_management() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform public.assert_active_membership();
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('guests',coalesce((select jsonb_agg(to_jsonb(r)) from (
    select g.*,app_private.guest_uses(g.id,null) uses_reserved_or_counted,
      coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'session_id',t.session_id,'expires_at',t.expires_at,'revoked_at',t.revoked_at,'exchanged',t.exchanged_at is not null)) from app_private.guest_access_tokens t where t.guest_id=g.id),'[]'::jsonb) invitations
      from public.guests g order by g.created_at) r),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'phone',p.phone,'status',m.status)) from public.profiles p join public.memberships m on m.user_id=p.id where m.status in ('active','suspended')),'[]'::jsonb));
end;
$$;

-- Canonical projections and member allocation replacements follow.
create or replace function app_private.get_session_snapshot_base(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.sessions; p public.participants; at_value timestamptz := statement_timestamp(); open_value boolean;
begin
  perform public.assert_active_membership();
  select * into s from public.sessions where id=session_id_input and app_private.can_read_session(id);
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  select * into p from public.participants where session_id=s.id and merged_into_id is null and app_private.owns_player(player_id);
  open_value := s.operational_status in ('voting_open','joining_open') and at_value<s.starts_at;
  return jsonb_build_object('session',to_jsonb(s),'server_now',at_value,'participation',case when p.id is not null then to_jsonb(p) end,
    'vote',(select v.choice from public.votes v join public.polls po on po.id=v.poll_id where po.session_id=s.id and v.user_id=auth.uid()),
    'roster',coalesce((select jsonb_agg(to_jsonb(r)) from public.get_session_roster(s.id) r),'[]'::jsonb),
    'counts',jsonb_build_object('confirmed',(select count(*) from public.participants where session_id=s.id and merged_into_id is null and participation_status='confirmed'),
      'held',(select count(*) from public.participants pa where pa.session_id=s.id and pa.merged_into_id is null and pa.participation_status='offered' and exists(select 1 from public.waitlist_offers o where o.participant_id=pa.id and o.state='pending' and o.expires_at>at_value)),
      'waiting',(select count(*) from public.participants where session_id=s.id and merged_into_id is null and participation_status='waitlisted')),
    'can_vote',open_value and at_value<s.voting_closes_at and exists(select 1 from public.polls where session_id=s.id and status='open' and opens_at<=at_value and closes_at>at_value),
    'can_join',open_value and at_value>=s.voting_closes_at,
    'can_withdraw',open_value and p.participation_status in ('confirmed','waitlisted','offered'),
    'withdrawal_percent',greatest(coalesce(p.liability_percent,0),app_private.withdrawal_percentage(s.starts_at,at_value,coalesce(p.participation_status='confirmed',false))));
end;
$$;

create or replace function app_private.actor_player() returns uuid
language plpgsql security definer set search_path='' as $$
declare player_id_value uuid;
begin
  select p.id into player_id_value from public.players p left join public.guests g on g.id=p.guest_id
    where p.user_id=auth.uid() or g.linked_user_id=auth.uid() order by (p.user_id is not null) desc,p.id limit 1;
  if player_id_value is null then
    insert into public.players(user_id) values(auth.uid()) on conflict(user_id) do nothing;
    select id into player_id_value from public.players where user_id=auth.uid();
  end if;
  return player_id_value;
end;
$$;
create or replace function app_private.allocate_participation(session_input public.sessions,source_input text,at_input timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare player_id_value uuid; previous public.participants; current_row public.participants; occupied integer; queued boolean; new_status text;
begin
  player_id_value := app_private.actor_player();
  select * into previous from public.participants where session_id=session_input.id and merged_into_id is null and app_private.owns_player(player_id);
  if previous.id is not null then player_id_value:=previous.player_id; end if;
  if previous.participation_status in ('confirmed','waitlisted','offered') then return app_private.participation_result(previous.id); end if;
  select count(*) into occupied from public.participants p where p.session_id=session_input.id and p.merged_into_id is null and
    (p.participation_status='confirmed' or (p.participation_status='offered' and exists(select 1 from public.waitlist_offers o where o.participant_id=p.id and o.state='pending' and o.expires_at>at_input)));
  select exists(select 1 from public.participants where session_id=session_input.id and merged_into_id is null and participation_status in ('waitlisted','offered')) into queued;
  new_status := case when occupied<session_input.capacity and not queued then 'confirmed' else 'waitlisted' end;
  if previous.id is null then
    insert into public.participants(session_id,player_id,source,queue_joined_at,participation_status,attendance,confirmed_at,charge_percent)
      values(session_input.id,player_id_value,source_input,at_input,new_status,
        case when new_status='confirmed' then 'unmarked' else 'not_applicable' end,
        case when new_status='confirmed' then at_input end,case when new_status='confirmed' then 100 else 0 end) returning * into current_row;
  else
    update public.participants set source=source_input,queue_joined_at=at_input,participation_status=new_status,
      attendance=case when new_status='confirmed' then 'unmarked' else 'not_applicable' end,
      confirmed_at=case when new_status='confirmed' then at_input end,withdrawn_at=null,
      charge_percent=case when new_status='confirmed' then 100 else liability_percent end
      where id=previous.id returning * into current_row;
  end if;
  perform app_private.audit_participation(previous,current_row);
  return app_private.participation_result(current_row.id);
end;
$$;
create or replace function app_private.waitlist_occupancy(session_id_input uuid,at_input timestamptz) returns integer
language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.participants p where p.session_id=session_id_input and p.merged_into_id is null and
    (p.participation_status='confirmed' or (p.participation_status='offered' and exists(
      select 1 from public.waitlist_offers o where o.participant_id=p.id and o.state='pending' and o.expires_at>at_input)));
$$;
create or replace function app_private.create_waitlist_offer(participant_id_input uuid,at_input timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.participants; changed public.participants; s public.sessions; o public.waitlist_offers; recipient uuid;
begin
  select * into p from public.participants where id=participant_id_input;
  select * into s from public.sessions where id=p.session_id;
  if p.id is null or p.merged_into_id is not null or p.participation_status<>'waitlisted' or not app_private.waitlist_eligible(p.player_id,p.id) then
    raise exception 'PLAYER_NOT_WAITING' using errcode='22023'; end if;
  if s.operational_status not in ('voting_open','joining_open') or at_input>=s.starts_at then
    raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
  if at_input+interval '15 minutes'>s.starts_at then raise exception 'OFFER_WINDOW_CLOSED' using errcode='22023'; end if;
  if app_private.waitlist_occupancy(s.id,at_input)>=s.capacity then raise exception 'NO_VACANCY' using errcode='22023'; end if;
  insert into public.waitlist_offers(participant_id,offered_at,expires_at)
    values(p.id,at_input,at_input+interval '15 minutes') returning * into o;
  update public.participants set participation_status='offered',attendance='not_applicable',charge_percent=liability_percent
    where id=p.id returning * into changed;
  perform app_private.audit_participation(p,changed);
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata)
    values(auth.uid(),'waitlist_offer_created','waitlist_offers',o.id,jsonb_build_object('session_id',s.id,'participant_id',p.id,'expires_at',o.expires_at));
  select coalesce(pl.user_id,g.linked_user_id) into recipient from public.players pl left join public.guests g on g.id=pl.guest_id where pl.id=p.player_id;
  perform app_private.persist_notification(recipient,'offer:'||o.id||':'||recipient,'waitlist_offer',
    jsonb_build_object('session_id',s.id,'session_title',s.title,'offer_id',o.id,'expires_at',o.expires_at));
  return jsonb_build_object('offer_id',o.id,'offer_state','pending','expires_at',o.expires_at)||app_private.participation_result(p.id);
end;
$$;
create or replace function app_private.reconcile_waitlist(session_id_input uuid,at_input timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare s public.sessions; o public.waitlist_offers; before_p public.participants; after_p public.participants; next_id uuid; recipient uuid; end_state text;
begin
  -- Every caller owns this session's lock before supplying at_input.
  select * into s from public.sessions where id=session_id_input;
  if s.id is null then return; end if;
  for o in select wo.* from public.waitlist_offers wo join public.participants p on p.id=wo.participant_id
    where p.session_id=s.id and wo.state='pending' and
      (wo.expires_at<=at_input or at_input>=s.starts_at or s.operational_status not in ('voting_open','joining_open'))
    order by wo.id loop
    end_state:=case when s.operational_status not in ('voting_open','joining_open') then 'revoked' else 'expired' end;
    update public.waitlist_offers set state=end_state where id=o.id;
    select * into before_p from public.participants where id=o.participant_id;
    update public.participants set participation_status='offer_expired',charge_percent=liability_percent,attendance='not_applicable'
      where id=o.participant_id and participation_status='offered' returning * into after_p;
    if after_p.id is not null then perform app_private.audit_participation(before_p,after_p); end if;
    insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata)
      values(auth.uid(),'waitlist_offer_'||end_state,'waitlist_offers',o.id,jsonb_build_object('session_id',s.id));
    select coalesce(pl.user_id,g.linked_user_id) into recipient from public.players pl left join public.guests g on g.id=pl.guest_id where pl.id=before_p.player_id;
    perform app_private.persist_notification(recipient,'offer_'||end_state||':'||o.id||':'||recipient,'waitlist_offer_'||end_state,
      jsonb_build_object('session_id',s.id,'session_title',s.title,'offer_id',o.id));
  end loop;
  if s.waitlist_mode<>'automatic' or s.operational_status not in ('voting_open','joining_open') or at_input+interval '15 minutes'>s.starts_at then return; end if;
  while app_private.waitlist_occupancy(s.id,at_input)<s.capacity loop
    select p.id into next_id from public.participants p where p.session_id=s.id and p.merged_into_id is null and p.participation_status='waitlisted'
      and app_private.waitlist_eligible(p.player_id,p.id) order by p.queue_joined_at,p.id limit 1;
    exit when next_id is null;
    perform app_private.create_waitlist_offer(next_id,at_input);
  end loop;
end;
$$;
create or replace function app_private.resolve_offer_locked(offer_id_input uuid,accept_input boolean,at_input timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.waitlist_offers; p public.participants; changed public.participants; s public.sessions; state_value text; recipient uuid;
begin
  select * into o from public.waitlist_offers where id=offer_id_input;
  select * into p from public.participants where id=o.participant_id;
  select * into s from public.sessions where id=p.session_id;
  if p.merged_into_id is not null or o.state<>'pending' or p.participation_status<>'offered' then raise exception 'OFFER_NOT_PENDING' using errcode='22023'; end if;
  if s.operational_status not in ('voting_open','joining_open') then state_value:='revoked';
  elsif at_input>=o.expires_at or at_input>=s.starts_at then state_value:='expired';
  elsif accept_input then state_value:='accepted'; else state_value:='declined'; end if;
  -- Recheck capacity even if trusted fixture data was inconsistent.
  if state_value='accepted' and app_private.waitlist_occupancy(s.id,at_input)>s.capacity then raise exception 'NO_VACANCY' using errcode='22023'; end if;
  update public.waitlist_offers set state=state_value,response_at=case when state_value in ('accepted','declined') then at_input end where id=o.id;
  update public.participants set participation_status=case when state_value='accepted' then 'confirmed' when state_value='declined' then 'offer_declined' else 'offer_expired' end,
    confirmed_at=case when state_value='accepted' then at_input else confirmed_at end,
    charge_percent=case when state_value='accepted' then 100 else liability_percent end,
    attendance=case when state_value='accepted' then 'unmarked' else 'not_applicable' end
    where id=p.id returning * into changed;
  perform app_private.audit_participation(p,changed);
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata)
    values(auth.uid(),'waitlist_offer_'||state_value,'waitlist_offers',o.id,jsonb_build_object('session_id',s.id,'responded_at',at_input));
  select coalesce(pl.user_id,g.linked_user_id) into recipient from public.players pl left join public.guests g on g.id=pl.guest_id where pl.id=p.player_id;
  perform app_private.persist_notification(recipient,'offer_'||state_value||':'||o.id||':'||recipient,'waitlist_offer_'||state_value,
    jsonb_build_object('session_id',s.id,'session_title',s.title,'offer_id',o.id));
  perform app_private.reconcile_waitlist(s.id,at_input);
  return jsonb_build_object('offer_id',o.id,'offer_state',state_value)||app_private.participation_result(p.id);
end;
$$;
create or replace function public.admin_confirm_late_slot(participant_id_input uuid,consent_input boolean,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; p public.participants; changed public.participants; s public.sessions; at_value timestamptz;
begin
  cached:=app_private.begin_operation('admin_confirm_late_slot',jsonb_build_object('participant_id',participant_id_input,'consent',consent_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  if consent_input is distinct from true then raise exception 'CONSENT_REQUIRED' using errcode='22023'; end if;
  if reason_input is null or char_length(btrim(reason_input)) not between 1 and 2000 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
  select * into p from public.participants where id=participant_id_input;
  select * into s from public.sessions where id=p.session_id for update;
  at_value:=clock_timestamp();
  select * into p from public.participants where id=participant_id_input;
  if s.id is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode='42501'; end if;
  if at_value>=s.starts_at then raise exception 'SESSION_STARTED' using errcode='22023'; end if;
  if s.operational_status not in ('voting_open','joining_open') then raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
  if at_value+interval '15 minutes'<=s.starts_at then raise exception 'USE_TIMED_OFFER' using errcode='22023'; end if;
  if p.merged_into_id is not null or p.participation_status<>'waitlisted' or not app_private.waitlist_eligible(p.player_id,p.id) then raise exception 'PLAYER_NOT_WAITING' using errcode='22023'; end if;
  if app_private.waitlist_occupancy(s.id,at_value)>=s.capacity then raise exception 'NO_VACANCY' using errcode='22023'; end if;
  update public.participants set participation_status='confirmed',source='admin',confirmed_at=at_value,charge_percent=100,attendance='unmarked'
    where id=p.id returning * into changed;
  perform app_private.audit_participation(p,changed);
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'admin_confirm_late_slot','participants',p.id,btrim(reason_input),jsonb_build_object('session_id',s.id,'player_consent',true,'queue_override',exists(select 1 from public.participants where session_id=s.id and participation_status='waitlisted' and (queue_joined_at,id)<(p.queue_joined_at,p.id))));
  return app_private.finish_operation(request_id,app_private.participation_result(p.id));
end;
$$;
create or replace function public.get_session_roster(session_id_input uuid)
returns table(session_id uuid,participant_id uuid,display_name text,participation_status text,attendance text)
language sql stable security definer set search_path='' as $$
  select p.session_id,p.id,coalesce(pr.display_name,g.name),p.participation_status,p.attendance
  from public.participants p join public.players pl on pl.id=p.player_id
  left join public.profiles pr on pr.id=pl.user_id left join public.guests g on g.id=pl.guest_id
  where p.session_id=session_id_input and p.merged_into_id is null and app_private.can_read_session(p.session_id)
  order by p.queue_joined_at,p.id;
$$;
create or replace function public.get_session_snapshot(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
  result_value:=app_private.get_session_snapshot_base(session_id_input);
  return result_value||jsonb_build_object('offer',(select to_jsonb(o) from public.waitlist_offers o
    where o.participant_id=(result_value->'participation'->>'id')::uuid and o.state='pending'));
end;
$$;
create or replace function app_private.withdraw_participation_base(participant_id_input uuid,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; sid uuid; at_value timestamptz; p public.participants;
begin
  cached := app_private.begin_operation('withdraw_participation',jsonb_build_object('participant_id',participant_id_input),request_id);
  if cached is not null then return cached; end if;
  select session_id into sid from public.participants where id=participant_id_input and merged_into_id is null and app_private.owns_player(player_id);
  if sid is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode='42501'; end if;
  select * into s from public.sessions where id=sid for update;
  at_value := clock_timestamp();
  if s.operational_status not in ('voting_open','joining_open') then raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
  if at_value>=s.starts_at then raise exception 'SESSION_STARTED' using errcode='22023'; end if;
  select * into p from public.participants where id=participant_id_input and merged_into_id is null and app_private.owns_player(player_id);
  if p.id is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode='42501'; end if;
  return app_private.finish_operation(request_id,app_private.withdraw_locked(p.id,s,at_value));
end;
$$;
create or replace function app_private.fee_preview_before_payments(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.sessions; costs public.session_costs; rows_value jsonb; result_value jsonb;
begin
  select * into s from public.sessions where id=session_id_input;
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  select * into costs from public.session_costs where session_id=s.id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.queue_joined_at,r.participant_id),'[]'::jsonb) into rows_value from (
    select p.id participant_id,coalesce(pr.display_name,g.name) display_name,p.queue_joined_at,p.merged_into_id,p.participation_status,p.attendance,p.confirmed_at,p.withdrawn_at,p.liability_percent,
      case when s.operational_status='cancelled' or p.merged_into_id is not null then 0 when p.participation_status='confirmed' then 100
        when p.participation_status='late_cancelled' then 75 else p.liability_percent end percent,
      case when s.operational_status='cancelled' or p.merged_into_id is not null then 0
        when p.participation_status='confirmed' and p.attendance not in ('present','no_show') then null
        else app_private.charge_amount(costs.full_fee_sen,case when p.participation_status='confirmed' then 100
          when p.participation_status='late_cancelled' then 75 else p.liability_percent end) end amount_sen
    from public.participants p join public.players pl on pl.id=p.player_id left join public.profiles pr on pr.id=pl.user_id
      left join public.guests g on g.id=pl.guest_id where p.session_id=s.id
  ) r;
  result_value:=jsonb_build_object('session',to_jsonb(s),'costs',case when costs.session_id is not null then to_jsonb(costs) end,'rows',rows_value,
    'unmarked_count',(select count(*) from public.participants where session_id=s.id and merged_into_id is null and participation_status='confirmed' and (confirmed_at is null or attendance not in ('present','no_show'))),
    'latest_version',coalesce((select max(version) from public.fee_versions where session_id=s.id),0));
  -- Covers dates/status, draft costs, eligibility and latest published version.
  -- The caller must submit the exact state they reviewed, under the session lock.
  return result_value||jsonb_build_object('review_token',md5(result_value::text));
end;
$$;

create or replace function app_private.cast_session_vote_base(session_id_input uuid,choice_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; result_value jsonb; s public.sessions; poll public.polls; previous_vote public.votes; current_vote public.votes; p public.participants; at_value timestamptz; player_id_value uuid;
begin
  cached := app_private.begin_operation('cast_session_vote',jsonb_build_object('session_id',session_id_input,'choice',choice_input),request_id);
  if cached is not null then return cached; end if;
  if choice_input is null or choice_input not in ('play','pass') then raise exception 'INVALID_VOTE' using errcode='22023'; end if;
  select * into s from public.sessions where id=session_id_input for update;
  at_value := clock_timestamp();
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  if s.operational_status not in ('voting_open','joining_open') then raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
  if at_value>=s.starts_at then raise exception 'SESSION_STARTED' using errcode='22023'; end if;
  select * into poll from public.polls where session_id=s.id;
  if at_value>=s.voting_closes_at or poll.id is null or poll.status<>'open' or at_value<poll.opens_at or at_value>=poll.closes_at then raise exception 'VOTING_CLOSED' using errcode='22023'; end if;
  select * into previous_vote from public.votes where poll_id=poll.id and user_id=auth.uid();
  if choice_input='play' then result_value := app_private.allocate_participation(s,'vote',at_value);
  else
    player_id_value := app_private.actor_player();
    select * into p from public.participants where session_id=s.id and player_id=player_id_value;
    result_value := case when p.id is null then jsonb_build_object('participant_id',null,'participation_status','not_playing','charge_percent',0,'liability_percent',0,'queue_joined_at',null)
      else app_private.withdraw_locked(p.id,s,at_value) end;
  end if;
  insert into public.votes(poll_id,user_id,choice,joined_at)
    values(poll.id,auth.uid(),choice_input,case when choice_input='play' then (result_value->>'queue_joined_at')::timestamptz end)
    on conflict(poll_id,user_id) do update set choice=excluded.choice,joined_at=excluded.joined_at,updated_at=at_value returning * into current_vote;
  if previous_vote.choice is distinct from current_vote.choice or previous_vote.joined_at is distinct from current_vote.joined_at then
    insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata) values(auth.uid(),'vote_changed','votes',current_vote.id,jsonb_build_object('session_id',s.id,'before',to_jsonb(previous_vote),'after',to_jsonb(current_vote)));
  end if;
  return app_private.finish_operation(request_id,result_value);
end;
$$;
create or replace function public.set_attendance(participant_id_input uuid,attendance_input text,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; p public.participants; sid uuid;
begin
  cached:=app_private.begin_operation('set_attendance',jsonb_build_object('participant_id',participant_id_input,'attendance',attendance_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  select session_id into sid from public.participants where id=participant_id_input;
  select * into s from public.sessions where id=sid for update;
  if s.id is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode='42501'; end if;
  if s.operational_status in ('draft','cancelled') or clock_timestamp()<s.starts_at then
    raise exception 'ATTENDANCE_NOT_OPEN' using errcode='22023';
  end if;
  select * into p from public.participants where id=participant_id_input for update;
  if p.merged_into_id is not null or p.participation_status<>'confirmed' or p.confirmed_at is null then raise exception 'ATTENDANCE_NOT_ELIGIBLE' using errcode='22023'; end if;
  if attendance_input is null or attendance_input not in ('present','no_show') then raise exception 'INVALID_ATTENDANCE' using errcode='22023'; end if;
  if p.attendance is distinct from attendance_input then
    if (p.attendance<>'unmarked' or s.billing_status<>'not_published') and nullif(btrim(reason_input),'') is null then
      raise exception 'REASON_REQUIRED' using errcode='22023';
    end if;
    if char_length(reason_input)>2000 then raise exception 'INVALID_REASON' using errcode='22023'; end if;
    update public.participants set attendance=attendance_input where id=p.id;
    insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
      values(auth.uid(),'attendance_set','participants',p.id,nullif(btrim(reason_input),''),jsonb_build_object('before',p.attendance,'after',attendance_input,'session_id',s.id));
  end if;
  return app_private.finish_operation(request_id,jsonb_build_object('participant_id',p.id,'attendance',attendance_input));
end;
$$;
create or replace function public.get_waitlist_queue(session_id_input uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform public.assert_active_membership();
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('server_now',statement_timestamp(),'queue',coalesce((select jsonb_agg(to_jsonb(q) order by q.queue_joined_at,q.participant_id) from (
    select p.id participant_id,coalesce(pr.display_name,g.name) display_name,p.participation_status,p.queue_joined_at,
      app_private.waitlist_eligible(p.player_id,p.id) eligible,
      (select to_jsonb(o) from public.waitlist_offers o where o.participant_id=p.id and o.state='pending') offer
    from public.participants p join public.players pl on pl.id=p.player_id left join public.profiles pr on pr.id=pl.user_id
      left join public.guests g on g.id=pl.guest_id where p.session_id=session_id_input and p.merged_into_id is null and p.participation_status in ('waitlisted','offered')
  ) q),'[]'::jsonb));
end;
$$;

create or replace function public.admin_offer_slot(participant_id_input uuid,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; at_value timestamptz; first_id uuid; result_value jsonb;
begin
  cached:=app_private.begin_operation('admin_offer_slot',jsonb_build_object('participant_id',participant_id_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  if reason_input is null or char_length(btrim(reason_input)) not between 1 and 2000 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
  select session_id into sid from public.participants where id=participant_id_input;
  if sid is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode='42501'; end if;
  perform 1 from public.sessions where id=sid for update;
  at_value:=clock_timestamp();
  -- Expire stale holds without creating automatic offers before this override.
  -- Creation independently counts only live holds; the job later reconciles the rest.
  select p.id into first_id from public.participants p where p.session_id=sid and p.participation_status='waitlisted'
    and app_private.waitlist_eligible(p.player_id,p.id) order by p.queue_joined_at,p.id limit 1;
  result_value:=app_private.create_waitlist_offer(participant_id_input,at_value);
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'admin_offer_slot','participants',participant_id_input,btrim(reason_input),jsonb_build_object('session_id',sid,'queue_override',first_id is distinct from participant_id_input));
  return app_private.finish_operation(request_id,result_value);
end;
$$;

-- Explicit ACLs for every new function; replacements retain previous ACLs.
revoke all on function app_private.waitlist_eligible(uuid,uuid),app_private.guest_uses(uuid,uuid),app_private.enforce_guest_reservation(),app_private.guest_scope(text),app_private.submit_payment_locked(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.consume_capability_budget(text,integer),public.exchange_guest_capability(text,text),public.guest_portal_action(text,text,jsonb,uuid),public.claim_recovery_capability(text),public.finish_recovery_capability(uuid,boolean) from public,anon,authenticated;
grant execute on function public.consume_capability_budget(text,integer),public.exchange_guest_capability(text,text),public.guest_portal_action(text,text,jsonb,uuid),public.claim_recovery_capability(text),public.finish_recovery_capability(uuid,boolean) to service_role;
revoke all on function public.issue_guest_invitation(uuid,uuid,text,text,text,boolean,text,uuid),public.revoke_guest_invitation(uuid,text,uuid),public.verify_and_link_guest(uuid,uuid,boolean,text,uuid),public.get_guest_management(),public.issue_recovery_capability(uuid,text,boolean,text,uuid) from public,anon,service_role;
grant execute on function public.issue_guest_invitation(uuid,uuid,text,text,text,boolean,text,uuid),public.revoke_guest_invitation(uuid,text,uuid),public.verify_and_link_guest(uuid,uuid,boolean,text,uuid),public.get_guest_management(),public.issue_recovery_capability(uuid,text,boolean,text,uuid) to authenticated;
commit;
