# BJBC setup and operations

## Phase and language

Tasks 1–5 authorized. Owner approved the specification and D01–D16 on 20 October 2026 and changed all user-facing website copy to English; Task 2 was authorized on 21 October, Task 3 on 22 October, Task 4 on 23 October and Task 5 on 30 October. R14's English label is **Fee not yet set**. The root development pack remains the untouched original; docs/BJBC_Codex_Development_Pack_v1.md is the working specification.

No remote project, paid subscription, SMS account, notification delivery or deployment has been created. GitHub and Cloudflare access are not required to preview Task 1 locally.

**Current status, 30 October 2026:** Tasks 1–5 are verified locally, including attendance, manual fee entry, preview and immutable publication. The owner installed WSL 3.0.3 and Docker Desktop (CLI 29.9.1); earlier runtime blockers below are historical. No machine software was installed by the agent. The minute waiting-list job remains installed and verified. Tasks 6–8 and deployment are not authorized.

## Prerequisites and local setup

1. Install Node 22.12+ (tested here with 24.14.1) and Git. Run `npm ci` in the project folder.
2. Install and start Docker Desktop with Linux containers (or a compatible Docker runtime). The Supabase CLI is included as a pinned development dependency. Installing Docker is a machine-level action left to the owner.
3. Run `npm run db:start`. The first run downloads local Supabase containers and initializes a new database with the existing migrations. Run `npm run db:reset` **only after verifying a disposable local database** as described below; this command deletes local database data and is not an automatic setup step.
   For an existing stack, use `npm run db:migrate` to apply pending local migrations without deleting data. If the Task 1 stack excluded Storage/Edge Runtime, stop it with `npx supabase stop` (retain its backup), then start it with Storage/Edge enabled. `supabase start` alone does not add previously excluded containers to a running stack. Do not use `--no-backup` on the development stack.
4. Retrieve the local API URL and publishable key from the Supabase local dashboard or `npx supabase status`. That command may display backend credentials: run it privately, do not paste its output into chat or logs.
5. Copy `.env.example` to `.env.local`. Set only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the local values. Restart Vite after changing them. These are public browser configuration, not secrets.
6. Run `npm run dev`; visit the printed loopback URL. Register using a synthetic name, phone and a password of at least 12 characters. Passwords are submitted directly to Supabase Auth and are never saved in profile tables or application logs.

Vite uses port 5173; local Supabase uses 54321 (API), 54322 (database) and 54323 (Studio when enabled). Domain/PGlite and HTTP-fixture browser checks need no backend credentials. Live checks use private local credentials, without requiring a hosted account.

## Historical Windows prerequisite blocker — resolved 21 October 2026

At the earlier check, the machine reported **WSL is not installed**. Docker/Podman were not detected. The owner subsequently installed WSL and Docker Desktop. The setup instructions below remain useful for another machine; this computer now has a running Linux engine. No machine software was installed by the agent.

