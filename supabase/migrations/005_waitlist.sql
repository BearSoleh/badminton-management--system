begin;

create function app_private.persist_notification(user_id_input uuid,event_key_input text,type_input text,payload_input jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if user_id_input is null then return; end if;
  insert into public.notifications(user_id,event_key,type,payload)
    values(user_id_input,event_key_input,type_input,payload_input)
    on conflict(user_id,event_key) where user_id is not null do nothing;
  insert into app_private.notification_outbox(event_key,channel,state,attempts,delivery_metadata)
    values(event_key_input,'in_app','delivered',1,jsonb_build_object('persisted_in_app',true))
    on conflict(event_key,channel) do nothing;
end;
$$;

-- Caller holds the session row. Time is sampled after that lock, never supplied
-- by an API caller. Guest eligibility is deliberately unavailable before Task 7.
create function app_private.waitlist_eligible(player_id_input uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.players p left join public.guests g on g.id=p.guest_id
    join public.memberships m on m.user_id=coalesce(p.user_id,g.linked_user_id)
    where p.id=player_id_input and m.status='active');
$$;
create function app_private.waitlist_occupancy(session_id_input uuid,at_input timestamptz) returns integer
language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.participants p where p.session_id=session_id_input and
    (p.participation_status='confirmed' or (p.participation_status='offered' and exists(
      select 1 from public.waitlist_offers o where o.participant_id=p.id and o.state='pending' and o.expires_at>at_input)));
$$;
create function app_private.create_waitlist_offer(participant_id_input uuid,at_input timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.participants; changed public.participants; s public.sessions; o public.waitlist_offers; recipient uuid;
begin
  select * into p from public.participants where id=participant_id_input;
  select * into s from public.sessions where id=p.session_id;
  if p.id is null or p.participation_status<>'waitlisted' or not app_private.waitlist_eligible(p.player_id) then
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

create function app_private.reconcile_waitlist(session_id_input uuid,at_input timestamptz) returns void
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
    select p.id into next_id from public.participants p where p.session_id=s.id and p.participation_status='waitlisted'
      and app_private.waitlist_eligible(p.player_id) order by p.queue_joined_at,p.id limit 1;
    exit when next_id is null;
    perform app_private.create_waitlist_offer(next_id,at_input);
  end loop;
end;
$$;

create function app_private.resolve_offer_locked(offer_id_input uuid,accept_input boolean,at_input timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.waitlist_offers; p public.participants; changed public.participants; s public.sessions; state_value text; recipient uuid;
begin
  select * into o from public.waitlist_offers where id=offer_id_input;
  select * into p from public.participants where id=o.participant_id;
  select * into s from public.sessions where id=p.session_id;
  if o.state<>'pending' or p.participation_status<>'offered' then raise exception 'OFFER_NOT_PENDING' using errcode='22023'; end if;
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

create function public.respond_to_offer(offer_id_input uuid,accept_input boolean,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; at_value timestamptz;
begin
  cached:=app_private.begin_operation('respond_to_offer',jsonb_build_object('offer_id',offer_id_input,'accept',accept_input),request_id);
  if cached is not null then return cached; end if;
  if accept_input is null then raise exception 'INVALID_RESPONSE' using errcode='22023'; end if;
  select p.session_id into sid from public.waitlist_offers o join public.participants p on p.id=o.participant_id
    where o.id=offer_id_input and app_private.owns_player(p.player_id);
  if sid is null then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
  perform 1 from public.sessions where id=sid for update;
  at_value:=clock_timestamp();
  return app_private.finish_operation(request_id,app_private.resolve_offer_locked(offer_id_input,accept_input,at_value));
end;
$$;

create function public.admin_offer_slot(participant_id_input uuid,reason_input text,request_id uuid) returns jsonb
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
    and app_private.waitlist_eligible(p.player_id) order by p.queue_joined_at,p.id limit 1;
  result_value:=app_private.create_waitlist_offer(participant_id_input,at_value);
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'admin_offer_slot','participants',participant_id_input,btrim(reason_input),jsonb_build_object('session_id',sid,'queue_override',first_id is distinct from participant_id_input));
  return app_private.finish_operation(request_id,result_value);
end;
$$;

create function public.admin_confirm_late_slot(participant_id_input uuid,consent_input boolean,reason_input text,request_id uuid) returns jsonb
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
  if p.participation_status<>'waitlisted' or not app_private.waitlist_eligible(p.player_id) then raise exception 'PLAYER_NOT_WAITING' using errcode='22023'; end if;
  if app_private.waitlist_occupancy(s.id,at_value)>=s.capacity then raise exception 'NO_VACANCY' using errcode='22023'; end if;
  update public.participants set participation_status='confirmed',source='admin',confirmed_at=at_value,charge_percent=100,attendance='unmarked'
    where id=p.id returning * into changed;
  perform app_private.audit_participation(p,changed);
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'admin_confirm_late_slot','participants',p.id,btrim(reason_input),jsonb_build_object('session_id',s.id,'player_consent',true,'queue_override',exists(select 1 from public.participants where session_id=s.id and participation_status='waitlisted' and (queue_joined_at,id)<(p.queue_joined_at,p.id))));
  return app_private.finish_operation(request_id,app_private.participation_result(p.id));
end;
$$;

create function public.set_waitlist_mode(session_id_input uuid,mode_input text,reason_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; s public.sessions; at_value timestamptz;
begin
  cached:=app_private.begin_operation('set_waitlist_mode',jsonb_build_object('session_id',session_id_input,'mode',mode_input,'reason',reason_input),request_id);
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if cached is not null then return cached; end if;
  if mode_input is null or mode_input not in ('automatic','manual') then raise exception 'INVALID_MODE' using errcode='22023'; end if;
  if reason_input is null or char_length(btrim(reason_input)) not between 1 and 2000 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
  select * into s from public.sessions where id=session_id_input for update;
  at_value:=clock_timestamp();
  if s.id is null then raise exception 'SESSION_NOT_FOUND' using errcode='42501'; end if;
  if s.operational_status not in ('voting_open','joining_open') or at_value>=s.starts_at then raise exception 'SESSION_NOT_JOINABLE' using errcode='22023'; end if;
  update public.sessions set waitlist_mode=mode_input,updated_at=at_value where id=s.id;
  insert into public.audit_logs(actor_user_id,action,entity,entity_id,reason,safe_metadata)
    values(auth.uid(),'waitlist_mode_changed','sessions',s.id,btrim(reason_input),jsonb_build_object('before',s.waitlist_mode,'after',mode_input));
  perform app_private.reconcile_waitlist(s.id,at_value);
  return app_private.finish_operation(request_id,jsonb_build_object('waitlist_mode',mode_input));
end;
$$;

create function public.get_waitlist_queue(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_active_membership();
  if not app_private.is_active_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('server_now',statement_timestamp(),'queue',coalesce((select jsonb_agg(to_jsonb(q) order by q.queue_joined_at,q.participant_id) from (
    select p.id participant_id,coalesce(pr.display_name,g.name) display_name,p.participation_status,p.queue_joined_at,
      app_private.waitlist_eligible(p.player_id) eligible,
      (select to_jsonb(o) from public.waitlist_offers o where o.participant_id=p.id and o.state='pending') offer
    from public.participants p join public.players pl on pl.id=p.player_id left join public.profiles pr on pr.id=pl.user_id
      left join public.guests g on g.id=pl.guest_id where p.session_id=session_id_input and p.participation_status in ('waitlisted','offered')
  ) q),'[]'::jsonb));
end;
$$;

create function public.get_active_offers() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_active_membership();
  return jsonb_build_object('server_now',statement_timestamp(),'offers',coalesce((
    select jsonb_agg(jsonb_build_object('session_id',s.id,'session_title',s.title,'offer',to_jsonb(o)) order by o.expires_at,o.id)
    from public.waitlist_offers o join public.participants p on p.id=o.participant_id join public.sessions s on s.id=p.session_id
    where o.state='pending' and o.expires_at>statement_timestamp() and p.participation_status='offered'
      and app_private.owns_player(p.player_id) and s.starts_at>statement_timestamp() and s.operational_status in ('voting_open','joining_open')
  ),'[]'::jsonb));
end;
$$;
revoke all on function public.get_active_offers() from public,anon,service_role;
grant execute on function public.get_active_offers() to authenticated;

-- All existing withdrawal entrances (including a Not playing vote) retain the
-- same KL liability rules and also record the held offer's end exactly once.
create or replace function app_private.withdraw_locked(participant_id_input uuid,session_input public.sessions,at_input timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.participants; current_row public.participants; percent_value smallint; next_status text; o public.waitlist_offers; recipient uuid;
begin
  select * into previous from public.participants where id=participant_id_input;
  if previous.participation_status not in ('confirmed','waitlisted','offered') then return app_private.participation_result(previous.id); end if;
  percent_value:=greatest(previous.liability_percent,app_private.withdrawal_percentage(session_input.starts_at,at_input,previous.participation_status='confirmed'));
  next_status:=case when previous.participation_status='confirmed' and percent_value>0 then 'late_cancelled' else 'withdrawn_early' end;
  if previous.participation_status='offered' then
    select * into o from public.waitlist_offers where participant_id=previous.id and state='pending';
    next_status:=case when o.expires_at<=at_input then 'offer_expired' else 'offer_declined' end;
    if o.id is not null then
      update public.waitlist_offers set state=case when expires_at<=at_input then 'expired' else 'declined' end,
        response_at=case when expires_at>at_input then at_input end where id=o.id;
      insert into public.audit_logs(actor_user_id,action,entity,entity_id,safe_metadata)
        values(auth.uid(),'waitlist_'||next_status,'waitlist_offers',o.id,jsonb_build_object('session_id',session_input.id));
      select coalesce(pl.user_id,g.linked_user_id) into recipient from public.players pl left join public.guests g on g.id=pl.guest_id where pl.id=previous.player_id;
      perform app_private.persist_notification(recipient,next_status||':'||o.id||':'||recipient,'waitlist_'||next_status,
        jsonb_build_object('session_id',session_input.id,'session_title',session_input.title,'offer_id',o.id));
    end if;
  end if;
  update public.participants set participation_status=next_status,withdrawn_at=at_input,
    charge_percent=percent_value,liability_percent=percent_value,attendance='not_applicable'
    where id=previous.id returning * into current_row;
  perform app_private.audit_participation(previous,current_row);
  return app_private.participation_result(current_row.id);
end;
$$;

-- Preserve Task 3's tested transactions and idempotent results. These wrappers
-- reconcile under the same session lock; the renamed implementations are private.
alter function public.cast_session_vote(uuid,text,uuid) set schema app_private;
alter function app_private.cast_session_vote(uuid,text,uuid) rename to cast_session_vote_base;
create function public.cast_session_vote(session_id_input uuid,choice_input text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result_value jsonb;
begin
  result_value:=app_private.cast_session_vote_base(session_id_input,choice_input,request_id);
  perform 1 from public.sessions where id=session_id_input for update;
  perform app_private.reconcile_waitlist(session_id_input,clock_timestamp());
  return result_value;
end;
$$;
alter function public.join_session(uuid,uuid) set schema app_private;
alter function app_private.join_session(uuid,uuid) rename to join_session_base;
create function public.join_session(session_id_input uuid,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result_value jsonb;
begin
  result_value:=app_private.join_session_base(session_id_input,request_id);
  perform 1 from public.sessions where id=session_id_input for update;
  perform app_private.reconcile_waitlist(session_id_input,clock_timestamp());
  return result_value;
end;
$$;
alter function public.withdraw_participation(uuid,uuid) set schema app_private;
alter function app_private.withdraw_participation(uuid,uuid) rename to withdraw_participation_base;
create function public.withdraw_participation(participant_id_input uuid,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result_value jsonb; sid uuid;
begin
  result_value:=app_private.withdraw_participation_base(participant_id_input,request_id);
  select session_id into sid from public.participants where id=participant_id_input;
  perform 1 from public.sessions where id=sid for update;
  perform app_private.reconcile_waitlist(sid,clock_timestamp());
  return result_value;
end;
$$;
alter function public.get_session_snapshot(uuid) set schema app_private;
alter function app_private.get_session_snapshot(uuid) rename to get_session_snapshot_base;
create function public.get_session_snapshot(session_id_input uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
  result_value:=app_private.get_session_snapshot_base(session_id_input);
  return result_value||jsonb_build_object('offer',(select to_jsonb(o) from public.waitlist_offers o
    where o.participant_id=(result_value->'participation'->>'id')::uuid and o.state='pending'));
end;
$$;

-- Cancellation/completion cleanup is immediate, including later audited admin
-- lifecycle RPCs. Billing cancellation remains the separate Task 6 operation.
create function app_private.close_session_offers() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.operational_status not in ('draft','voting_open','joining_open') and old.operational_status is distinct from new.operational_status then
    perform app_private.reconcile_waitlist(new.id,clock_timestamp());
  end if;
  return new;
end;
$$;
create trigger close_session_offers after update of operational_status on public.sessions
  for each row execute function app_private.close_session_offers();

revoke all on all functions in schema app_private from public,anon,authenticated,service_role;
grant execute on function app_private.is_active_member(),app_private.is_active_admin(),app_private.owns_player(uuid),app_private.owns_participant(uuid),app_private.owns_charge(uuid),app_private.can_read_session(uuid),app_private.can_upload_receipt(text) to authenticated;
revoke all on function public.respond_to_offer(uuid,boolean,uuid),public.admin_offer_slot(uuid,text,uuid),public.admin_confirm_late_slot(uuid,boolean,text,uuid),public.set_waitlist_mode(uuid,text,text,uuid),public.get_waitlist_queue(uuid),public.cast_session_vote(uuid,text,uuid),public.join_session(uuid,uuid),public.withdraw_participation(uuid,uuid),public.get_session_snapshot(uuid) from public,anon,service_role;
grant execute on function public.respond_to_offer(uuid,boolean,uuid),public.admin_offer_slot(uuid,text,uuid),public.admin_confirm_late_slot(uuid,boolean,text,uuid),public.set_waitlist_mode(uuid,text,text,uuid),public.get_waitlist_queue(uuid),public.cast_session_vote(uuid,text,uuid),public.join_session(uuid,uuid),public.withdraw_participation(uuid,uuid),public.get_session_snapshot(uuid) to authenticated;
commit;
