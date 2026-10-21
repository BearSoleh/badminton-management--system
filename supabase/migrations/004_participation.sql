begin;

-- Accrued liability survives a later rejoin/decline/expiry. charge_percent is
-- the current participation percentage; this floor is a retained obligation.
alter table public.participants add column liability_percent smallint not null default 0 check (liability_percent in (0,75,100));
update public.participants set liability_percent=75 where participation_status='late_cancelled';

create table app_private.operation_requests (
  actor_user_id uuid not null references public.profiles(id),
  request_id uuid not null,
  operation text not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_user_id,request_id)
);
alter table app_private.operation_requests enable row level security;
revoke all on app_private.operation_requests from public,anon,authenticated,service_role;
grant select on app_private.operation_requests to service_role;

create function app_private.begin_operation(operation_input text,payload_input jsonb,request_id_input uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; existing app_private.operation_requests;
begin
  actor := public.assert_active_membership();
  -- Keep the validated membership stable until this transaction commits.
  perform 1 from public.memberships where user_id=actor and status='active' for share;
  if not found then raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode='42501'; end if;
  if request_id_input is null then raise exception 'INVALID_REQUEST_ID' using errcode='22023'; end if;
  insert into app_private.operation_requests(actor_user_id,request_id,operation,payload)
    values(actor,request_id_input,operation_input,payload_input) on conflict do nothing;
  select * into existing from app_private.operation_requests where actor_user_id=actor and request_id=request_id_input for update;
  if existing.operation<>operation_input or existing.payload is distinct from payload_input then
    raise exception 'REQUEST_ID_CONFLICT' using errcode='22023';
  end if;
  return existing.result;
end;
$$;
create function app_private.finish_operation(request_id_input uuid,result_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  update app_private.operation_requests set result=result_input where actor_user_id=auth.uid() and request_id=request_id_input;
  return result_input;
end;
$$;
create function app_private.withdrawal_percentage(starts_at_input timestamptz,at_input timestamptz,confirmed_input boolean) returns smallint
language sql immutable set search_path='' as $$
  select case when not confirmed_input then 0
    when (at_input at time zone 'Asia/Kuala_Lumpur')::date < (starts_at_input at time zone 'Asia/Kuala_Lumpur')::date then 0
    else 75 end::smallint;
$$;
create function app_private.participation_result(participant_id_input uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('participant_id',p.id,'participation_status',p.participation_status,
    'charge_percent',p.charge_percent,'liability_percent',p.liability_percent,'queue_joined_at',p.queue_joined_at)
    from public.participants p where p.id=participant_id_input;
$$;
create function app_private.audit_participation(before_input public.participants,after_input public.participants) returns void
language sql security definer set search_path='' as $$
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata)
    values(auth.uid(),'participation_changed','participants',after_input.id,
      jsonb_build_object('before',to_jsonb(before_input),'after',to_jsonb(after_input)));
$$;
create function app_private.actor_player() returns uuid
language plpgsql security definer set search_path='' as $$
declare player_id_value uuid;
begin
  select p.id into player_id_value from public.players p left join public.guests g on g.id=p.guest_id
    where p.user_id=auth.uid() or g.linked_user_id=auth.uid();
  if player_id_value is null then
    insert into public.players(user_id) values(auth.uid()) on conflict(user_id) do nothing;
    select id into player_id_value from public.players where user_id=auth.uid();
  end if;
  return player_id_value;
end;
$$;

-- Internal helpers are called only after a public operation locks the session.
create function app_private.allocate_participation(session_input public.sessions,source_input text,at_input timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare player_id_value uuid; previous public.participants; current_row public.participants; occupied integer; queued boolean; new_status text;
begin
  player_id_value := app_private.actor_player();
  select * into previous from public.participants where session_id=session_input.id and player_id=player_id_value;
  if previous.participation_status in ('confirmed','waitlisted','offered') then return app_private.participation_result(previous.id); end if;
  select count(*) into occupied from public.participants p where p.session_id=session_input.id and
    (p.participation_status='confirmed' or (p.participation_status='offered' and exists(select 1 from public.waitlist_offers o where o.participant_id=p.id and o.state='pending' and o.expires_at>at_input)));
  select exists(select 1 from public.participants where session_id=session_input.id and participation_status in ('waitlisted','offered')) into queued;
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
create function app_private.withdraw_locked(participant_id_input uuid,session_input public.sessions,at_input timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.participants; current_row public.participants; percent_value smallint; next_status text;
begin
  select * into previous from public.participants where id=participant_id_input;
  if previous.participation_status not in ('confirmed','waitlisted','offered') then return app_private.participation_result(previous.id); end if;
  percent_value := greatest(previous.liability_percent,app_private.withdrawal_percentage(session_input.starts_at,at_input,previous.participation_status='confirmed'));
  next_status := case when previous.participation_status='confirmed' and percent_value>0 then 'late_cancelled' else 'withdrawn_early' end;
  if previous.participation_status='offered' then
    next_status := case when exists(select 1 from public.waitlist_offers where participant_id=previous.id and state='pending' and expires_at<=at_input) then 'offer_expired' else 'offer_declined' end;
    update public.waitlist_offers set state=case when expires_at<=at_input then 'expired' else 'declined' end,
      response_at=case when expires_at>at_input then at_input end where participant_id=previous.id and state='pending';
  end if;
  update public.participants set participation_status=next_status,withdrawn_at=at_input,
    charge_percent=percent_value,liability_percent=percent_value,attendance='not_applicable'
    where id=previous.id returning * into current_row;
  perform app_private.audit_participation(previous,current_row);
  return app_private.participation_result(current_row.id);
end;
$$;

create function public.save_session(session_id_input uuid,title_input text,venue_input text,starts_at_input timestamptz,ends_at_input timestamptz,capacity_input integer,voting_closes_at_input timestamptz,waitlist_mode_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; current_row public.sessions; old_row public.sessions; at_value timestamptz;
begin
  cached := app_private.begin_operation('save_session',jsonb_build_object('id',session_id_input,'title',title_input,'venue',venue_input,'start',starts_at_input,'end',ends_at_input,'capacity',capacity_input,'close',voting_closes_at_input,'mode',waitlist_mode_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  if session_id_input is not null then
    select * into old_row from public.sessions where id=session_id_input for update;
    if old_row.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
    if old_row.operational_status<>'draft' then raise exception 'DRAFT_REQUIRED' using errcode='22023'; end if;
  end if;
  at_value := clock_timestamp();
  if title_input is null or char_length(btrim(title_input)) not between 1 and 120 or venue_input is null or char_length(btrim(venue_input)) not between 1 and 300
    or capacity_input is null or capacity_input<1 or starts_at_input is null or starts_at_input<=at_value
    or ends_at_input is null or ends_at_input<=starts_at_input or voting_closes_at_input is null or voting_closes_at_input<=at_value or voting_closes_at_input>starts_at_input
    or waitlist_mode_input is null or waitlist_mode_input not in ('automatic','manual') then raise exception 'INVALID_SESSION' using errcode='22023'; end if;
  if session_id_input is null then
    insert into public.sessions(title,venue,starts_at,ends_at,capacity,voting_closes_at,waitlist_mode,created_by)
      values(btrim(title_input),btrim(venue_input),starts_at_input,ends_at_input,capacity_input,voting_closes_at_input,waitlist_mode_input,auth.uid()) returning * into current_row;
  else
    update public.sessions set title=btrim(title_input),venue=btrim(venue_input),starts_at=starts_at_input,ends_at=ends_at_input,capacity=capacity_input,
      voting_closes_at=voting_closes_at_input,waitlist_mode=waitlist_mode_input,updated_at=at_value where id=session_id_input returning * into current_row;
  end if;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata) values(auth.uid(),'session_saved','sessions',current_row.id,jsonb_build_object('before',to_jsonb(old_row),'after',to_jsonb(current_row)));
  return app_private.finish_operation(request_id,jsonb_build_object('session_id',current_row.id,'status','draft'));
end;
$$;
create function public.publish_session(session_id_input uuid,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; at_value timestamptz;
begin
  cached := app_private.begin_operation('publish_session',jsonb_build_object('session_id',session_id_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  select * into s from public.sessions where id=session_id_input for update;
  at_value := clock_timestamp();
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  if s.operational_status<>'draft' then raise exception 'DRAFT_REQUIRED' using errcode='22023'; end if;
  if s.voting_closes_at<=at_value or s.starts_at<=at_value then raise exception 'INVALID_SESSION' using errcode='22023'; end if;
  update public.sessions set operational_status='voting_open',updated_at=at_value where id=s.id;
  insert into public.polls(session_id,opens_at,closes_at,status) values(s.id,at_value,s.voting_closes_at,'open');
  insert into public.audit_logs(actor_user_id,action,entity,entity_id) values(auth.uid(),'session_published','sessions',s.id);
  return app_private.finish_operation(request_id,jsonb_build_object('session_id',s.id,'status','voting_open'));
end;
$$;
create function public.cast_session_vote(session_id_input uuid,choice_input text,request_id uuid) returns jsonb
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
create function public.join_session(session_id_input uuid,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; at_value timestamptz;
begin
  cached := app_private.begin_operation('join_session',jsonb_build_object('session_id',session_id_input),request_id);
  if cached is not null then return cached; end if;
  select * into s from public.sessions where id=session_id_input for update;
  at_value := clock_timestamp();
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  if s.operational_status not in ('voting_open','joining_open') then raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
  if at_value>=s.starts_at then raise exception 'SESSION_STARTED' using errcode='22023'; end if;
  if at_value<s.voting_closes_at then raise exception 'VOTING_STILL_OPEN' using errcode='22023'; end if;
  update public.sessions set operational_status='joining_open',updated_at=at_value where id=s.id;
  update public.polls set status='closed' where session_id=s.id and status='open';
  return app_private.finish_operation(request_id,app_private.allocate_participation(s,'direct',at_value));
end;
$$;
create function public.withdraw_participation(participant_id_input uuid,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; sid uuid; at_value timestamptz; p public.participants;
begin
  cached := app_private.begin_operation('withdraw_participation',jsonb_build_object('participant_id',participant_id_input),request_id);
  if cached is not null then return cached; end if;
  select session_id into sid from public.participants where id=participant_id_input and app_private.owns_player(player_id);
  if sid is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode='42501'; end if;
  select * into s from public.sessions where id=sid for update;
  at_value := clock_timestamp();
  if s.operational_status not in ('voting_open','joining_open') then raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
  if at_value>=s.starts_at then raise exception 'SESSION_STARTED' using errcode='22023'; end if;
  select * into p from public.participants where id=participant_id_input and app_private.owns_player(player_id);
  if p.id is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode='42501'; end if;
  return app_private.finish_operation(request_id,app_private.withdraw_locked(p.id,s,at_value));
end;
$$;
create function public.get_session_snapshot(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.sessions; p public.participants; at_value timestamptz := statement_timestamp(); open_value boolean;
begin
  perform public.assert_active_membership();
  select * into s from public.sessions where id=session_id_input and app_private.can_read_session(id);
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  select * into p from public.participants where session_id=s.id and app_private.owns_player(player_id);
  open_value := s.operational_status in ('voting_open','joining_open') and at_value<s.starts_at;
  return jsonb_build_object('session',to_jsonb(s),'server_now',at_value,'participation',case when p.id is not null then to_jsonb(p) end,
    'vote',(select v.choice from public.votes v join public.polls po on po.id=v.poll_id where po.session_id=s.id and v.user_id=auth.uid()),
    'roster',coalesce((select jsonb_agg(to_jsonb(r)) from public.get_session_roster(s.id) r),'[]'::jsonb),
    'counts',jsonb_build_object('confirmed',(select count(*) from public.participants where session_id=s.id and participation_status='confirmed'),
      'held',(select count(*) from public.participants pa where pa.session_id=s.id and pa.participation_status='offered' and exists(select 1 from public.waitlist_offers o where o.participant_id=pa.id and o.state='pending' and o.expires_at>at_value)),
      'waiting',(select count(*) from public.participants where session_id=s.id and participation_status='waitlisted')),
    'can_vote',open_value and at_value<s.voting_closes_at and exists(select 1 from public.polls where session_id=s.id and status='open' and opens_at<=at_value and closes_at>at_value),
    'can_join',open_value and at_value>=s.voting_closes_at,
    'can_withdraw',open_value and p.participation_status in ('confirmed','waitlisted','offered'),
    'withdrawal_percent',greatest(coalesce(p.liability_percent,0),app_private.withdrawal_percentage(s.starts_at,at_value,coalesce(p.participation_status='confirmed',false))));
end;
$$;

-- Schema-scoped default REVOKE cannot cancel PostgreSQL's global PUBLIC EXECUTE
-- default. Explicit object ACLs are mandatory: only these pure, caller-scoped
-- policy predicates may be executed by authenticated roles. Transaction helpers
-- remain owner-only, including for admin JWTs and the backend service role.
revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
grant execute on function app_private.is_active_member(),app_private.is_active_admin(),app_private.owns_player(uuid),app_private.owns_participant(uuid),app_private.owns_charge(uuid),app_private.can_read_session(uuid),app_private.can_upload_receipt(text) to authenticated;
revoke all on function public.save_session(uuid,text,text,timestamptz,timestamptz,integer,timestamptz,text,uuid),public.publish_session(uuid,uuid),public.cast_session_vote(uuid,text,uuid),public.join_session(uuid,uuid),public.withdraw_participation(uuid,uuid),public.get_session_snapshot(uuid) from public,anon;
grant execute on function public.save_session(uuid,text,text,timestamptz,timestamptz,integer,timestamptz,text,uuid),public.publish_session(uuid,uuid),public.cast_session_vote(uuid,text,uuid),public.join_session(uuid,uuid),public.withdraw_participation(uuid,uuid),public.get_session_snapshot(uuid) to authenticated;
commit;
