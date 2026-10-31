-- Task 5 only: attendance, manually determined fee drafts and publication.
begin;

alter table public.session_costs add column full_fee_sen integer check(full_fee_sen>=0);
-- Cost notes are admin-private even though members can read published fee rates.
create table app_private.fee_cost_snapshots (
  fee_version_id uuid primary key references public.fee_versions(id),
  cost_snapshot jsonb not null
);
alter table app_private.fee_cost_snapshots enable row level security;
revoke all on app_private.fee_cost_snapshots from public,anon,authenticated,service_role;
alter table public.charges add column eligibility_snapshot jsonb not null default '{}';

-- Lifecycle status/current-pointer changes remain possible for later payment work;
-- the money, rate, identity and eligibility in a charge can never be rewritten.
create function app_private.protect_billing_snapshot() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name in ('fee_versions','fee_cost_snapshots') then raise exception 'IMMUTABLE_FEE_VERSION' using errcode='22023'; end if;
  if (to_jsonb(new)-array['status','is_current']) is distinct from (to_jsonb(old)-array['status','is_current']) then
    raise exception 'IMMUTABLE_CHARGE_SNAPSHOT' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger immutable_fee_version before update on public.fee_versions for each row execute function app_private.protect_billing_snapshot();
create trigger immutable_fee_costs before update on app_private.fee_cost_snapshots for each row execute function app_private.protect_billing_snapshot();
create trigger immutable_charge_snapshot before update on public.charges for each row execute function app_private.protect_billing_snapshot();
revoke update,delete on public.fee_versions from service_role;
revoke delete on public.charges from service_role;

create function public.set_attendance(participant_id_input uuid,attendance_input text,reason_input text,request_id uuid) returns jsonb
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
  if p.participation_status<>'confirmed' or p.confirmed_at is null then raise exception 'ATTENDANCE_NOT_ELIGIBLE' using errcode='22023'; end if;
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

create function public.save_fee_draft(session_id_input uuid,full_fee_sen_input integer,court_cost_sen_input integer,shuttle_quantity_input integer,shuttle_cost_sen_input integer,notes_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; previous public.session_costs; next_row public.session_costs;
begin
  cached:=app_private.begin_operation('save_fee_draft',jsonb_build_object('session_id',session_id_input,'full_fee_sen',full_fee_sen_input,'court_cost_sen',court_cost_sen_input,'shuttle_quantity',shuttle_quantity_input,'shuttle_cost_sen',shuttle_cost_sen_input,'notes',notes_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  select * into s from public.sessions where id=session_id_input for update;
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  if s.operational_status in ('draft','cancelled') or clock_timestamp()<s.ends_at then raise exception 'FEE_PUBLICATION_NOT_OPEN' using errcode='22023'; end if;
  if full_fee_sen_input is null or full_fee_sen_input<0 or court_cost_sen_input is null or court_cost_sen_input<0
    or shuttle_quantity_input is null or shuttle_quantity_input<0 or shuttle_cost_sen_input is null or shuttle_cost_sen_input<0
    or char_length(notes_input)>2000 then raise exception 'INVALID_FEE' using errcode='22023'; end if;
  select * into previous from public.session_costs where session_id=s.id;
  insert into public.session_costs(session_id,full_fee_sen,court_cost_sen,shuttle_quantity,shuttle_cost_sen,notes)
    values(s.id,full_fee_sen_input,court_cost_sen_input,shuttle_quantity_input,shuttle_cost_sen_input,notes_input)
    on conflict(session_id) do update set full_fee_sen=excluded.full_fee_sen,court_cost_sen=excluded.court_cost_sen,
      shuttle_quantity=excluded.shuttle_quantity,shuttle_cost_sen=excluded.shuttle_cost_sen,notes=excluded.notes returning * into next_row;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata)
    values(auth.uid(),'fee_draft_saved','sessions',s.id,jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(next_row)));
  return app_private.finish_operation(request_id,to_jsonb(next_row));
end;
$$;

-- Pure integer half-up arithmetic, promoted to bigint before multiplication.
create function app_private.charge_amount(full_fee_sen_input integer,percent_input integer) returns integer
language sql immutable set search_path='' as $$
  select ((full_fee_sen_input::bigint*percent_input+50)/100)::integer;
$$;

create function app_private.fee_preview(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.sessions; costs public.session_costs; rows_value jsonb; result_value jsonb;
begin
  select * into s from public.sessions where id=session_id_input;
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  select * into costs from public.session_costs where session_id=s.id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.queue_joined_at,r.participant_id),'[]'::jsonb) into rows_value from (
    select p.id participant_id,coalesce(pr.display_name,g.name) display_name,p.queue_joined_at,p.participation_status,p.attendance,p.confirmed_at,p.withdrawn_at,p.liability_percent,
      case when s.operational_status='cancelled' then 0 when p.participation_status='confirmed' then 100
        when p.participation_status='late_cancelled' then 75 else p.liability_percent end percent,
      case when s.operational_status='cancelled' then 0
        when p.participation_status='confirmed' and p.attendance not in ('present','no_show') then null
        else app_private.charge_amount(costs.full_fee_sen,case when p.participation_status='confirmed' then 100
          when p.participation_status='late_cancelled' then 75 else p.liability_percent end) end amount_sen
    from public.participants p join public.players pl on pl.id=p.player_id left join public.profiles pr on pr.id=pl.user_id
      left join public.guests g on g.id=pl.guest_id where p.session_id=s.id
  ) r;
  result_value:=jsonb_build_object('session',to_jsonb(s),'costs',case when costs.session_id is not null then to_jsonb(costs) end,'rows',rows_value,
    'unmarked_count',(select count(*) from public.participants where session_id=s.id and participation_status='confirmed' and (confirmed_at is null or attendance not in ('present','no_show'))),
    'latest_version',coalesce((select max(version) from public.fee_versions where session_id=s.id),0));
  -- Covers dates/status, draft costs, eligibility and latest published version.
  -- The caller must submit the exact state they reviewed, under the session lock.
  return result_value||jsonb_build_object('review_token',md5(result_value::text));
