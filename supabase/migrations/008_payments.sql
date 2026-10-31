-- Task 6: private receipts and audited full-payment financial transitions.
begin;

create table app_private.receipt_checks (
  object_id uuid primary key,
  object_path text not null unique,
  owner_id text not null,
  size_bytes integer not null check(size_bytes between 1 and 5242880),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf')),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz not null default clock_timestamp()
);
alter table app_private.receipt_checks enable row level security;
revoke all on app_private.receipt_checks from public,anon,authenticated,service_role;
revoke update,delete on public.payments from service_role;

create function app_private.protect_payment() returns trigger
language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-array['status','verified_by','verified_at','rejection_reason','refund_status','refunded_at','refund_reason'])
    is distinct from (to_jsonb(old)-array['status','verified_by','verified_at','rejection_reason','refund_status','refunded_at','refund_reason'])
    or (old.status<>'submitted' and (to_jsonb(new)-array['refund_status','refunded_at','refund_reason']) is distinct from (to_jsonb(old)-array['refund_status','refunded_at','refund_reason']))
    or (old.refund_status='refunded' and new is distinct from old)
  then raise exception 'IMMUTABLE_PAYMENT' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger immutable_payment before update on public.payments for each row execute function app_private.protect_payment();

-- Same transaction ledger as participation, with suspended own-payment access.
create function app_private.begin_payment_operation(operation_input text,payload_input jsonb,request_id_input uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing app_private.operation_requests;
begin
  perform 1 from public.memberships where user_id=auth.uid() and status in ('active','suspended') for share;
  if not found then raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode='42501'; end if;
  if request_id_input is null then raise exception 'INVALID_REQUEST_ID' using errcode='22023'; end if;
  insert into app_private.operation_requests(actor_user_id,request_id,operation,payload)
    values(auth.uid(),request_id_input,operation_input,payload_input) on conflict do nothing;
  select * into existing from app_private.operation_requests where actor_user_id=auth.uid() and request_id=request_id_input for update;
  if existing.operation<>operation_input or existing.payload is distinct from payload_input then raise exception 'REQUEST_ID_CONFLICT' using errcode='22023'; end if;
  return existing.result;
end;
$$;
create function app_private.require_financial_reason(reason_input text) returns void
language plpgsql set search_path='' as $$
begin
  if nullif(btrim(reason_input),'') is null then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
  if char_length(reason_input)>2000 then raise exception 'INVALID_REASON' using errcode='22023'; end if;
end;
$$;

-- Called only by the server after downloading and inspecting actual bytes.
-- Storage metadata is read-only here; objects are managed through Storage API.
create function public.attest_receipt_upload(object_path_input text,size_bytes_input integer,mime_type_input text,sha256_input text) returns boolean
language plpgsql security definer set search_path='' as $$
declare o storage.objects;
begin
  select * into o from storage.objects where bucket_id='receipts' and name=object_path_input;
  if o.id is null or object_path_input !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|pdf)$'
    or o.owner_id is distinct from split_part(object_path_input,'/',1)
    or size_bytes_input is null or size_bytes_input not between 1 and 5242880
    or mime_type_input is null or mime_type_input not in ('image/jpeg','image/png','application/pdf')
    or (case when object_path_input ~ '\.pdf$' then 'application/pdf' when object_path_input ~ '\.png$' then 'image/png' else 'image/jpeg' end)<>mime_type_input
    or o.metadata->>'size' is distinct from size_bytes_input::text
    or o.metadata->>'mimetype' is distinct from mime_type_input
    or sha256_input is null or sha256_input !~ '^[a-f0-9]{64}$'
  then raise exception 'INVALID_RECEIPT' using errcode='22023'; end if;
  insert into app_private.receipt_checks(object_id,object_path,owner_id,size_bytes,mime_type,sha256)
    values(o.id,o.name,o.owner_id,size_bytes_input,mime_type_input,sha256_input)
    on conflict(object_id) do nothing;
  return true;
end;
$$;

