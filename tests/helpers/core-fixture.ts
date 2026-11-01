export const fixtureId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export type CoreActors = { a: string; b: string; pending: string; suspended: string; admin: string }

// Trusted synthetic fixtures, not production APIs. Caller owns all these IDs.
export function coreFixtureSql(users: CoreActors) {
  const q = (value: string) => `'${value.replaceAll("'", "''")}'`
  const id = (n: number) => q(fixtureId(n))
  return `
    update public.memberships set status='active' where user_id in (${q(users.a)},${q(users.b)},${q(users.admin)});
    update public.memberships set status='suspended' where user_id=${q(users.suspended)};
    update public.memberships set role='admin' where user_id=${q(users.admin)};
    insert into public.guests(id,name,phone,sponsor_user_id) values (${id(1)},'Synthetic Guest','+601129999999',${q(users.a)});
    insert into public.players(id,user_id) values (${id(11)},${q(users.a)}),(${id(12)},${q(users.b)}),(${id(13)},${q(users.suspended)});
    insert into public.players(id,guest_id) values (${id(14)},${id(1)});
    -- This actor-matrix fixture has no worker lifecycle. Keep it manual so the
    -- real minute scheduler cannot create guest offers/audits during expiry tests.
    insert into public.sessions(id,title,venue,starts_at,ends_at,capacity,voting_closes_at,operational_status,created_by,waitlist_mode)
    values (${id(20)},'Synthetic published session','Test court',now()+interval '2 days',now()+interval '2 days 2 hours',4,now()+interval '1 day','voting_open',${q(users.admin)},'manual'),
    (${id(21)},'Synthetic draft','Test court',now()+interval '3 days',now()+interval '3 days 2 hours',4,now()+interval '2 days','draft',${q(users.admin)},'manual');
    insert into public.polls(id,session_id,opens_at,closes_at,status) values (${id(25)},${id(20)},now(),now()+interval '1 day','open');
    insert into public.participants(id,session_id,player_id,source,participation_status,attendance,charge_percent) values
    (${id(31)},${id(20)},${id(11)},'vote','confirmed','unmarked',100),
    (${id(32)},${id(20)},${id(12)},'direct','confirmed','unmarked',100),
    (${id(33)},${id(20)},${id(13)},'direct','confirmed','unmarked',100),
    (${id(34)},${id(20)},${id(14)},'guest','waitlisted','not_applicable',0);
    insert into public.fee_versions(id,session_id,full_fee_sen,version,published_by) values (${id(40)},${id(20)},2000,1,${q(users.admin)});
    insert into public.charges(id,participant_id,session_id,fee_version_id,percent,amount_sen) values
    (${id(51)},${id(31)},${id(20)},${id(40)},100,2000),
    (${id(52)},${id(32)},${id(20)},${id(40)},100,2000),
    (${id(53)},${id(33)},${id(20)},${id(40)},100,2000);
    insert into public.payments(id,charge_id,method,amount_sen,receipt_object_path,submitted_by,idempotency_key)
    values (${id(60)},${id(52)},'transfer',2000,${q(`${users.b}/${fixtureId(52)}/${fixtureId(70)}.pdf`)},${q(users.b)},${id(61)});
    insert into public.notifications(id,user_id,event_key,type,payload) values
    (${id(80)},${q(users.a)},'synthetic:a','fixture','{"message":"Own notice"}'),
    (${id(81)},${q(users.b)},'synthetic:b','fixture','{}');
    insert into public.audit_logs(id,actor_user_id,action,entity,entity_id) values (${id(90)},${q(users.admin)},'fixture','sessions',${id(20)});
  `
}
