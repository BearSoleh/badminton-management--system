# BJBC setup and operations

## Phase and language

Task 1 only. Owner approved the specification and D01–D16 on 20 October 2026 and changed all user-facing website copy to English. R14's English label is **Fee not yet set**. The root development pack remains the untouched original; docs/BJBC_Codex_Development_Pack_v1.md is the working specification.

No remote project, paid subscription, SMS account, notification delivery or deployment has been created. GitHub and Cloudflare access are not required to preview Task 1 locally.

## Prerequisites and local setup

1. Install Node 22.12+ (tested here with 24.14.1) and Git. Run `npm ci` in the project folder.
2. Install and start Docker Desktop with Linux containers (or a compatible Docker runtime). The Supabase CLI is included as a pinned development dependency. Installing Docker is a machine-level action left to the owner.
3. Run `npm run db:start`. The first run downloads local Supabase containers. Run `npm run db:reset` **only on a disposable local database** to apply all migrations from empty; this command deletes local database data.
4. Retrieve the local API URL and publishable key from the Supabase local dashboard or `npx supabase status`. That command may display backend credentials: run it privately, do not paste its output into chat or logs.
5. Copy `.env.example` to `.env.local`. Set only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the local values. Restart Vite after changing them. These are public browser configuration, not secrets.
6. Run `npm run dev`; visit the printed loopback URL. Register using a synthetic name, phone and a password of at least 12 characters. Passwords are submitted directly to Supabase Auth and are never saved in profile tables or application logs.

Vite uses port 5173; local Supabase uses 54321 (API), 54322 (database) and 54323 (Studio). No account credentials are needed for local PostgreSQL/unit/browser verification.

## Phone/password Auth, without SMS

Official provider material was checked on 20 October 2026:

- [Password authentication](https://supabase.com/docs/guides/auth/passwords): native phone/password signup and login.
- [CLI configuration](https://supabase.com/docs/guides/local-development/cli/config): phone signup and confirmation flags.
- [CLI source validation](https://github.com/supabase/cli/blob/develop/apps/cli-go/pkg/config/config.go): the local CLI disables phone signup if no provider is configured, even when confirmation is disabled.
- [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks) and [Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook): database hook transport, selective grants and error responses.
- [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): backend record access.
- [Tailwind/Vite integration](https://tailwindcss.com/docs/installation/using-vite), [Vite](https://vite.dev/guide/) and [Cloudflare React deployment](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/).

The checked-in local configuration enables phone signup and disables phone confirmation. Email signup and anonymous Auth signup are disabled. Password minimum is 12; refresh token rotation is enabled; sign-in/signup requests have a configured rate limit. Do not enable SMS MFA or an OTP UI.

**Local CLI compatibility:** `auth.sms.twilio` contains clearly labeled nonfunctional local sentinel values, not credentials and not a Twilio account. They keep the CLI from disabling phone login. A PostgreSQL Send SMS hook, `app_private.reject_sms_delivery`, rejects every delivery attempt with HTTP 403; it neither sends messages nor records the supplied phone/OTP. Its grants are restricted to `supabase_auth_admin`. The local SMS sending quota is also zero. No SMS provider subscription is needed. CLI parsing was checked, but the actual Auth/container behavior must still be verified after Docker is installed.

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

Run `npm run db:types` after migration changes. This generates `src/types/database.ts` by introspecting the public schema in a real PGlite PostgreSQL database after applying the ordered migrations. `node scripts/generate-db-types.mjs --check` detects stale output. Only the Auth-owned schema is represented by a fixture. Supported type mappings deliberately fail on unfamiliar types; extend the generator when adding new schema types. When Docker is available, also compare with `npx supabase gen types typescript --local --schema public` and review any provider-specific differences before using the pilot.

## Tests and their boundaries

- `npm test`: domain phone/name/password validation and PostgreSQL identity/RLS/function tests. PGlite executes the actual migration, SQL roles, constraints, RLS and PL/pgSQL; its minimal Auth schema fixture does not run GoTrue or PostgREST.
- `npm run test:e2e`: real React application, router and Supabase browser client at desktop and phone sizes. Playwright intercepts only the local Supabase HTTP boundary with synthetic fixtures. Tests cover canonical registration payload, pending-route denial, active profile, nickname save, suspension, login errors, expired server session, logout, nested-route refresh, viewport fit and keyboard focus. They do not prove real Supabase Auth works.
- `npm run test:integration`: actual local Supabase Auth/PostgREST tests. The runner refuses non-loopback backends and exits nonzero when configuration or Auth is unavailable. No skipped backend test is counted as a pass.
- `npm run typecheck`, `npm run lint`, `npm run build`: static/build validation.

For real integration tests, put the three variables from `.env.test.example` into a private `.env.test.local` file. Use local publishable and backend secret keys, never pilot/production keys. Node loads the file without printing values:

```powershell
node --env-file=.env.test.local scripts/run-integration.mjs
```

Tests use synthetic phone identities and delete their own Auth users afterward. Use a disposable local stack only. They test SMS-disabled signup returning a session, pending/member defaults, duplicate canonical identities, direct role escalation, approved phone/password login, logout and blocked phone mutation. They remain unverified until the real backend runs.

## Recovery and secrets

The public recovery page currently directs members to their existing club admin and explains that passwords must never be shared. It does not issue resets. Audited, short-lived, single-use recovery capabilities and session revocation verification belong to Task 7.

Never put backend secret keys, service-role JWTs, database passwords, reset tokens or receipt capabilities into `VITE_` variables, source control or logs. `.env` variants are ignored; committed examples contain placeholders only. The browser client refuses obvious backend keys. Supabase member session tokens are persisted by the supported browser client, so future work must preserve XSS protections. Guest capabilities require their separate, documented transport in Task 7.

For a real pilot, assign trusted owners for admin recovery and secret rotation. Rotate compromised credentials through provider secret settings, update backend-only consumers, revoke affected sessions where supported and verify recovery using synthetic data. There is no automated rotation or recovery service in Task 1.

## Deployment and later operations

No deployment has been performed or authorized. Cloudflare Pages will build with `npm run build`, output `dist`; `public/_redirects` prepares SPA nested-route fallback. Verify the actual Pages behavior when deployment is separately authorized. Do not substitute Sites hosting or Workers for the agreed Pages stack.

Before real sessions/payments, later phases must document and exercise database plus private receipt backups, restore mapping, scheduler monitoring, recovery ownership/cadence and quotas. A database export alone is not a receipt backup. These operations are not claimed implemented in Task 1.
