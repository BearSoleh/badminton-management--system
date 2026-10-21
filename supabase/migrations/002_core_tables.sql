-- Task 2 schema foundation. Domain transitions are implemented in Tasks 3–8.
begin;

-- New objects are private until the explicit grants/policies in 003.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$' and phone not like '+600%'),
  sponsor_user_id uuid references public.profiles(id),
  verified_by uuid references public.profiles(id),
  linked_user_id uuid unique references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sponsor_user_id is not null or verified_by is not null)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id),
  guest_id uuid unique references public.guests(id),
  created_at timestamptz not null default now(),
  check ((user_id is not null)::integer + (guest_id is not null)::integer = 1)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  venue text not null check (char_length(btrim(venue)) between 1 and 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  voting_closes_at timestamptz not null,
  waitlist_mode text not null default 'automatic' check (waitlist_mode in ('automatic','manual')),
  operational_status text not null default 'draft' check (operational_status in ('draft','voting_open','joining_open','in_progress','completed','cancelled')),
  billing_status text not null default 'not_published' check (billing_status in ('not_published','published','settled','voided')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (voting_closes_at <= starts_at)
);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft','open','closed','cancelled')),
  check (closes_at > opens_at)
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id),
  user_id uuid not null references public.profiles(id),
  choice text not null check (choice in ('play','pass')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_id,user_id),
  check ((choice='play' and joined_at is not null) or (choice='pass' and joined_at is null))
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  player_id uuid not null references public.players(id),
  source text not null check (source in ('vote','direct','guest','admin')),
  queue_joined_at timestamptz not null default clock_timestamp(),
  participation_status text not null check (participation_status in ('confirmed','waitlisted','offered','withdrawn_early','late_cancelled','offer_declined','offer_expired')),
  attendance text not null default 'unmarked' check (attendance in ('unmarked','present','no_show','not_applicable')),
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  charge_percent smallint not null default 0 check (charge_percent in (0,75,100)),
  created_at timestamptz not null default now(),
  unique (session_id,player_id),
  unique (id,session_id)
);
create index participants_player_idx on public.participants(player_id);
create index participants_queue_idx on public.participants(session_id,queue_joined_at,id);

create table public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','accepted','declined','expired','revoked')),
  response_at timestamptz,
  check (expires_at = offered_at + interval '15 minutes'),
  check ((state in ('accepted','declined') and response_at is not null) or state in ('pending','expired','revoked'))
);
create unique index one_pending_offer_per_participant on public.waitlist_offers(participant_id) where state='pending';
create index waitlist_offers_expiry_idx on public.waitlist_offers(expires_at) where state='pending';

create table public.session_costs (
  session_id uuid primary key references public.sessions(id),
  court_cost_sen integer not null default 0 check (court_cost_sen >= 0),
  shuttle_quantity integer not null default 0 check (shuttle_quantity >= 0),
  shuttle_cost_sen integer not null default 0 check (shuttle_cost_sen >= 0),
  notes text check (char_length(notes) <= 2000)
);

create table public.fee_versions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  full_fee_sen integer not null check (full_fee_sen >= 0),
  version integer not null check (version > 0),
  published_at timestamptz not null default now(),
  published_by uuid not null references public.profiles(id),
  reason text check (char_length(btrim(reason)) between 1 and 2000),
  unique (session_id,version),
  unique (id,session_id),
  check (version=1 or reason is not null)
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null,
  session_id uuid not null references public.sessions(id),
  fee_version_id uuid not null,
  percent smallint not null check (percent in (0,75,100)),
  amount_sen integer not null check (amount_sen >= 0),
  status text not null default 'unpaid' check (status in ('unpaid','pending_verification','paid','voided','superseded')),
  is_current boolean not null default true,
  supersedes_charge_id uuid unique references public.charges(id),
  created_at timestamptz not null default now(),
  foreign key (participant_id,session_id) references public.participants(id,session_id),
  foreign key (fee_version_id,session_id) references public.fee_versions(id,session_id),
  check (supersedes_charge_id is null or supersedes_charge_id <> id)
);
create unique index one_current_charge_per_participant on public.charges(participant_id) where is_current;
create index charges_session_idx on public.charges(session_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges(id),
  method text not null check (method in ('transfer','cash')),
  amount_sen integer not null check (amount_sen >= 0),
  receipt_object_path text unique,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  submitted_by uuid references public.profiles(id),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  rejection_reason text,
  idempotency_key uuid not null unique,
  refund_status text not null default 'none' check (refund_status in ('none','pending','refunded')),
  refunded_at timestamptz,
  refund_reason text,
  created_at timestamptz not null default now(),
  check ((method='transfer' and receipt_object_path is not null) or (method='cash' and receipt_object_path is null)),
  check (status='submitted' or (verified_by is not null and verified_at is not null)),
  check (status <> 'rejected' or char_length(btrim(rejection_reason)) > 0 and rejection_reason is not null),
  check (refund_status <> 'refunded' or (refunded_at is not null and char_length(btrim(refund_reason)) > 0 and refund_reason is not null))
);
create unique index one_open_payment_per_charge on public.payments(charge_id) where status in ('submitted','approved');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  guest_id uuid references public.guests(id),
  event_key text not null,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((user_id is not null)::integer + (guest_id is not null)::integer = 1)
);
create unique index notifications_user_event on public.notifications(user_id,event_key) where user_id is not null;
create unique index notifications_guest_event on public.notifications(guest_id,event_key) where guest_id is not null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id),
  actor_guest_id uuid references public.guests(id),
  action text not null,
  entity text not null,
  entity_id uuid not null,
  safe_metadata jsonb not null default '{}',
  reason text,
  created_at timestamptz not null default now(),
  check (not (actor_user_id is not null and actor_guest_id is not null))
);

create table public.club_settings (
  id boolean primary key default true check (id),
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  qr_object_path text,
  timezone text not null default 'Asia/Kuala_Lumpur' check (timezone='Asia/Kuala_Lumpur'),
  currency text not null default 'MYR' check (currency='MYR'),
  updated_at timestamptz not null default now()
);

-- Capabilities are never part of the public API schema; only hashes are stored.
create table app_private.guest_access_tokens (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id),
  session_id uuid not null references public.sessions(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  scope text not null check (scope in ('session_payment')),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create table app_private.recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  issued_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create table app_private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  channel text not null default 'in_app' check (channel='in_app'),
  state text not null default 'pending' check (state in ('pending','delivered','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  delivery_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (event_key,channel)
);

-- Fail closed in this migration too, before 003 installs any read policy.
do $$ declare tbl text; begin
  foreach tbl in array array['guests','players','sessions','polls','votes','participants','waitlist_offers','session_costs','fee_versions','charges','payments','notifications','audit_logs','club_settings'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',tbl);
  end loop;
  foreach tbl in array array['guest_access_tokens','recovery_tokens','notification_outbox'] loop
    execute format('alter table app_private.%I enable row level security',tbl);
    execute format('revoke all on app_private.%I from public,anon,authenticated,service_role',tbl);
  end loop;
end $$;

commit;