end;
$$;
create function public.get_fee_preview(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_active_membership();
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  return app_private.fee_preview(session_id_input)||jsonb_build_object('server_now',statement_timestamp());
end;
$$;

create function public.publish_session_fee(session_id_input uuid,full_fee_sen_input integer,review_token_input text,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; preview_value jsonb; version_value integer; fee_id uuid; r jsonb; old_charge public.charges; new_charge_id uuid;
begin
  cached:=app_private.begin_operation('publish_session_fee',jsonb_build_object('session_id',session_id_input,'full_fee_sen',full_fee_sen_input,'review_token',review_token_input,'reason',reason_input),request_id);
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
  -- Financial adjustment/payment/refund workflows are explicitly Task 6.
  if exists(select 1 from public.charges c where c.session_id=s.id and c.is_current and
    (c.status in ('paid','pending_verification') or exists(select 1 from public.payments p where p.charge_id=c.id and p.status in ('submitted','approved')))) then
    raise exception 'PAYMENT_ADJUSTMENT_REQUIRED' using errcode='22023';
  end if;
  insert into public.fee_versions(session_id,full_fee_sen,version,published_by,reason)
    values(s.id,full_fee_sen_input,version_value,auth.uid(),nullif(btrim(reason_input),'')) returning id into fee_id;
  insert into app_private.fee_cost_snapshots(fee_version_id,cost_snapshot) values(fee_id,preview_value->'costs');
  for r in select value from jsonb_array_elements(preview_value->'rows') loop
    select * into old_charge from public.charges where participant_id=(r->>'participant_id')::uuid and is_current for update;
    if old_charge.id is not null then update public.charges set is_current=false,status='superseded' where id=old_charge.id; end if;
    insert into public.charges(participant_id,session_id,fee_version_id,percent,amount_sen,status,supersedes_charge_id,eligibility_snapshot)
      values((r->>'participant_id')::uuid,s.id,fee_id,(r->>'percent')::smallint,(r->>'amount_sen')::integer,
        case when (r->>'amount_sen')::integer=0 then 'voided' else 'unpaid' end,old_charge.id,r-array['display_name','queue_joined_at','amount_sen']) returning id into new_charge_id;
  end loop;
  update public.sessions set billing_status='published',operational_status='completed',updated_at=clock_timestamp() where id=s.id;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'session_fee_published','sessions',s.id,nullif(btrim(reason_input),''),jsonb_build_object('fee_version_id',fee_id,'version',version_value,'full_fee_sen',full_fee_sen_input,'participant_count',jsonb_array_length(preview_value->'rows'),'review_token',review_token_input));
  return app_private.finish_operation(request_id,jsonb_build_object('fee_version_id',fee_id,'version',version_value,'session_id',s.id));
end;
$$;

revoke all on function app_private.protect_billing_snapshot(),app_private.charge_amount(integer,integer),app_private.fee_preview(uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_attendance(uuid,text,text,uuid),public.save_fee_draft(uuid,integer,integer,integer,integer,text,uuid),public.get_fee_preview(uuid),public.publish_session_fee(uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function public.set_attendance(uuid,text,text,uuid),public.save_fee_draft(uuid,integer,integer,integer,integer,text,uuid),public.get_fee_preview(uuid),public.publish_session_fee(uuid,integer,text,text,uuid) to authenticated;

commit;
