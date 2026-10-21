# BJBC progress

Plan: docs/BJBC_Codex_Development_Pack_v1.md, Task 1 only.

## Authorization
- 20 October 2026: owner approved specification, D01–D16 and Task 1. All user-facing content must be English. R01–R18 otherwise unchanged.
- Native sequential execution; no parallel agents. No paid subscriptions, external notifications, remote project creation or deployment authorized.

## Task 1 — local implementation ready; real Supabase verification pending
- Baseline: original development pack only; no Git repository, app, AGENTS.md or tests.
- Local tooling: Node 24.14.1, npm 11.11.0, Git 2.45.2. Docker and a running Supabase backend are unavailable.
- Ruling: initialize local feature branch in the supplied empty project; preserve original root pack and maintain the approved working copy under docs/. There is no existing branch/work to isolate.
- Ruling: use this durable progress file as the execution ledger, because the supplied plan and Windows environment do not use the skill's Bash task parser.
- Pre-flight: Task 1 identities feed Task 2 policies and Task 3 active-member checks. Implement only identity tables and a reusable database membership guard now; actual session joins remain Task 3.
- Pre-flight: Task 1 recovery screen provides admin-contact guidance; privileged reset capability stays in Task 7.
- Pre-flight: Task 8 admin management consumes memberships; first-admin bootstrap is a trusted database operation, never signup metadata.
- Backend tests will include real PostgreSQL execution via PGlite; these do not substitute for Supabase Auth integration tests.

### Implemented
- Exact agreed React/Vite/TypeScript/Tailwind stack, pinned dependency versions and lockfile; Cloudflare Pages SPA fallback prepared.
- English registration, login, admin-contact recovery guidance, pending/rejected/suspended screens, active-member empty foundation and editable nickname profile.
- Maintained phone parser canonicalizes accepted phone aliases to E.164. Registration requires a name/nickname and password of at least 12 characters; phone/password login uses native Supabase APIs.
- Ordered identity migration, own-record RLS, immutable membership role/status from public clients, transactional pending/member signup trigger, database active-member guard and validated own-name RPC.
- Credential-phone mutation blocked pending a later audited admin operation. Trusted first-admin bootstrap serializes attempts, refuses a second bootstrap and records an audit event.
- Local phone confirmation disabled; no OTP UI. A rejecting PostgreSQL Send SMS hook blocks delivery requests. CLI-compatible local sentinel provider values contain no credentials or real SMS account.
- Generated database types and deterministic schema-introspection/check commands; placeholder env files, README and OPERATIONS guide.
- Public configuration rejects backend keys and non-local HTTP. Vite validates configuration before bundling to prevent accidental backend-key inclusion; no credentials were provided or logged.

### Test evidence — 20 October 2026, Asia/Kuala_Lumpur
- Initial domain run: 14 failures against the normalization/validation stubs, confirming the missing behavior.
- Initial database run: 15 failures because the identity migration was absent. Implemented the migration and reran against PostgreSQL.
- Corrected two test fixtures after evidence: the maintained parser intentionally canonicalizes the `+600…` trunk alias, and profile editing requires an active fixture under D15.
- `npm test`: **35 passed** (18 domain/security configuration + 17 PostgreSQL identity/RLS/hook cases).
- `npm run test:e2e`: **16 passed**, eight journeys each on desktop Chromium and a mobile Chromium viewport. These use explicit synthetic HTTP fixtures, not a running Supabase Auth server.
- Profile-save regression observed RED (confirmation disappeared during account reload), then GREEN after preserving the mounted view during a background refresh.
- Browser route-denial test originally navigated away before login completed; the observed failure was `/login`, showing the request had been interrupted. It now waits for successful pending login before testing a direct member route, and passes on both viewports.
- SMS delivery rejection and unsafe public configuration tests observed RED before their implementations and GREEN afterward.
- `npm run typecheck`: passed. `npm run lint`: passed with no application warnings. `npm run build`: passed; initial JavaScript chunk about 497 kB, phone metadata loaded only when needed. Final build has no chunk-size/config-loader warning.
- `node scripts/generate-db-types.mjs --check`: passed; generated types match ordered migrations.
- Desktop and phone screenshots inspected in two bounded rounds; no horizontal overflow; phone inputs use 16px text and primary actions are at least 48px high. Keyboard skip link and focus tested.
- `npx supabase --version`: 2.121.0. `npx supabase start`: configuration parses without the earlier SMS-disable/deprecation warnings, then **fails** because Docker and Podman are absent. No containers or remote project started.
- `npm run test:integration`: exits **1**, explicitly **NOT RUN**, because a local backend/test credentials are unavailable. Five real Supabase Auth tests are written but are not counted as passing.

### Decisions and review
- Ruling: the original root development pack is preserved; the working docs copy records the approval and English amendment. Cost if wrong: two documents could diverge; README identifies the docs copy as the working authority.
- Ruling: generated types currently use public-schema introspection in PGlite because Docker is unavailable. Cost if wrong: Supabase-specific differences could remain; compare with the official CLI generator when the full backend is available.
- Ruling: local CLI phone support uses nonfunctional provider sentinels plus the supported rejecting SQL SMS hook. This avoids a real provider account. Cost if wrong: Auth startup/signup could still require adjustment; real SMS-disabled signup is explicitly not claimed verified.
- Ruling: direct dependencies use the latest mutually compatible versions checked at setup, including TypeScript 6.0.3 because the current typescript-eslint peer range excludes TypeScript 7. No peer checks were bypassed.
- Final review: self-review against Task 1 and security focus, honoring the owner's sequential/no-agent instruction. No independent reviewer was used. Critical local findings fixed and covered by regression tests; actual provider integration remains a release gate.
- Deferred: production admin approval UI, phone-change workflow, reset capabilities, sessions, receipts and payment-obligation UI remain in their planned later tasks.