Owner setup, following the current [Microsoft WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands), [WSL installation guide](https://learn.microsoft.com/en-us/windows/wsl/install), [Docker Windows installation guide](https://docs.docker.com/desktop/setup/install/windows-install/) and [Docker WSL backend guide](https://docs.docker.com/desktop/features/wsl/):

1. Open **PowerShell as Administrator** and run the following yourself, then restart Windows if requested. Docker does not require a separate Ubuntu distribution for commands run from Windows.

   ```powershell
   wsl --install --no-distribution
   ```

2. After restarting, run `wsl --version`. Docker's documented minimum is WSL 2.1.5; if needed, update with `wsl --update`.
3. Download and install **Docker Desktop for Windows x86_64** from the official installation guide. Select the **WSL 2 backend**, start Docker Desktop and wait until its engine is running. Use **Linux containers**. If a menu action says “Switch to Linux containers”, select it; if it says “Switch to Windows containers”, Linux mode is already selected.
4. Open a new PowerShell window so PATH changes are picked up, then verify locally:

   ```powershell
   docker version
   docker info --format '{{.OSType}}'
   ```

   `docker version` must report both Client and Server; the OS type must be `linux`. No login credentials or command output containing secrets need to be shared in chat. If WSL/Docker reports disabled hardware virtualization, enable virtualization through the machine's firmware settings or ask its administrator; no firmware or Windows feature changes were attempted here.
5. Resume Task 1 in this project. The agent can then start Supabase, inspect database safety, configure ignored local environment files privately from the actual local credentials, run real Auth/PostgREST tests and compare the official generated types. No hosted Supabase account, paid provider or external notification is needed for these local checks.

The official Supabase [local-development guide](https://supabase.com/docs/guides/local-development/cli/getting-started) requires a container runtime for this Windows workflow. Its experimental native runtime supports Linux and Apple-silicon macOS; it is not a Windows workaround used by this project.

## Verify database safety before any reset

Before starting a stack for the first time, inventory existing containers and volumes for project `bjbc` without deleting them. Existing `supabase_*_bjbc` containers/volumes may contain prior work, even when no containers are running. The `project_id` and a loopback URL alone do not prove disposability.

When a local stack is available, inspect its migration history, application tables and Auth user counts using trusted local SQL/Studio. Record whether it is a newly initialized empty stack, contains only known disposable synthetic fixtures, or contains data of unknown ownership. If existing data cannot be proven disposable, preserve it and obtain the owner's decision before reset. Do not print names, phone numbers, credentials or raw Auth records in logs.

Prefer applying pending migrations without reset when preserving existing local data. `npm run db:reset` is permitted only for a verified disposable **local** target; never use linked/remote reset options for this verification. Before this stack's first start, both Docker container and volume inventories were empty. Startup initialized the database and applied migration `001`; queries then confirmed zero profiles and Auth users. **No reset was needed or run.**

## Verified Task 1 local runtime

The actual verification used the five core services: PostgreSQL, GoTrue Auth, PostgREST, Kong and postgres-meta. Storage, Studio and later-phase services were excluded to keep this Task 1 run focused:

```powershell
npx supabase start --exclude 'realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit'
```

The normal `npm run db:start` starts the configured full local stack. Storage/buckets were excluded from that historical Task 1 run; they are now verified separately under Task 2 below.

## Task 2 schema, permissions and receipt runtime

Task 2 extends the existing stack without resetting it. Migrations `002` and `003`
add 14 core public tables (16 including Task 1 identities), three backend-only
tables in `app_private`, read permissions and the private `receipts` bucket. Every
application table has RLS. Public/guest credentials cannot read them; pending
accounts retain only their limited own identity. Active members read published
sessions, their own records and a safe roster RPC. Suspended members retain own
charges/payments and backing fee versions, with no session/vote/join privilege.
Active admins can read club records/audit; even admin JWTs cannot directly write
roles, phones, fee/payment states or receipt paths. Later validated RPCs own those
changes. Backend service credentials remain privileged and server-only.

`get_session_roster(session_id_input uuid)` returns only session/participant IDs,
display name, participation status and attendance. It checks current database
membership and session visibility inside a narrow, safe-search-path definer
function. Foreign profiles, player mappings, phones and payment histories are not
exposed through that projection. Draft sessions/rosters are admin-only.

Guest/recovery hashes and notification outbox are outside the exposed API schema.
There is no raw token column. Guests have **no direct data/storage access yet**;
Task 7 will add the scoped capability transport and own invited record access.
Guessing a guest ID/phone or supplying a guest header grants nothing. No WhatsApp
channel is enabled. Audit grants permit backend append/read only, with no update,
delete or truncate privilege; trusted SQL operators retain maintenance access.

To run the Task 2 local stack and receipt endpoint:

```powershell
npx supabase start --exclude 'realtime,imgproxy,studio,logflare,vector,supavisor,mailpit'
npm run db:migrate
# Copy only if there is no existing function env file; preserve existing values.
if (-not (Test-Path -LiteralPath 'supabase/functions/.env')) {
  Copy-Item supabase/functions/.env.example supabase/functions/.env
}
npm run functions:serve
```

Set `BJBC_PUBLIC_SUPABASE_URL` in that ignored function env file to the actual
public API origin (local default `http://127.0.0.1:54321`). The provider injects
the function's internal URL, anon key and service-role credential; never copy
those into browser variables. Keep JWT verification enabled. The function also
validates the bearer through Auth and calls the authorization RPC as that user.
The Deno dependency lockfile is frozen; `npm run typecheck:edge` validates it.

Receipt upload paths are `<user UUID>/<charge UUID>/<object UUID>.pdf` (or
`.jpg`, `.jpeg`, `.png`). A current own unpaid charge with no submitted/approved
payment is required. The bucket enforces **5 MiB / 5,242,880 bytes**, JPEG, PNG or
PDF. Suspended members may upload for their own existing obligations. Client
uploads are insert-only; overwrite, copy, listing and deletion cannot expose or
replace receipt history. Submission and file-content verification remain Task 6.

Call `POST /functions/v1/receipt-view` with a user bearer and JSON `{ "path":
"<authorized receipt path>" }`. `authorize_receipt_view` checks both the charge
identity and existing Storage ownership. The function alone uses its server
client to issue a **60-second**, download-only URL, returning `{ url, expiresIn:
60 }` with `Cache-Control: no-store`. Caller-supplied lifetime values are ignored.
There is no client Storage SELECT policy, so direct signing with a longer expiry
is denied, even for admin JWTs. The explicit public origin prevents Host/Origin
headers from selecting the returned URL's host. Do not log returned URLs/tokens.

Signed URLs are bearer capabilities until expiry; an already issued URL can be
used for its remaining lifetime after logout/suspension. Membership changes stop
new issuance. Do not claim immediate revocation of existing links. Viewing links
use the configured public API origin; a hosted pilot will need its actual HTTPS
origin and separately authorized deployment of this function, neither done here.

All three migrations were also applied by the real CLI to an isolated fresh local
Supabase stack on ports 54331/54332. It showed migrations 001–003, 16 public tables,
zero tables missing RLS and the private bounded receipt bucket. Zero users/profiles/
objects were confirmed before that disposable check stack was removed. The
development database was not reset; only its pending migrations were applied.

Credentials from `supabase status --output json` were captured privately into ignored `.env.local` and `.env.test.local` files; values were not printed or committed. Preserve existing environment files when resuming. All synthetic accounts and bootstrap audit fixtures were removed after tests; the final counts for profiles, Auth users and bootstrap events were all zero. **No real first admin has been configured.**

## Task 3 sessions and participation

Apply `npm run db:migrate` to an existing local stack; migration `004` is additive
and no development database reset is needed. Regenerate/check types as usual.
Use the existing trusted first-admin setup below for an intended real operator;
development tests create and remove synthetic admins, never configure the owner
from a phone supplied in chat. The member website is no longer an empty foundation.

Routes: `/app` lists upcoming/history sessions; `/app/sessions/:id` shows details,
safe roster, current participation and authoritative actions. Admins additionally
have `/admin/sessions`, `/admin/sessions/new`, `/admin/sessions/:id` and `/edit`.
Admin controls create/edit **drafts**, then publish voting. Published scheduling/
capacity details are locked in this phase, to protect votes and cancellation terms;
later audited rescheduling is not implemented. Admins can also vote as players.

Public RPC inputs (all mutations also require a UUID `request_id`):

- `save_session`: `session_id_input` (SQL NULL for new draft), `title_input`,
  `venue_input`, `starts_at_input`, `ends_at_input`, `capacity_input`,
  `voting_closes_at_input`, `waitlist_mode_input`.
- `publish_session`, `join_session`: `session_id_input`.
- `cast_session_vote`: `session_id_input`, `choice_input` (`play` / `pass`), shown
  in English as **Play / Not playing**. Not playing after confirmation withdraws.
- `withdraw_participation`: `participant_id_input`; identity derives from Auth.
- `get_session_snapshot`: `session_id_input`, read-only, returning server time,
  session details, own state, safe roster/counts and allowed action flags.

Current database membership is checked and held stable through each mutation.
Actor/request ID rows in `app_private.operation_requests` serialize retries;
identical payloads return the original result, conflicting reuse fails. Request
reservation, mutation and audit commit together. Clients keep the same UUID when
retrying unchanged details after a network/API failure. They cannot read/write
the private request ledger or invoke transaction helpers directly.

Each participation transaction locks the session row and samples `clock_timestamp`
**after** obtaining that lock. Initial affirmative votes confirm while capacity
permits, otherwise queue. Confirmed players plus live held offers count as occupied.
Existing waiting/offered participants prevent later joins from bypassing the queue.
Repeated Play votes preserve priority; explicit rejoin gets a new timestamp and
previous state/timestamps remain in append-only audit metadata. UUID breaks an exact
timestamp tie consistently. Direct joins are allowed only after voting closes and
before start. No self-withdraw/join is allowed at or after start, or in completed/
cancelled sessions. The backend rejects caller-supplied actor IDs, times and rates.

Withdrawals compare KL calendar dates: before the session day 0%, on the day after
confirmation 75%. A private pure percentage function has fixed-date boundary tests;
public mutations pass only server time. UI confirmation shows the current percentage
and both calendar rules, explains that processing time determines the rate, and says
the amount is determined after play. A `liability_percent` floor retains an existing
late-cancellation obligation when someone rejoins/withdraws from a waiting list;
Task 5 must preserve that floor when computing charges, subject to session cancellation.
There is no monetary split or fee publication in Task 3.

Task 3 originally left vacancies behind an existing queue unallocated. Task 4
now offers them with the required
15-minute consent window. A Play retry cannot accept a held offer. Session reads
refresh after actions and through **Refresh session**; no realtime subscription or
background delivery is claimed. Suspended own-payment reads from Task 2 remain intact;
the payment UI is still a later phase.

Security review found that schema-scoped default function REVOKE cannot remove
PostgreSQL's global PUBLIC EXECUTE default. Migration `004` explicitly revokes all
private-function execute grants from public/anon/authenticated/service roles, then
restores only the seven caller-scoped RLS predicates for authenticated clients.
The existing SMS hook retains its explicit auth-admin grant. New migrations must
explicitly grant/revoke each function; do not rely on schema defaults as a deny rule.
Regression tests prove private transaction helper calls fail even for an admin.

Official references checked on 22 October 2026: [PostgreSQL locks](https://www.postgresql.org/docs/17/explicit-locking.html),
[transaction snapshots](https://www.postgresql.org/docs/17/transaction-iso.html),
[time functions](https://www.postgresql.org/docs/17/functions-datetime.html),
[default privilege behavior](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html),
[Supabase RPC](https://supabase.com/docs/reference/javascript/rpc) and
[React lazy/Suspense](https://react.dev/reference/react/lazy).

## Task 4 waiting-list offers and notification job

Apply migrations `005` and `006` with `npm run db:migrate`; preserve the development
database. Migration 005 wraps the tested Task 3 RPCs, retaining their public
signatures and idempotent results. A withdrawal or Not playing vote reconciles the
queue in the same locked transaction. Initial automatic offers and every later
expiry/decline preserve timestamp order; confirmed places plus live holds consume
capacity. Inactive players are skipped. Unlinked guest eligibility remains Task 7.

An offer lasts exactly **15 minutes**. Continue checks ownership, current active
membership, session status and server time **after acquiring the session lock**.
At `expires_at` it cannot confirm, regardless of scheduler delay. A stale response
returns `offer_state: expired` and commits expiry/promotion; a thrown error would
roll those writes back. Reusing the same actor/request/payload returns its original
result, so refresh the session to see current state after a retry.

The member home checks active offers every 30 seconds while visible and on focus.
Session detail has Continue/Decline with a server-calibrated countdown; expiry and
returning to the tab refresh the authoritative snapshot. An expired hold awaiting
the worker shows an ended window with disabled actions. `/app/notifications`
shows the latest 100 own messages, unread count, explicit Mark as read, refresh
and links to current session state. It also refreshes on return to the tab.
Messages are **in-app only** and cannot alert a player with the site closed.
Outbox `delivered` means persisted in the inbox, never read or externally sent.
Read state changes only on the user's explicit action.

Admin session detail includes an ordered queue, promotion mode and manual offers.
Every manual action requires a reason; selecting someone ahead of the oldest
eligible player is audited. Manual mode still expires holds but offers no new
ones automatically. Switching to automatic reconciles immediately; existing held
offers remain live in either mode. Inside 15 minutes of start, a timed offer is
unavailable: an admin may confirm a **waitlisted** player only after recording
explicit consent and a reason. No join/promotion/late confirmation after start.
Cancellation/completion revokes remaining holds immediately; the complete audited
cancellation/billing/refund operation remains Task 6.

### Install and verify the minute scheduler

The implementation follows the official [Supabase Cron overview](https://supabase.com/docs/guides/cron)
and [SQL scheduling guide](https://supabase.com/docs/guides/cron/quickstart), checked
23 October 2026. Migration 006 enables available `pg_cron` and schedules exactly
one named database job. A trusted operator can verify privately in SQL:

```sql
select jobid,jobname,schedule,active,command
from cron.job where jobname='bjbc-waitlist-minute';
-- Exactly one active row: * * * * * / select public.expire_waitlist_offers();

select status,start_time,end_time,return_message
from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='bjbc-waitlist-minute')
order by start_time desc limit 5;

select * from app_private.waitlist_job_health;
-- Recent last_completed_at (within about two minutes), failures=0.
```

This is a database job, independent of the frontend/browser and Edge runtime.
Only the database owner and backend service role can execute
`public.expire_waitlist_offers()`. An admin JWT cannot call the worker; its browser
uses the validated admin RPCs. The worker serializes duplicate executions with an
advisory transaction lock, skips sessions busy in another transaction, and samples
time after each session lock. Skipped sessions are retried next minute.

Each session is isolated in a subtransaction. A notification persistence failure
rolls that session's partial changes back, records only SQLSTATE in health and
persists one admin warning per session/hour. Other sessions continue; the next run
retries the failed session. If the database cannot persist even the warning, the
job fails visibly in Cron history. Check both history and the health row; an old
successful run does not prove the scheduler is still running. Cron history grows
until an operator applies a retention policy; include it in pilot operations.

If the named job is missing after enabling Cron, restore it as a trusted operator:

```sql
select cron.schedule('bjbc-waitlist-minute','* * * * *',
  'select public.expire_waitlist_offers();');
```

The same name updates the existing job rather than creating a second name.
The offline PGlite distribution has no `pg_cron`; migration 006 emits a warning
there and still permits deterministic rule tests. A real environment without Cron
is **not pilot-ready** until the extension/job is installed and verified. No
hosted scheduler, secrets or public deployment were configured in Task 4.


## Phone/password Auth, without SMS

Official provider material was checked on 20 October 2026:

- [Password authentication](https://supabase.com/docs/guides/auth/passwords): native phone/password signup and login.
- [CLI configuration](https://supabase.com/docs/guides/local-development/cli/config): phone signup and confirmation flags.
- [CLI source validation](https://github.com/supabase/cli/blob/develop/apps/cli-go/pkg/config/config.go): the local CLI disables phone signup if no provider is configured, even when confirmation is disabled.
- [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks) and [Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook): database hook transport, selective grants and error responses.
- [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): backend record access.
- [Tailwind/Vite integration](https://tailwindcss.com/docs/installation/using-vite), [Vite](https://vite.dev/guide/) and [Cloudflare React deployment](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/).

The checked-in local configuration enables phone signup and disables phone confirmation. Email signup and anonymous Auth signup are disabled. Password minimum is 12; refresh token rotation is enabled; sign-in/signup requests have a configured rate limit. Do not enable SMS MFA or an OTP UI.

**Local CLI compatibility:** `auth.sms.twilio` contains clearly labeled nonfunctional local sentinel values, not credentials and not a Twilio account. They keep the CLI from disabling phone login. A PostgreSQL Send SMS hook, `app_private.reject_sms_delivery`, returns an HTTP 403 error; it neither sends messages nor records the supplied phone/OTP. Its grants are restricted to `supabase_auth_admin`. The configured SMS rate value remains zero; delivery prevention relies on the rejecting hook, not an assumed interpretation of that rate value. Actual SMS-disabled signup/login passes against the running Auth service. An explicit SMS authentication API attempt returns HTTP 403 with our exact hook message, verifying the live Auth → SQL rejection path; hook grants/result were also checked directly. Custom hook errors report SDK code `unknown`, so the test asserts their documented status/message contract. No real SMS delivery/provider call succeeded and no OTP flow was introduced.

Disabling confirmation means **phone possession is unverified**, even if Supabase internally calls the identity auto-confirmed. The website must not describe the phone as verified. A matching phone alone cannot authorize recovery or future guest record claiming.

For a later hosted pilot, use a separate free-tier Supabase project with phone authentication enabled, phone confirmation disabled and the same password/rate-limit settings. Apply the migrations and configure the rejecting Send SMS hook in the Auth dashboard before allowing access. Do not copy the local sentinel provider settings into hosted configuration. Recheck the hosted dashboard/API's current requirements when access is available; no hosted SMS-free settings are claimed tested here. If hosted configuration prevents enabling phone/password without a real SMS account, stop and report that provider constraint rather than introducing OTP, fake email identities or a paid provider.

## Trusted first-admin bootstrap

Register the intended first admin through the normal phone/password form first. The account starts pending/member, regardless of signup metadata. A trusted database operator verifies the person's identity and runs this in the local SQL editor (replace the placeholder with the actual normalized phone privately):

```sql
select app_private.bootstrap_first_admin('+60_REPLACE_WITH_VERIFIED_PHONE');
```

The function is outside the API schema, cannot be executed by `anon`, `authenticated` or `service_role`, serializes bootstrap attempts, refuses if any admin already exists and records operator/target/time in private `identity_events`. The trusted SQL operator performs it. Do not build a public bootstrap route, password field or signup role selector.

Normal admin approval and suspension UI is Task 8. To test Task 1 approval locally, use a trusted SQL operator to change a synthetic account's membership status to `active`. Such fixture changes are not the final production admin workflow.

## Database contracts and migrations

`supabase/migrations/001_identity.sql` is the ordered Task 1 migration. `profiles` and `memberships` have RLS and authenticated own-record reads only. Clients cannot write role, status or phone. Signup metadata is used only for the display name; membership is always pending/member. Server phone validation rejects noncanonical values; the maintained phone parser canonicalizes accepted browser input to E.164.

- `get_my_membership()` returns only the caller's profile and membership.
- `assert_active_membership()` raises `MEMBERSHIP_NOT_ACTIVE` unless the caller has active membership. Task 3 participation RPCs call this guard; pending/suspended users cannot mutate participation.
- `update_my_display_name(display_name_input)` validates the name and active membership, derives identity from `auth.uid()` and changes only the caller's display name.
- Auth credential phone changes are blocked at the database so the Auth API cannot diverge from profiles. Audited administrator phone verification/change is not implemented yet; do not disable this guard as a workaround.
- Admin bootstrap events are retained separately for later integration with the full audit system. Future financial data must not use destructive cascade deletion.

Run `npm run db:types` after migration changes. This generates `src/types/database.ts` by introspecting the public schema in a real PGlite PostgreSQL database after applying the ordered migrations. `node scripts/generate-db-types.mjs --check` detects stale output. Only the Auth-owned schema is represented by a fixture. Supported type mappings deliberately fail on unfamiliar types; extend the generator when adding new schema types.

With the real local stack running, run `npm run db:types:verify`. It captures official `supabase gen types typescript --local --schema public` output into ignored `.superpowers/` files and compares every public table/function name, Row/Insert/Update/Relationships and RPC Args/Returns. Task 1 had 13 contracts, Task 2 had 71, and **all 77 Task 3 contracts matched on 22 October 2026**; Task 4 extends that to **85 verified contracts on 23 October 2026**. This covers composite FKs, non-null JSON and the six new RPCs. Official helper exports/ComputedFields metadata are not API-contract differences. Extend the generator/verifier if later phases add views or new PostgreSQL types.

## Tests and their boundaries

- `npm test`: **115 cases**: 34 domain/configuration/time/money and 81 PostgreSQL identity/core/participation/waitlist/billing cases. PGlite executes ordered migrations, roles, constraints, RLS and PL/pgSQL; its Auth/Storage schema fixtures do not run provider services or prove multi-connection concurrency.
- `npm run test:e2e`: **26 desktop/mobile UI cases** with explicit HTTP fixtures: Auth, honest empty sessions, history, admin-route denial, late-withdrawal confirmation, unchanged request IDs on retry and recovery from an intentionally failed route-module download. React emits an expected development console error in that fault-injection case. These checks do not prove the real backend works.
- `npm run test:integration`: **42 actual local backend checks**: 11 Auth, 15 privacy/Storage/Edge, 9 participation and 7 waitlist tests. The runner requires the BJBC API on loopback port 54321 and ignored local credentials; trusted SQL fixtures target `supabase_db_bjbc`. Start Storage and `npm run functions:serve`. Concurrency cases hold a real session-row lock, observe two separate HTTP transactions waiting on it, then release them and assert one confirmed/one waiting. The signed-receipt expiry case takes just over a minute. Unavailable/skipped tests never count as passing.
- `npm run test:e2e:live`: **six real journeys** across desktop/mobile, without interception: Auth and admin draft/edit/publish → member vote/withdraw/post-voting join, plus admin mode/manual offer → own inbox/read → Continue → withdrawal/automatic promotion → Decline. Backend credentials stay in Node. Automatic screenshots/video/traces remain off. Explicit Task 3/4 screenshots capture only synthetic post-login session/inbox content under ignored `.superpowers/`; no credential forms are captured.
- `npm run typecheck`, `npm run typecheck:edge`, `npm run lint`, `npm run build`: browser/test TypeScript, frozen strict Deno server check, lint and production build.

Task 2 official provider references were rechecked on 21 October 2026:
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[bucket restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets),
[signed URL seconds](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl),
[Edge function authentication](https://supabase.com/docs/guides/functions/auth),
[Auth getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and
[CLI stop/data preservation](https://supabase.com/docs/reference/cli/supabase-stop).

For live tests, put the four variables from `.env.test.example` into a private `.env.test.local` file: local URL, public key, backend secret key and local JWT signing secret. The signing secret is only for the controlled server-expiry fixture. Never use pilot/production keys. The npm command loads the file without printing values; the explicit equivalent is:

```powershell
node --env-file=.env.test.local scripts/run-integration.mjs
```

Tests use valid-format synthetic phone identities and delete their own Auth users afterward. Use a disposable local stack only. They verify SMS-disabled signup returning a session, names/nicknames, pending/member defaults, duplicate canonical identities, direct role escalation, own-record privacy, suspension, approved phone/password login, refresh/logout, blocked phone mutation, SMS rejection and trusted first-admin bootstrap.

The expiry test sends a pair of locally signed JWT fixtures with the same synthetic identity to the real PostgREST endpoint: the valid token succeeds, and the already-expired token returns HTTP 401 / `PGRST303`. This verifies actual server expiry enforcement without waiting an hour or changing the configured 3600-second lifetime. It is not an intercepted HTTP response or a claim that the full hour elapsed. Real GoTrue refresh and post-logout refresh-token rejection are tested separately.

Supabase's real `postgres` operator cannot `SET ROLE supabase_auth_admin`; the hook check inspects its real grants rather than changing role membership or weakening permissions. Synthetic bootstrap/cleanup uses the operator connection via `docker exec` stdin. Keep this helper limited to `supabase_db_bjbc` and trusted local fixtures.

## Recovery and secrets

The public recovery page currently directs members to their existing club admin and explains that passwords must never be shared. It does not issue resets. Audited, short-lived, single-use recovery capabilities and session revocation verification belong to Task 7.

Never put backend secret keys, service-role JWTs, database passwords, reset tokens or receipt capabilities into `VITE_` variables, source control or logs. `.env` variants are ignored; committed examples contain placeholders only. The browser client refuses obvious backend keys. Supabase member session tokens are persisted by the supported browser client, so future work must preserve XSS protections. Guest capabilities require their separate, documented transport in Task 7.

For a real pilot, assign trusted owners for admin recovery and secret rotation. Rotate compromised credentials through provider secret settings, update backend-only consumers, revoke affected sessions where supported and verify recovery using synthetic data. There is no automated rotation or recovery service in Task 1.

## Deployment and later operations

No deployment has been performed or authorized. Cloudflare Pages will build with `npm run build`, output `dist`; `public/_redirects` prepares SPA nested-route fallback. Verify the actual Pages behavior when deployment is separately authorized. Do not substitute Sites hosting or Workers for the agreed Pages stack.

Before real sessions/payments, later phases must document and exercise database plus private receipt backups, restore mapping, scheduler monitoring, recovery ownership/cadence and quotas. A database export alone is not a receipt backup. These operations are not claimed implemented in Task 1.

## Task 5 — attendance and manual fees (30 October 2026)

Apply only the pending `007_billing.sql` with `npm run db:migrate`. Do not reset
an existing database. `npm run db:types` regenerates public types; the official
comparison now verifies **89 contracts**. Existing private env files are preserved.

Open an admin session and choose **Manage attendance & fees**, or visit
`/admin/sessions/:id/attendance`. Attendance opens at session start. Only confirmed
players with a recorded confirmation can be marked Attended or No-show. Every
confirmed player must be marked before publication; there is no automatic no-show
bulk conversion. Changing a previous mark requires a reason and is audited.

After the session ends, enter the full per-player fee explicitly. Court cost,
shuttles used, shuttle cost and notes are informational and admin-private. No cost
splitting exists. **Review charges** saves the draft, fetches a server-calculated
preview for every participant and shows 0/75/100 percent and amount. Check the
review confirmation to publish. Editing the form invalidates its preview. A draft
does not create charges or change **Fee not yet set** for members.

Backend contracts, restricted to current active admins:

- `set_attendance(participant_id_input, attendance_input, reason_input, request_id)`.
  Attendance is `present` or `no_show`; an initial mark can have an empty reason.
- `save_fee_draft(session_id_input, full_fee_sen_input, court_cost_sen_input,
  shuttle_quantity_input, shuttle_cost_sen_input, notes_input, request_id)`.
  All money is integer sen; shuttle quantity is an integer. Amounts are nonnegative
  PostgreSQL integers (maximum 2,147,483,647 sen). Notes are at most 2,000 characters.
- `get_fee_preview(session_id_input)` returns private costs, all participant charge
  rows, unmarked count, latest version, server time and `review_token`.
- `publish_session_fee(session_id_input, full_fee_sen_input, review_token_input,
  reason_input, request_id)` locks the session and verifies the unchanged preview,
  saved amount, end time and all attendance marks. An obsolete token fails with
  `FEE_PREVIEW_STALE`; refresh and review again. Caller-supplied rates, identities
  and times are not accepted.

Attended and confirmed no-show: 100%. Stored confirmed KL session-day withdrawal:
75%. Ordinary early withdrawal, remaining waiting/offered participants and declined
or expired offers: 0%. A previously accrued late-cancellation floor survives rejoin
as already implemented in Task 3. Cancellation overrides liability in previews and
blocks publication. Post-publication cancellation/void/refund workflows remain
Task 6; this task does not expose a cancellation action.

75% uses integer half-up rounding with a bigint intermediate: 2,001 sen becomes
1,501 sen; 2 sen becomes 2 sen. Zero is intentional: after publication members see
RM 0.00 and No amount due. Zero-value snapshots use `voided`, never Paid or Unpaid.

Publication atomically creates `fee_versions` and participant `charges`, stores
eligibility/attendance/rate/amount/version snapshots, records its audit event and
marks the session completed with billing published. Cost snapshots are immutable
in `app_private.fee_cost_snapshots`, outside the exposed API schema, with RLS and
no client/service grants. Published fee/charge financial fields reject UPDATE;
clients have read-only RLS access and service-role fee UPDATE/DELETE is revoked.
The trusted PostgreSQL operator retains fixture-maintenance access. Members see
only their charges; suspended own-obligation reads remain allowed by existing RLS.
The website reads the exact immutable version attached to the fetched own charge.

Corrections create another fee version and replacement charge chain, with a reason.
Old amounts and eligibility remain unchanged; only status/current pointers move.
If any current charge has a submitted/approved payment or paid/pending status,
publication fails `PAYMENT_ADJUSTMENT_REQUIRED`. The adjustment workflow belongs to
Task 6. Attendance edits alone never change a published amount. Identical UUID
retries return the original result; changed payload reuse fails. Different concurrent
publish requests from one reviewed state cannot create a second version.

Verification on 30 October: **115 unit/database, 49 real integration, 30 fixture UI,
8 live desktop/mobile journeys**, plus typecheck, frozen Edge typecheck, lint,
build, schema lint, generated-type freshness and official type comparison. The
fresh isolated `bjbc_task5_clean` stack applied 001–007 with 16 public tables,
all public tables and the new private snapshot table protected by RLS, zero Auth
users/receipt objects/snapshots and one minute scheduler job. It was removed only
after confirming it empty. The pre-existing operator-only `identity_events` table
has no RLS, but no client grants; this is unchanged. Development data was not reset.