create function public.submit_payment(charge_id_input uuid,receipt_path_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; c public.charges; s public.sessions; payment_id_value uuid;
begin
  cached:=app_private.begin_payment_operation('submit_payment',jsonb_build_object('charge_id',charge_id_input,'receipt_path',receipt_path_input),request_id);
  if not app_private.owns_charge(charge_id_input) then raise exception 'CHARGE_ACCESS_DENIED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  select * into s from public.sessions where id=(select session_id from public.charges where id=charge_id_input) for update;
  select * into c from public.charges where id=charge_id_input for update;
  if s.operational_status='cancelled' or not c.is_current or c.status<>'unpaid' or c.amount_sen<=0
    or exists(select 1 from public.payments where charge_id=c.id and status in ('submitted','approved'))
  then raise exception 'CHARGE_NOT_PAYABLE' using errcode='22023'; end if;
  if receipt_path_input is null or split_part(receipt_path_input,'/',1)<>auth.uid()::text or split_part(receipt_path_input,'/',2)<>c.id::text
    or not exists(select 1 from storage.objects o join app_private.receipt_checks rc on rc.object_id=o.id and rc.object_path=o.name
      where o.bucket_id='receipts' and o.name=receipt_path_input and o.owner_id=auth.uid()::text and rc.owner_id=o.owner_id
        and o.metadata->>'size'=rc.size_bytes::text and o.metadata->>'mimetype'=rc.mime_type)
  then raise exception 'RECEIPT_NOT_READY' using errcode='22023'; end if;
  if exists(select 1 from public.payments where receipt_object_path=receipt_path_input) then raise exception 'RECEIPT_ALREADY_USED' using errcode='22023'; end if;
  insert into public.payments(charge_id,method,amount_sen,receipt_object_path,submitted_by,idempotency_key)
    values(c.id,'transfer',c.amount_sen,receipt_path_input,auth.uid(),request_id) returning id into payment_id_value;
  update public.charges set status='pending_verification' where id=c.id;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata)
    values(auth.uid(),'payment_submitted','payments',payment_id_value,jsonb_build_object('charge_id',c.id,'amount_sen',c.amount_sen));
  return app_private.finish_operation(request_id,jsonb_build_object('payment_id',payment_id_value,'status','submitted','amount_sen',c.amount_sen));
end;
$$;