### Required setup and next work
1. Owner installs/starts Docker Desktop with Linux containers (or a compatible runtime).
2. Run `npm run db:start`, apply migrations to a disposable local stack with `npm run db:reset`, then privately configure the public browser URL/key in `.env.local` and local test URL/public/backend keys in `.env.test.local`.
3. Run `node --env-file=.env.test.local scripts/run-integration.mjs` to verify actual SMS-disabled signup/login, permissions and the Auth phone-change guard. Verify first-admin bootstrap using a synthetic account; obtain the intended real admin phone privately when pilot setup begins.
4. Compare generated types with official local Supabase output. Record evidence here before marking Task 1 fully complete.
5. Next planned phase is Task 2 (core database security and private storage), after Task 1's remaining verification and owner authorization. No paid services, real notifications or public deployment were performed.

## Later phases
Tasks 2–8 are not started or authorized in this turn.

## Task 1 verification continuation — 21 October 2026, Asia/Kuala_Lumpur

### Scope and repository
- Owner authorized real Supabase Auth verification only; Task 2 remains out of scope. All website copy remains English. Native sequential execution; no agents dispatched.
- Read the complete working development pack, progress and operations documents. No applicable AGENTS.md was found in the project/ancestor locations. Started on `task/01-foundation-auth` with a clean working tree at `0195378`; existing application work was preserved.

### Confirmed environment blocker
- No Docker/Podman executable on PATH; standard Docker Desktop installation paths, Windows installed-app entries and running Docker processes were checked without detecting an installation.
- Both `wsl --version` and `wsl --status` report that Windows Subsystem for Linux is not installed. Host architecture is x64.
- `npx supabase --version`: **2.121.0**.
- `npx supabase start`: **exit 1**, `DockerLifecycleInspectError`, reporting Docker and Podman commands unavailable. No stack or database was started.
- No database could be inspected for disposable contents. **No db:reset, migration application, bootstrap or Auth user creation was attempted.** No ignored browser/test environment files were fabricated: only the existing placeholder examples are present, and no local backend keys have been generated.
- Official Microsoft, Docker and Supabase setup documentation was checked. OPERATIONS.md now includes the exact owner-run WSL/Docker setup, Linux-container readiness checks and a pre-reset data-safety procedure. Machine-level software/Windows features were not installed or changed.

### Fresh verification evidence
- `npm test`: **35 passed** — 18 domain/security configuration cases and 17 PGlite PostgreSQL identity/RLS cases. PGlite uses a fixture for the Auth-owned schema and does not run Supabase Auth/PostgREST.
- `npm run typecheck`: **passed**.
- `npm run lint`: **passed**.
- `npm run build`: **passed**.
- `node scripts/generate-db-types.mjs --check`: **passed** against the existing migration/PGlite generator.
- `npm run test:integration`: **exit 1, NOT RUN**. The runner reports missing local backend/test configuration; the five real Auth cases are not counted as passing.
- Official `npx supabase gen types typescript --local --schema public`: **exit 1**, container backend unavailable. Output was captured privately in memory; no existing generated types were overwritten and **no official type comparison was completed**.
- `npm run test:e2e`: **16 passed** across desktop/mobile Chromium, using the existing explicit HTTP fixtures. This is UI/client regression evidence only, including fixture-based expiry; it does not prove real Auth registration, sessions or delivery behavior.

### Remaining real-backend verification

| Required behavior | Current real-backend evidence |
| --- | --- |
| Name/nickname + phone/password signup, SMS confirmation disabled | Not run — runtime unavailable |
| Canonical phone uniqueness and pending/member defaults | Not run — runtime unavailable |
| Forged admin metadata and direct role escalation denied | Not run — runtime unavailable |
| Pending/suspended membership restrictions | Not run — runtime unavailable |
| Trusted first-admin bootstrap with synthetic data | Not run — runtime unavailable |
| Approved login/logout and server session expiry | Not run — runtime unavailable |
| Unauthorized phone changes and SMS delivery blocked | Not run — runtime unavailable |
| Official generated types compared to checked-in public types | Not run — runtime unavailable |

The existing five-case real Auth suite is a starting point. Dedicated live suspension, trusted-SQL bootstrap, session-expiry and SMS-delivery checks still need to be added/executed when the backend is available; previous PGlite or HTTP-fixture coverage must not be presented as that evidence.

### Status and next action
- **Task 1 is not fully verified.** The blocker is the missing machine runtime, not an approval to change Auth rules or switch hosting.
- Owner action: install WSL and Docker Desktop using the documented steps, select Linux containers and confirm the engine is running. Then resume this same Task 1 verification request; no secrets need to be pasted into chat.
- Documentation-only continuation; no application/API/Auth configuration changes were made. No paid services, deployments or external notifications were performed. Save this verified setup blocker as a local checkpoint; retain the existing application and generated types.
