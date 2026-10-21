# BJBC progress

Plan: docs/BJBC_Codex_Development_Pack_v1.md, Task 1 only.

## Authorization
- 20 October 2026: owner approved specification, D01–D16 and Task 1. All user-facing content must be English. R01–R18 otherwise unchanged.
- Native sequential execution; no parallel agents. No paid subscriptions, external notifications, remote project creation or deployment authorized.

## Task 1 — verified against real local Supabase (21 October 2026)
- Baseline: original development pack only; no Git repository, app, AGENTS.md or tests.
- Initial tooling on 20 October: Node 24.14.1, npm 11.11.0, Git 2.45.2. Docker/backend were unavailable then; this was resolved on 21 October as recorded below.
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

### Original follow-up checklist (superseded by the latest continuation below)
1. Owner installs/starts Docker Desktop with Linux containers (or a compatible runtime).
2. Run `npm run db:start`, apply migrations to a disposable local stack with `npm run db:reset`, then privately configure the public browser URL/key in `.env.local` and local test URL/public/backend keys in `.env.test.local`.
3. Run `node --env-file=.env.test.local scripts/run-integration.mjs` to verify actual SMS-disabled signup/login, permissions and the Auth phone-change guard. Verify first-admin bootstrap using a synthetic account; obtain the intended real admin phone privately when pilot setup begins.
4. Compare generated types with official local Supabase output. Record evidence here before marking Task 1 fully complete.
5. Next planned phase is Task 2 (core database security and private storage), after Task 1's remaining verification and owner authorization. No paid services, real notifications or public deployment were performed.

## Later phases
Tasks 2–8 are not started or authorized in this turn.

## Earlier blocked verification attempt — 21 October 2026, Asia/Kuala_Lumpur

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

## Task 1 real-backend verification complete — later on 21 October 2026

### Runtime and data safety
- Owner installed WSL **3.0.3.0** (default WSL 2) and Docker Desktop, CLI **29.9.1**. Git was clean at `a2eb76a`; no new AGENTS.md appeared. The agent started the installed Docker Desktop application; the engine reports **linux**.
- Both container and volume inventories were empty before startup. The Task 1 core stack initialized fresh, applied migration **001**, and showed **0 profiles / 0 Auth users** before any tests. **No db:reset was run.**
- Running services: PostgreSQL, GoTrue **v2.197.0**, PostgREST **v16.4**, Kong and postgres-meta. Later-phase services including Storage and Studio were excluded from this verification. No Task 2 schema/storage work was started.
- Local public/backend credentials were captured into ignored `.env.local` and `.env.test.local` without printing values. `git check-ignore` confirms both files are excluded. No hosted account, paid subscription, deployment or external notification was created.

### Real test results and corrections
- Initial real integration run: **4 passed / 1 failed**. Root cause was an invalid Malaysian synthetic fixture (`0110…`), rejected by the maintained phone parser. Fixed only the test number generator to use a valid-format `0112…` range and validate fixtures before signup. No production phone rule was relaxed.
- Expanded run: **10 passed / 1 failed**. Root cause was the test assuming the real `postgres` operator could `SET ROLE supabase_auth_admin`; PostgreSQL denied it. Actual schema/function grant checks both returned true. The corrected test checks real grants and the rejecting pure hook result without granting additional role membership.
- Tightening the SMS assertion exposed another incorrect fixture assumption: the response is not a quota error. A private classification probe confirmed **HTTP 403**, SDK code `unknown`, and an exact match to our SQL hook's rejection message. The final assertion uses the documented custom-hook status/message contract. This proves the actual Auth → SQL rejection path; delivery prevention does not rely on interpreting rate value zero.
- Final `npm run test:integration`: **11 passed** against actual Auth/PostgREST/PostgreSQL. Covers native phone/password signup with SMS disabled, display name/nickname, canonical duplicate rejection, forged admin metadata/direct escalation, pending own-record limits, suspension, approved login/logout, session refresh/revoked refresh token, credential phone guards, SMS API rejection and synthetic first-admin bootstrap/audit/retry denial.
- JWT expiry evidence: a validly signed local JWT control succeeds at the real PostgREST endpoint; the same identity with expired `exp` is rejected with **401 / PGRST303**. The configured 3600-second token lifetime was not shortened, and no hour-long wait is claimed. This is a real server check, distinct from browser HTTP fixtures.
- `npm run test:e2e:live`: **2 passed**, desktop and mobile, **without route interception**. Real website registration → pending denial → operator fixture approval → phone/password login → profile save → logout → protected-route denial all succeeded.
- Official CLI generated public types from the actual database. `npm run db:types:verify`: **13 contracts matched**, including both tables' Row/Insert/Update/Relationships and all public RPC Args/Returns. Existing types remain valid; official helper exports/ComputedFields metadata are non-contract differences.
- Cleanup queries after live tests: **profiles=0, auth_users=0, bootstrap_events=0**. No real admin remains from the synthetic bootstrap.

### Supporting checks and scope
- `npm test`: **35 passed** (18 domain/configuration + 17 PGlite PostgreSQL cases), kept separate from the 11 real integration results.
- `npm run typecheck`, `npm run lint`, `npm run build`: **passed**. Offline migration-type freshness check: **passed**.
- Original `npm run test:e2e`: **16 passed** with explicit HTTP fixtures, kept separate from the 2 live browser results. The default Playwright config selects only the fixture file; the live config explicitly requires local credentials.
- Added reproducible official type verification, live browser config/test, private env-file loading and trusted local SQL test helpers. Application UI, business rules, Auth settings, migration contents and generated database types were preserved.
- Self-review only, honoring the owner's no-agent instruction. The live suite exercises the actual provider/database privilege differences that the earlier PGlite fixture could not model.

### Status and remaining limits
- **Task 1 is fully verified for the local foundation scope.** This does not certify a hosted pilot or later sessions/billing/storage/guest features.
- Owner-specific first-admin identity/bootstrap has not been performed; only synthetic identities were used and removed. No credentials need to be supplied through chat.
- Actual Auth → SQL hook rejection is verified as HTTP 403 with the hook's exact message, alongside real grant checks. No external SMS provider integration or successful delivery is claimed or desired; SMS remains disabled and no OTP UI exists.
- Next planned phase is **Task 2 — database security and private storage**, requiring owner authorization. Task 2 has not started.