create function public.review_payment(payment_id_input uuid,approve_input boolean,bank_checked_input boolean,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; c public.charges; p public.payments; result_value jsonb;
begin
  cached:=app_private.begin_operation('review_payment',jsonb_build_object('payment_id',payment_id_input,'approve',approve_input,'bank_checked',bank_checked_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  select * into s from public.sessions where id=(select session_id from public.charges where id=(select charge_id from public.payments where id=payment_id_input)) for update;
  select * into c from public.charges where id=(select charge_id from public.payments where id=payment_id_input) for update;
  select * into p from public.payments where id=payment_id_input for update;
  if p.id is null then raise exception 'PAYMENT_NOT_FOUND' using errcode='42501'; end if;
  if p.status<>'submitted' then raise exception 'PAYMENT_ALREADY_REVIEWED' using errcode='22023'; end if;
  if not c.is_current or c.status<>'pending_verification' or s.operational_status='cancelled' or p.amount_sen<>c.amount_sen or p.method<>'transfer'
    then raise exception 'CHARGE_NOT_PAYABLE' using errcode='22023'; end if;
  if approve_input is null then raise exception 'INVALID_DECISION' using errcode='22023'; end if;
  if approve_input and bank_checked_input is distinct from true then raise exception 'BANK_CHECK_REQUIRED' using errcode='22023'; end if;
  if not approve_input then perform app_private.require_financial_reason(reason_input); end if;
  if char_length(reason_input)>2000 then raise exception 'INVALID_REASON' using errcode='22023'; end if;
  update public.payments set status=case when approve_input then 'approved' else 'rejected' end,
    verified_by=auth.uid(),verified_at=clock_timestamp(),rejection_reason=case when not approve_input then btrim(reason_input) end where id=p.id;
  update public.charges set status=case when approve_input then 'paid' else 'unpaid' end where id=c.id;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),case when approve_input then 'payment_approved' else 'payment_rejected' end,'payments',p.id,nullif(btrim(reason_input),''),jsonb_build_object('charge_id',c.id,'amount_sen',p.amount_sen,'bank_checked',approve_input));
  result_value:=jsonb_build_object('payment_id',p.id,'status',case when approve_input then 'approved' else 'rejected' end);
  return app_private.finish_operation(request_id,result_value);
end;
$$;

create function public.record_cash_payment(charge_id_input uuid,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; c public.charges; pid uuid;
begin
  cached:=app_private.begin_operation('record_cash_payment',jsonb_build_object('charge_id',charge_id_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  perform app_private.require_financial_reason(reason_input);
  select * into s from public.sessions where id=(select session_id from public.charges where id=charge_id_input) for update;
  select * into c from public.charges where id=charge_id_input for update;
  if c.id is null then raise exception 'CHARGE_ACCESS_DENIED' using errcode='42501'; end if;
  if s.operational_status='cancelled' or not c.is_current or c.status<>'unpaid' or c.amount_sen<=0
    or exists(select 1 from public.payments where charge_id=c.id and status in ('submitted','approved')) then raise exception 'CHARGE_NOT_PAYABLE' using errcode='22023'; end if;
  insert into public.payments(charge_id,method,amount_sen,status,submitted_by,verified_by,verified_at,idempotency_key)
    values(c.id,'cash',c.amount_sen,'approved',auth.uid(),auth.uid(),clock_timestamp(),request_id) returning id into pid;
  update public.charges set status='paid' where id=c.id;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'cash_payment_recorded','payments',pid,btrim(reason_input),jsonb_build_object('charge_id',c.id,'amount_sen',c.amount_sen));
  return app_private.finish_operation(request_id,jsonb_build_object('payment_id',pid,'status','approved','amount_sen',c.amount_sen));
end;
$$;

create function public.cancel_session(session_id_input uuid,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions;
begin
  cached:=app_private.begin_operation('cancel_session',jsonb_build_object('session_id',session_id_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  perform app_private.require_financial_reason(reason_input);
  select * into s from public.sessions where id=session_id_input for update;
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  if s.operational_status<>'cancelled' then
    update public.sessions set operational_status='cancelled',billing_status='voided',updated_at=clock_timestamp() where id=s.id;
    update public.polls set status='cancelled' where session_id=s.id;
    update public.waitlist_offers set state='revoked' where state='pending' and participant_id in(select id from public.participants where session_id=s.id);
    update public.charges set status='voided' where session_id=s.id and status in ('unpaid','pending_verification');
    update public.payments set status='rejected',verified_by=auth.uid(),verified_at=clock_timestamp(),rejection_reason='Session cancelled: '||btrim(reason_input)
      where status='submitted' and charge_id in(select id from public.charges where session_id=s.id);
    update public.payments set refund_status='pending',refund_reason='Session cancelled: '||btrim(reason_input)
      where status='approved' and refund_status='none' and charge_id in(select id from public.charges where session_id=s.id);
    insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
      values(auth.uid(),'session_cancelled','sessions',s.id,btrim(reason_input),jsonb_build_object('previous_status',s.operational_status,'refunds','manual_pending','received_sen',(select coalesce(sum(p.amount_sen),0) from public.payments p join public.charges c on c.id=p.charge_id where c.session_id=s.id and p.status='approved')));
  end if;
  return app_private.finish_operation(request_id,jsonb_build_object('session_id',s.id,'status','cancelled','refunds','manual'));
end;
$$;

create function public.record_payment_refund(payment_id_input uuid,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; p public.payments;
begin
  cached:=app_private.begin_operation('record_payment_refund',jsonb_build_object('payment_id',payment_id_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  perform app_private.require_financial_reason(reason_input);
  perform 1 from public.sessions where id=(select session_id from public.charges where id=(select charge_id from public.payments where id=payment_id_input)) for update;
  select * into p from public.payments where id=payment_id_input for update;
  if p.id is null then raise exception 'PAYMENT_NOT_FOUND' using errcode='42501'; end if;
  if p.status<>'approved' or p.refund_status<>'pending' then raise exception 'REFUND_NOT_PENDING' using errcode='22023'; end if;
  update public.payments set refund_status='refunded',refunded_at=clock_timestamp(),refund_reason=btrim(reason_input) where id=p.id;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'payment_refund_recorded','payments',p.id,btrim(reason_input),jsonb_build_object('amount_sen',p.amount_sen,'method',p.method));
  return app_private.finish_operation(request_id,jsonb_build_object('payment_id',p.id,'refund_status','refunded'));
end;
$$;

-- Safe projection includes the session title/date for suspended own history,
-- without granting access to sessions/rosters or any foreign player's debt.
create function public.get_payment_history() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.memberships where user_id=auth.uid() and status in ('active','suspended')) then raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
    select c.*,s.title session_title,s.starts_at,s.operational_status session_status,f.version fee_version,
      coalesce(pr.display_name,g.name) display_name,
      coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from public.payments p where p.charge_id=c.id),'[]'::jsonb) payments
    from public.charges c join public.sessions s on s.id=c.session_id join public.fee_versions f on f.id=c.fee_version_id
      join public.participants pt on pt.id=c.participant_id join public.players pl on pl.id=pt.player_id
      left join public.profiles pr on pr.id=pl.user_id left join public.guests g on g.id=pl.guest_id
    where app_private.is_active_admin() or app_private.owns_charge(c.id)
  ) r),'[]'::jsonb);
end;
$$;

-- Financial state participates in the review token, so approval/refund/cancel
-- while another admin is reviewing cannot publish an obsolete adjustment.
alter function app_private.fee_preview(uuid) rename to fee_preview_before_payments;
create function app_private.fee_preview(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
  result_value:=(app_private.fee_preview_before_payments(session_id_input)-'review_token')||jsonb_build_object('financial_payments',
    coalesce((select jsonb_agg(jsonb_build_object('payment_id',p.id,'charge_id',p.charge_id,'amount_sen',p.amount_sen,'status',p.status,'refund_status',p.refund_status) order by p.id)
      from public.payments p join public.charges c on c.id=p.charge_id where c.session_id=session_id_input),'[]'::jsonb));
  return result_value||jsonb_build_object('review_token',md5(result_value::text));
end;
$$;

-- Publication implementation and explicit adjustment wrappers follow below.
create function app_private.publish_fee(session_id_input uuid,full_fee_sen_input integer,review_token_input text,reason_input text,request_id uuid,adjustment_input boolean,refund_ack_input boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; preview_value jsonb; version_value integer; fee_id uuid; r jsonb; old_charge public.charges;
begin
  cached:=app_private.begin_operation(case when adjustment_input then 'adjust_session_fee' else 'publish_session_fee' end,jsonb_build_object('session_id',session_id_input,'full_fee_sen',full_fee_sen_input,'review_token',review_token_input,'reason',reason_input,'refund_ack',refund_ack_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  select * into s from public.sessions where id=session_id_input for update;
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  if s.operational_status in ('draft','cancelled') or clock_timestamp()<s.ends_at then raise exception 'FEE_PUBLICATION_NOT_OPEN' using errcode='22023'; end if;
  preview_value:=app_private.fee_preview(s.id);
  if preview_value#>>'{costs,full_fee_sen}' is null then raise exception 'FEE_NOT_SET' using errcode='22023'; end if;
  if (preview_value->>'unmarked_count')::integer>0 then raise exception 'ATTENDANCE_UNMARKED' using errcode='22023'; end if;
  if full_fee_sen_input is distinct from (preview_value#>>'{costs,full_fee_sen}')::integer or review_token_input is distinct from preview_value->>'review_token' then
    raise exception 'FEE_PREVIEW_STALE' using errcode='22023';
  end if;
  version_value:=(preview_value->>'latest_version')::integer+1;
  if version_value>1 and nullif(btrim(reason_input),'') is null then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
  if char_length(reason_input)>2000 then raise exception 'INVALID_REASON' using errcode='22023'; end if;
  if adjustment_input then
    perform app_private.require_financial_reason(reason_input);
    if exists(select 1 from public.payments p join public.charges c on c.id=p.charge_id where c.session_id=s.id and p.status='submitted') then raise exception 'PAYMENT_REVIEW_REQUIRED' using errcode='22023'; end if;
    if refund_ack_input is distinct from true then raise exception 'REFUND_ACK_REQUIRED' using errcode='22023'; end if;
  end if;
  if not adjustment_input and exists(select 1 from public.charges c where c.session_id=s.id and c.is_current and
    (c.status in ('paid','pending_verification') or exists(select 1 from public.payments p where p.charge_id=c.id and p.status in ('submitted','approved')))) then
    raise exception 'PAYMENT_ADJUSTMENT_REQUIRED' using errcode='22023';
  end if;
  insert into public.fee_versions(session_id,full_fee_sen,version,published_by,reason)
    values(s.id,full_fee_sen_input,version_value,auth.uid(),nullif(btrim(reason_input),'')) returning id into fee_id;
  insert into app_private.fee_cost_snapshots(fee_version_id,cost_snapshot) values(fee_id,preview_value->'costs');
  for r in select value from jsonb_array_elements(preview_value->'rows') loop
    select * into old_charge from public.charges where participant_id=(r->>'participant_id')::uuid and is_current for update;
    if old_charge.id is not null then
      update public.charges set is_current=false,status=case when status='paid' then 'paid' else 'superseded' end where id=old_charge.id;
      if adjustment_input then
        update public.payments set refund_status='pending',refund_reason='Fee adjustment: '||btrim(reason_input)
          where charge_id=old_charge.id and status='approved' and refund_status='none';
      end if;
    end if;
    insert into public.charges(participant_id,session_id,fee_version_id,percent,amount_sen,status,supersedes_charge_id,eligibility_snapshot)
      values((r->>'participant_id')::uuid,s.id,fee_id,(r->>'percent')::smallint,(r->>'amount_sen')::integer,
        case when (r->>'amount_sen')::integer=0 then 'voided' else 'unpaid' end,old_charge.id,r-array['display_name','queue_joined_at','amount_sen']);
  end loop;
  update public.sessions set billing_status='published',operational_status='completed',updated_at=clock_timestamp() where id=s.id;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),case when adjustment_input then 'session_fee_adjusted' else 'session_fee_published' end,'sessions',s.id,nullif(btrim(reason_input),''),jsonb_build_object('fee_version_id',fee_id,'version',version_value,'full_fee_sen',full_fee_sen_input,'participant_count',jsonb_array_length(preview_value->'rows'),'review_token',review_token_input));
  return app_private.finish_operation(request_id,jsonb_build_object('fee_version_id',fee_id,'version',version_value,'session_id',s.id));
end;
$$;

create or replace function public.publish_session_fee(session_id_input uuid,full_fee_sen_input integer,review_token_input text,reason_input text,request_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select app_private.publish_fee(session_id_input,full_fee_sen_input,review_token_input,reason_input,request_id,false,false);
$$;
create function public.adjust_session_fee(session_id_input uuid,full_fee_sen_input integer,review_token_input text,reason_input text,refund_ack_input boolean,request_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select app_private.publish_fee(session_id_input,full_fee_sen_input,review_token_input,reason_input,request_id,true,refund_ack_input);
$$;

-- QR assets are operator-provisioned only in this phase. Never a public object
-- or arbitrary URL from a client; the server returns a bounded image link.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('payment-qr','payment-qr',false,5242880,array['image/jpeg','image/png']);
create function public.authorize_payment_qr() returns text
language plpgsql stable security definer set search_path='' as $$
declare path_value text;
begin
  if not exists(select 1 from public.memberships where user_id=auth.uid() and status in ('active','suspended')) then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  select qr_object_path into path_value from public.club_settings where id;
  if path_value is null or path_value !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png)$' or not exists(select 1 from storage.objects where bucket_id='payment-qr' and name=path_value) then raise exception 'RECEIPT_ACCESS_DENIED' using errcode='42501'; end if;
  return path_value;
end;
$$;

revoke all on function app_private.protect_payment(),app_private.begin_payment_operation(text,jsonb,uuid),app_private.require_financial_reason(text),app_private.fee_preview(uuid),app_private.fee_preview_before_payments(uuid),app_private.publish_fee(uuid,integer,text,text,uuid,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.attest_receipt_upload(text,integer,text,text) from public,anon,authenticated;
grant execute on function public.attest_receipt_upload(text,integer,text,text) to service_role;
revoke all on function public.submit_payment(uuid,text,uuid),public.review_payment(uuid,boolean,boolean,text,uuid),public.record_cash_payment(uuid,text,uuid),public.cancel_session(uuid,text,uuid),public.record_payment_refund(uuid,text,uuid),public.get_payment_history(),public.adjust_session_fee(uuid,integer,text,text,boolean,uuid),public.authorize_payment_qr() from public,anon,service_role;
grant execute on function public.submit_payment(uuid,text,uuid),public.review_payment(uuid,boolean,boolean,text,uuid),public.record_cash_payment(uuid,text,uuid),public.cancel_session(uuid,text,uuid),public.record_payment_refund(uuid,text,uuid),public.get_payment_history(),public.adjust_session_fee(uuid,integer,text,text,boolean,uuid),public.authorize_payment_qr() to authenticated;

commit;
