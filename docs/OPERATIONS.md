# BJBC setup and operations

## Phase and language

Task 1 only. Owner approved the specification and D01–D16 on 20 October 2026 and changed all user-facing website copy to English. R14's English label is **Fee not yet set**. The root development pack remains the untouched original; docs/BJBC_Codex_Development_Pack_v1.md is the working specification.

No remote project, paid subscription, SMS account, notification delivery or deployment has been created. GitHub and Cloudflare access are not required to preview Task 1 locally.

**Current status, later on 21 October 2026:** Task 1 is verified against the real local Auth/PostgREST services and the actual website. The owner installed WSL 3.0.3 and Docker Desktop (CLI 29.9.1); the agent started Docker's Linux engine and the fresh local test stack. The earlier missing-runtime blocker below is historical. No machine software was installed by the agent, and Task 2 has not started.

## Prerequisites and local setup

1. Install Node 22.12+ (tested here with 24.14.1) and Git. Run `npm ci` in the project folder.
2. Install and start Docker Desktop with Linux containers (or a compatible Docker runtime). The Supabase CLI is included as a pinned development dependency. Installing Docker is a machine-level action left to the owner.
3. Run `npm run db:start`. The first run downloads local Supabase containers and initializes a new database with the existing migrations. Run `npm run db:reset` **only after verifying a disposable local database** as described below; this command deletes local database data and is not an automatic setup step.
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

The normal `npm run db:start` starts the configured full local stack. Storage/buckets and their permissions remain Task 2 work. Do not describe an excluded service as verified by this run.

Credentials from `supabase status --output json` were captured privately into ignored `.env.local` and `.env.test.local` files; values were not printed or committed. Preserve existing environment files when resuming. All synthetic accounts and bootstrap audit fixtures were removed after tests; the final counts for profiles, Auth users and bootstrap events were all zero. **No real first admin has been configured.**

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
- `assert_active_membership()` raises `MEMBERSHIP_NOT_ACTIVE` unless the caller has active membership. Task 3 participation RPCs must call this guard; there is no session/join endpoint yet.
- `update_my_display_name(display_name_input)` validates the name and active membership, derives identity from `auth.uid()` and changes only the caller's display name.
- Auth credential phone changes are blocked at the database so the Auth API cannot diverge from profiles. Audited administrator phone verification/change is not implemented yet; do not disable this guard as a workaround.
- Admin bootstrap events are retained separately for later integration with the full audit system. Future financial data must not use destructive cascade deletion.

Run `npm run db:types` after migration changes. This generates `src/types/database.ts` by introspecting the public schema in a real PGlite PostgreSQL database after applying the ordered migrations. `node scripts/generate-db-types.mjs --check` detects stale output. Only the Auth-owned schema is represented by a fixture. Supported type mappings deliberately fail on unfamiliar types; extend the generator when adding new schema types.

With the real local stack running, run `npm run db:types:verify`. It captures official `supabase gen types typescript --local --schema public` output into ignored `.superpowers/` files and uses TypeScript to compare table/function names, Row/Insert/Update/Relationships and RPC Args/Returns. **All 13 Task 1 contracts matched on 21 October 2026.** Official output also includes helper exports and `ComputedFields: never` metadata; these do not change the checked contracts. The existing generated types were retained because they matched. Extend comparison coverage when later phases add schema objects.

## Tests and their boundaries

- `npm test`: domain phone/name/password validation and PostgreSQL identity/RLS/function tests. PGlite executes the actual migration, SQL roles, constraints, RLS and PL/pgSQL; its minimal Auth schema fixture does not run GoTrue or PostgREST.
- `npm run test:e2e`: real React application, router and Supabase browser client at desktop and phone sizes. Playwright intercepts only the local Supabase HTTP boundary with synthetic fixtures. Tests cover canonical registration payload, pending-route denial, active profile, nickname save, suspension, login errors, expired server session, logout, nested-route refresh, viewport fit and keyboard focus. They do not prove real Supabase Auth works.
- `npm run test:integration`: **11 actual local Supabase Auth/PostgREST checks**. The runner loads ignored `.env.test.local`, refuses non-loopback backends and exits nonzero when configuration or Auth is unavailable. It requires Docker access for trusted local SQL bootstrap/hook fixtures. No skipped backend test is counted as a pass.
- `npm run test:e2e:live`: **two real website journeys**, one desktop and one mobile, without HTTP interception. They cover registration, pending-route denial, operator fixture approval, phone/password login, profile save and logout. Backend credentials stay in the Node test process. Screenshots/video/traces are disabled for these live checks.
- `npm run typecheck`, `npm run lint`, `npm run build`: static/build validation.

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
