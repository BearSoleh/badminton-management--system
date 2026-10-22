begin;
create table app_private.waitlist_job_health (
  singleton boolean primary key default true check(singleton),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  processed integer not null default 0,
  failures integer not null default 0,
  last_error_code text
);
alter table app_private.waitlist_job_health enable row level security;
revoke all on app_private.waitlist_job_health from public,anon,authenticated,service_role;
grant select on app_private.waitlist_job_health to service_role;
insert into app_private.waitlist_job_health(singleton) values(true);

create function public.expire_waitlist_offers() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.sessions; at_value timestamptz; processed_value integer:=0; failures_value integer:=0; code_value text; last_code text; admin_id uuid;
begin
  -- One worker at a time; overlapping/retried jobs are harmless. Session locks
  -- use SKIP LOCKED so a user transaction cannot stall the whole minute job.
  if not pg_try_advisory_xact_lock(624710040) then return jsonb_build_object('busy',true); end if;
  update app_private.waitlist_job_health set last_started_at=clock_timestamp() where singleton;
  for s in select se.* from public.sessions se where
    exists(select 1 from public.waitlist_offers o join public.participants p on p.id=o.participant_id where p.session_id=se.id and o.state='pending')
    or (se.waitlist_mode='automatic' and se.operational_status in ('voting_open','joining_open') and se.starts_at>=clock_timestamp()+interval '15 minutes'
      and exists(select 1 from public.participants p where p.session_id=se.id and p.participation_status='waitlisted'))
    order by se.id for update of se skip locked loop
    begin
      at_value:=clock_timestamp();
      perform app_private.reconcile_waitlist(s.id,at_value);
      processed_value:=processed_value+1;
    exception when others then
      get stacked diagnostics code_value=returned_sqlstate;
      failures_value:=failures_value+1;last_code:=code_value;
      -- Save only SQLSTATE, never provider diagnostics or private payloads.
      for admin_id in select user_id from public.memberships where role='admin' and status='active' loop
        perform app_private.persist_notification(admin_id,'waitlist_job_failure:'||s.id||':'||to_char(at_value at time zone 'UTC','YYYYMMDDHH24')||':'||admin_id,
          'waitlist_job_failure',jsonb_build_object('session_id',s.id,'session_title',s.title,'code',code_value));
      end loop;
    end;
  end loop;
  update app_private.waitlist_job_health set last_completed_at=clock_timestamp(),processed=processed_value,failures=failures_value,last_error_code=last_code where singleton;
  return jsonb_build_object('processed',processed_value,'failures',failures_value);
end;
$$;
revoke all on function public.expire_waitlist_offers() from public,anon,authenticated,service_role;
grant execute on function public.expire_waitlist_offers() to service_role;

create function public.mark_notification_read(notification_id_input uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; read_value timestamptz;
begin
  actor:=public.assert_active_membership();
  perform 1 from public.memberships where user_id=actor and status='active' for share;
  if not found then raise exception 'MEMBERSHIP_NOT_ACTIVE' using errcode='42501'; end if;
  update public.notifications set read_at=coalesce(read_at,clock_timestamp()) where id=notification_id_input and user_id=actor returning read_at into read_value;
  if not found then raise exception 'NOTIFICATION_NOT_FOUND' using errcode='42501'; end if;
  return jsonb_build_object('notification_id',notification_id_input,'read_at',read_value);
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public,anon,service_role;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- PGlite's offline PostgreSQL distribution has no pg_cron. Actual Supabase
-- migrations install/configure the extension and schedule one database job.
-- Hosted setup must verify the extension/job health, as documented in OPERATIONS.
do $$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('bjbc-waitlist-minute','* * * * *','select public.expire_waitlist_offers();');
  else
    raise warning 'pg_cron unavailable: waiting-list scheduler must be installed and verified before pilot.';
  end if;
end;
$$;
commit;
