# BJBC progress

Plan: docs/BJBC_Codex_Development_Pack_v1.md; Tasks 1–8 authorized, including a private/test deployment when account access is available. Dated evidence below records verification and remaining phase limits.

## Authorization
- 1 November 2026, checkpoint approval: owner approved the Task 7 review/local commit and proceeding with Task 8, including preparation for a private/test deployment on the specified stack when account access is available. Public launch and WhatsApp remain separate actions. Continue sequentially without subagents; preserve private env files and existing data.
- 1 November 2026: owner authorized Task 7 only in this chat, continuing from Task 6 checkpoint `6d88194` in the existing branch/workspace, sequentially without subagents. Leave Task 7 uncommitted. No Task 8, push, deployment, real identities, database reset or private-env overwrite.
- 31 October 2026: owner authorized a local Task 5 checkpoint commit and Task 6 development in a new chat. Preserve sequential execution without subagents; no push, deployment, database reset or private-env overwrite. Tasks 7–8 remain unauthorized. Task 6 implementation is handed to the new chat after the checkpoint.
- 30 October 2026: owner authorized Task 5 only, sequentially in this chat without agents. No reset, private-env overwrite, commit, push, publication or deployment. Tasks 6–8 remain unauthorized.
- 23 October 2026: owner authorized Task 4 after completed Task 3. Task 5 onward remains unauthorized.
- 22 October 2026: owner authorized Task 3 only. Task 4 onward remains unauthorized.
- 21 October 2026: owner authorized Task 2. Task 3 onward remains unauthorized.
- 20 October 2026: owner approved specification, D01–D16 and Task 1. All user-facing content must be English. R01–R18 otherwise unchanged.
- Native sequential execution; no parallel agents. No paid subscriptions or external notifications. The latest checkpoint approval authorizes Task 8 private/test deployment; public launch remains separate.

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
At the Task 1 checkpoint, Tasks 2–8 were not started or authorized. The subsequent
Task 2 authorization and results are recorded at the end of this document.

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

## Task 2 — database security/private storage verified locally, 21 October 2026

### Scope, plan and data preservation
- Owner explicitly authorized Task 2 after the Task 1 demonstration. Task 3 remains unauthorized. English website copy, agreed stack, sequential execution and all approved business rules are unchanged.
- Read the full working spec, operations/progress documents and repository state. No applicable AGENTS.md found in workspace/ancestors. Started clean at `5928838`; created local branch `codex/task-02-database-security`. No agents used.
- Implementation plan: `docs/plans/2026-10-21-task-2.md`. This progress file remains the durable ledger under the existing Windows workflow.
- Pre-flight: Task 1 identities feed RLS; Tasks 3–6 consume the core schema but their privileged mutations/UI remain deferred. Task 7 owns guest capability exchange, and Task 8 owns admin management UI.
- Ruling: use a narrow database-authorized roster RPC instead of a database view — it exposes only the five safe fields while checking membership/session visibility, without granting reads of other profiles. Cost if wrong: Task 3 must consume this RPC rather than query a view; its typed contract is documented.
- Ruling: guest credentials fail closed in Task 2; test forged/anonymous guest contexts now and implement positive scoped guest access in Task 7 — no approved guest transport exists yet. Cost if wrong: guests cannot use this foundation until Task 7; the pilot is not complete.
- Ruling: fixed-lifetime receipt URLs are issued only by an Edge Function; direct client Storage SELECT/signing is denied — otherwise clients could request long-lived links themselves. Cost if wrong: viewing requires the function runtime and explicit public-origin configuration; these are tested/documented.
- Verified Linux Docker engine and existing local migration `001`, with zero Auth users. Applied `002`/`003` using `supabase migration up --local`; **no development database reset**. To enable previously excluded Storage/Edge services, stopped/restarted the stack with its backup retained.

### Implemented foundation
- `002_core_tables.sql`: all 14 remaining public blueprint tables plus backend-only guest/recovery hashes and outbox. UUID/FK identity constraints, checked states, nonnegative integer sen, exact 15-minute offers, unique pending offers/current charges/open payments, same-session fee/participant FKs and restrictive financial/history deletes. Operational and billing statuses remain separate. No cost-splitting formula.
- `003_permissions.sql`: all 16 public tables have RLS, with explicit grants. Own/member/admin reads use current database membership, not user-controlled JWT metadata. No direct authenticated domain writes, including admin JWTs. Service can append/read audit records, not edit/delete/truncate them. Private token/outbox tables have no client access.
- Safe `get_session_roster` returns session ID, participant ID, display name, participation status and attendance only. Published sessions visible to active members; drafts remain admin-only. Suspended members retain own charges/payments and supporting fee versions without session/join privileges.
- Private `receipts` bucket: JPEG/PNG/PDF, 5 MiB. Insert-only uploads bind the authenticated owner, charge and immutable object path; current own unpaid obligation and no open/approved payment required. Overwrite, copy and deletion by clients cannot replace receipt history.
- `authorize_receipt_view` validates current identity/charge scope plus the existing Storage object owner. `receipt-view` verifies the bearer with platform JWT verification **enabled** and Auth `getUser`, authorizes as the caller, then signs with a server-only client for exactly **60 seconds**, download-only. No client-provided TTL/Host controls the link. Responses are `no-store`; no paths, credentials, tokens or URLs are application-logged.
- Deno dependency lockfile and strict frozen Edge typecheck; local function config example, migration/function scripts and setup instructions. Browser source/environment remains public configuration only.
- Expanded the offline type generator for composite FKs, actual unique-FK cardinality and non-null JSON, and the official verifier to enumerate every public table/RPC automatically.

### Observed test cycles and fixes
- Before implementation, PostgreSQL suite failed because `public.charges` did not exist; live suite failed with **PGRST205** against Task 1. The 16/13 dependent cases were not counted as passing in those RED runs.
- Initial PostgreSQL matrix then passed 16 cases. Additional suspended-fee-version assertion reproduced a real policy correlation bug (15 passed/1 failed): unqualified `id` resolved inside the subquery. Qualified `fee_versions.id`, observed GREEN, and applied the same correction to the local in-progress migration. Fresh-stack verification uses the corrected migration source.
- First full Storage/API run: 11 passed/2 failed due to the attack test filtering memberships on nonexistent `id` (42703). Corrected it to `user_id`; real write denial is now asserted as **42501**, without weakening any policy.
- Official generator comparison found six JSON Row/Insert/Update mismatches; its current contract uses `NonNullable<Json>`. Updated introspection mapping; all 71 contracts now match.
- A filtered receipt-history test initially failed because a previous upload test had been skipped. Added an explicit own-object fixture helper; the selected tests then passed independently. Core API seeding/cleanup is transactional and only cleans committed fixtures/own synthetic users.

### Final evidence (commands actually run)
- `npm test`: **52 passed** — 18 domain/configuration and 34 PostgreSQL identity/core security cases. PGlite runs real SQL/RLS with fixtures for provider-owned Auth/Storage schemas; it is distinct from the live tests.
- `npm run test:integration`: **26 passed** — 11 existing real Auth checks and **15 Task 2 PostgREST/Storage/Edge checks**. Public, pending, active A/B, suspended, forged guest and active/suspended admin contexts; safe roster/draft privacy; own obligations; direct role/phone/payment/receipt-path denial; backend-only tables; private bucket limits; unauthorized uploads/signing; history protection; invalid bearer/request handling; fixed-origin 60-second signed downloads; current membership denial.
- Actual signed-link expiry: fetched a genuine signed PDF successfully, allowed the full server-issued 60-second lifetime to elapse asynchronously, then the real Storage server rejected the URL. This is neither an HTTP fixture nor a forged-expiry token test. Caller-supplied 86400-second expiry did not change the 60-second contract.
- `npm run test:e2e`: **16 passed** with explicit HTTP fixtures on desktop/mobile, kept separate from backend verification.
- `npm run test:e2e:live`: **2 passed** on the real website/backend, without interception. Task 1 registration/pending guard/operator approval/phone login/profile/logout still work.
- `npm run typecheck`, `npm run typecheck:edge`, `npm run lint`, `npm run build`: **passed**. Frozen Deno check uses pinned 2.9.6 through npm's cache, without machine installation. Only existing benign Playwright color-environment warnings appeared.
- Offline generated-type freshness: **passed**. `npm run db:types:verify`: **71 contracts match** actual official CLI output (16 tables' four shapes, table/function name sets and five RPC contracts).
- `supabase db lint --local --level warning`: **no schema errors**. Trusted SQL confirms authenticated cannot CREATE in public; service cannot UPDATE or TRUNCATE audit logs.
- **Real migration from empty**: created an isolated fresh Supabase stack `bjbc_task2_clean` on separate ports. CLI applied **001, 002, 003**; confirmed **16 public tables, zero missing RLS, private receipts bucket/5,242,880-byte limit**. It had **zero Auth users, profiles and receipt objects** before disposing only that verification stack/its volumes. The primary BJBC stack was preserved.
- Auth service was restarted between large local batches to clear development IP rate counters; configured security/rate settings were not relaxed.
- Final review: self-review against Task 2/privacy focus, honoring native/no-agent execution. No independent reviewer or deployment performed.
- Final cleanup queries: **profiles=0, Auth users=0, sessions=0, charges=0, receipt objects=0, bootstrap events=0**. Private browser/test/function environment files are Git-ignored. The primary stack and receipt function remain running locally; preview is restored after browser checks.

### Completion and remaining limits
- **Task 2 is complete and verified for its local foundation scope.** A local checkpoint commit records this phase. No public/hosted pilot, paid service or external notification was created.
- The visible website still has Task 1's member foundation. Session/vote/join and concurrent allocation are Task 3; timed offer processing Task 4; fee calculations/publication Task 5; full payment submission/receipt-content checks/admin verification Task 6; positive scoped guest access/usage limits and recovery Task 7; admin completion Task 8.
- Already-issued receipt URLs remain bearer capabilities until their 60-second expiry; membership changes deny new links but cannot revoke a current URL instantly. No immediate revocation claim.
- No real first admin or club data is configured. Tests use and remove synthetic identities/files; secrets remain in ignored local files. Hosted Auth/Storage/Edge deployment and backup/restore remain separately authorized later work.
- Next task is **Task 3 — sessions, voting and participation**, only after owner authorization.

## Task 3 — sessions/voting/participation verified locally, 22 October 2026

### Authorization and preservation
- Owner authorized Task 3, native sequential execution only. Task 4 onward remains unauthorized. Read the working pack, operations/progress, existing code and design context; no applicable AGENTS.md found. Started clean at `3a462be` and created `codex/task-03-sessions-participation`. No agents, deployment, paid services or external notifications.
- Plan: `docs/plans/2026-10-22-task-3.md`. Specification/D01–D16 remain approved. **Play / Not playing** is the English translation of the approved participation choices, with unchanged rules.
- Existing Docker Linux stack showed migrations 001–003, zero users/sessions. Applied additive 004 with `db:migrate`; no development database reset. Existing private environment files were preserved.
- Impeccable context launcher could not initialize its external cache; used the documented fallback to read PRODUCT.md, DESIGN.md and existing visuals directly. Inherited the established green/off-white Manrope system; no redesign or extra approval round.

### Implemented and integration boundaries
- `004_participation.sql`: active-member guard plus membership row lock, session-row locking, actor-scoped request ledger, audited session create/edit/publish and vote/join/withdraw. Six typed public RPCs; all helpers use safe explicit search paths.
- Repeated actor/request/payload returns the original result; conflicting payload reuse fails. Request reservation, mutation and audit are one transaction. Own player identity derives from Auth, never browser IDs/phones. Server clock is sampled after the session lock is acquired.
- First capacity-limited Play votes confirm, overflow waits. Confirmed players and unexpired held offers consume places. Existing waiting/offered players prevent direct/rejoin queue bypass. Repeat Play keeps priority; explicit rejoin receives a new server timestamp. Audit metadata retains the previous state/timestamps. Admins can participate as ordinary members.
- Vote changes to Not playing use withdrawal rules. Confirmed same-KL-day withdrawal records 75%; before that calendar day 0%; waiting/declined/expired offers create no new liability. No member self-withdraw/join at or after start, or into completed/cancelled sessions.
- Ruling: retain a separate `liability_percent` floor on participation — a previous late-cancellation obligation must survive a later waitlist rejoin/decline. Cost if wrong: Task 5 must explicitly use this floor with current eligibility and session cancellation; it is not a billing engine by itself.
- Ruling: edit scheduling/capacity only while draft in Task 3 — silently moving a published session would alter priority/cancellation terms. Cost if wrong: later rescheduling needs an audited workflow; published details cannot currently be edited.
- Ruling: leave vacancies behind existing queues unallocated until Task 4 implements consent-based offers — no direct confirmation shortcut. Cost if wrong: automatic promotions are unavailable between these development phases; the pilot remains incomplete.
- `/app` now lists upcoming/history sessions; detail has KL times, safe roster/counts, authoritative own actions, vote/join/rejoin, explicit withdrawal confirmation and **Fee not yet set**. Confirmation explains processing-time calendar rules and the later manual amount. Admin routes create/edit drafts and publish one poll. No invented sessions/stats, fee formula or payment action.
- UI protects unchanged retries with the same request UUID and blocks duplicate submits until authoritative reload finishes. Error messages omit raw backend diagnostics. Drafts/admin routes are hidden from member UI and enforced at the backend. API failures and failed lazy-route code downloads have recoverable English screens.
- Sessions/editor load on demand with React lazy/Suspense. An initial 517 kB main-chunk warning was resolved through real route splitting; final main chunk is about 498 kB, with separate session/editor chunks, without raising warning thresholds.

### RED → GREEN observations and security fix
- Before implementation: PostgreSQL suite failed its missing-vote-RPC contract (14 dependent cases skipped, not passed); actual Task 2 backend returned PGRST202 for the new snapshot (nine live cases not run). Implemented 004; first 14 SQL cases and all nine real transaction cases passed.
- Three KL input/display tests failed against explicit stubs, then passed after fixed-timezone conversion/validation. Invalid calendar dates are rejected and device timezone does not choose session time.
- Browser journey initially failed waiting for the absent **Manage sessions** control. After implementation, real desktop and mobile draft/edit/publish → vote/withdraw/post-voting join succeeded. A no-participant Not playing vote now shows its actual state.
- Final permission review added an admin/private-helper regression. It failed: an authenticated SQL actor could execute `begin_operation`; actual provider ACL check also returned true. Root cause confirmed in current PostgreSQL docs: schema-scoped default REVOKE cannot remove globally inherited PUBLIC EXECUTE. This was not a public PostgREST route (app_private stayed unexposed), but owner-only helper grants were still required.
- Fixed 004 with explicit private-schema function ACL revocation and a seven-function allowlist for caller-scoped RLS predicates; preserved the SMS hook's explicit auth-admin grant. Observed regression GREEN, actual authenticated/service helper privileges false, and all prior identity/privacy/receipt tests still passing. Applied the in-progress ACL correction locally and repeated clean-stack verification from the corrected source.
- Fault-injection browser test reproduced a blank screen when the new session module download failed. Added a route error boundary with Reload page; test then passed at both viewport sizes. Expected React development error output is part of that deliberate test, not an unreported runtime failure.
- React purity/effect lint findings were corrected with state-based display time and asynchronous resource callbacks, without disabling rules. Loading responses use generation checks; mutations await the latest authoritative snapshot.

### Final evidence (actually run)
- `npm test`: **70 passed** — 21 domain/config/time and 49 PostgreSQL identity/core/participation cases. PGlite provider schemas are fixtures; these results do not claim multi-connection concurrency.
- `npm run test:integration`: **35 passed** on actual local services — 11 Auth, 15 permissions/Storage/Edge, **9 Task 3 transaction/concurrency cases**. Includes timestamp allocation, retries/conflicts, queue preservation, role/foreign-record/forged-argument denial, safe snapshot, KL boundary and post-start denial.
- Actual contention evidence: held the session row from an independent PostgreSQL connection, dispatched two simultaneous HTTP votes/joins, observed both API transactions blocked on database locks, released the hold, then obtained exactly **one confirmed / one waiting** for capacity 1. Tested both during voting and post-voting. Concurrent same-request retries produced one participant/original result.
- Time-after-lock evidence: queued an HTTP vote before its closing time while holding the session lock, released after close, received **VOTING_CLOSED** and observed zero participants. This proves server decision time is sampled after waiting, rather than trusting request/transaction start.
- Fixed-date actual PostgreSQL and PGlite cases: Thursday **2026-10-22 23:59:59 KL → 0%**, Friday **2026-10-23 00:00:00 KL → 75%** for a Friday session, not a 24-hour cutoff. Actual withdrawal RPC records its server-day rate; forged time/identity parameters are rejected.
- `npm run test:e2e`: **22 passed**, desktop/mobile explicit fixtures. `npm run test:e2e:live`: **4 passed** on actual website/backend, no route interception (Auth and full session journey on both viewport classes). Real session screenshots contain only labeled synthetic post-login data and remain ignored.
- Desktop/mobile home/detail screenshots inspected together; no horizontal overflow, correct phone stacking and no private roster fields. Existing keyboard-focus/skip link, deep-link refresh, history, confirmation, error retry and request UUID reuse checks passed.
- `npm run typecheck`, `npm run typecheck:edge`, `npm run lint`, `npm run build`: **passed**. Offline generated-type freshness passed; **77 contracts** match official local Supabase generation. SQL linter reports **no schema errors**. Existing benign color-environment warnings and expected fault-injection React diagnostics are distinguished from failures.
- Fresh real Supabase stack `bjbc_task3_clean` on separate ports applied **001–004**, had 16 public tables/all RLS enabled, the new RPC and denied helper execution. Repeated after the ACL fix. Verified **zero users/profiles/receipt objects** before removing only that disposable check stack/volumes. The development database was preserved.
- Local Auth restarted between large synthetic batches to clear IP rate counters; no Auth/rate setting was relaxed. No SMS/WhatsApp delivery or hosted deployment performed.
- Final review: self-review, honoring the owner's no-agent instruction. Explicit ACL and route-failure findings fixed with RED→GREEN regressions; no independent reviewer used.

### Status and limits
- **Task 3 is complete and locally verified.** Save this phase as a local checkpoint. The website now has real sessions/participation rather than the Task 1 placeholder.
- Task 4 remains next: 15-minute offers, expiry/promotion worker and in-app notifications. Task 3 creates no automatic offers and cannot accept a held offer via Play. Existing queues intentionally hold vacancies until that phase is implemented.
- Manual fee publication, actual charges/payments/receipts UI, scoped guest access/recovery and remaining admin tools remain Tasks 5–8. No full pilot, owner-specific first admin or hosted environment is claimed ready.
- Published session editing/rescheduling is intentionally unavailable in this phase. Session views update through actions/manual refresh; realtime delivery is not claimed.
- Final cleanup: Auth users, profiles, players, sessions, participants, audit rows, request-ledger rows and receipt objects all **0**. Private env files remain Git-ignored. Local preview restored at `http://127.0.0.1:5173/login`; HTTP **200** confirmed. Main Supabase/receipt runtime retained locally.

## Task 4 — waiting-list offers and in-app notification, 23 October 2026

### Authorization and preservation
- Owner authorized continuing Task 4 after Task 3. Native sequential execution,
  no agents. Started clean at `dd945a8`; local branch
  `codex/task-04-waitlist-notifications`. Approved R01–R18/D01–D16 and English
  website copy remain unchanged. Plan: `docs/plans/2026-10-23-task-4.md`.
- Docker Desktop was stopped. Started the installed runtime; verified local
  migrations 001–004 and **zero users/sessions**. Applied additive 005/006 without
  resetting the development database. Existing private environment files preserved.
- Impeccable launcher could not write its external cache. Used its direct-context
  fallback: PRODUCT.md, DESIGN.md, existing code and the established surface rules.
  UI extends the existing green/off-white Manrope system. No redesign, hosted
  project, paid service, external delivery or deployment.

### Implemented
- `005_waitlist.sql`: locked automatic promotion, exactly 15-minute held offers,
  active-member eligibility, Continue/Decline, manual admin offers, reason/audit
  for priority overrides, mode changes and late confirmations with explicit player
  consent. New offers stop inside 15 minutes of start; all joins/promotions stop
  at start. Cancellation/completion immediately revokes remaining holds.
- Kept Task 3's tested public signatures and actor/request ledger. Renamed core
  implementations into the private schema and added locked reconciliation wrappers.
  A normal withdrawal and a Not playing vote both advance the queue and persist
  deduplicated offer-end events. Private helpers are explicitly owner-only.
- Server response checks time **after** acquiring the session lock. Expired/stopped
  offers cannot confirm even before a worker runs. A stale response commits an
  expired result plus next promotion; throwing an exception after those writes
  would roll expiry back. Other non-pending responses return a safe error.
- Decline/expiry adds no liability. Task 3's accrued liability floor survives later
  offers. Acceptance is confirmed participation and uses the existing KL-day
  withdrawal rules. Guest capabilities/usage reservations remain Task 7; unlinked
  guests are deliberately not automatically offered a slot yet.
- `006_notification_job.sql`: backend-only `expire_waitlist_offers()` and one
  `bjbc-waitlist-minute` pg_cron schedule. Advisory lock deduplicates simultaneous
  workers; session `SKIP LOCKED` permits unrelated work. Each session's changes
  and in-app persistence are atomic. Failures isolate that session, store SQLSTATE
  health and warn admins once per session/hour; the next run retries.
- Notifications and outbox events persist together. `delivered` means **saved in
  the app**, not externally delivered or read. The owner-only scheduler health row
  and Cron history support operator checks. No WhatsApp adapter is active.
- Member home exposes active offers (visible-tab 30-second checks). Session detail
  provides Continue/Decline, a monotonic server-calibrated countdown, exact-expiry
  refresh and refresh on return to the tab. An ended window disables both actions.
  `/app/notifications` has own messages, unread count, explicit Mark as read,
  refresh, safe current-state links and honest closed-site limitations.
- Admin detail shows the ordered queue, eligibility, live holds, automatic/manual
  controls, required reasons and a late-player-consent checkbox. Server RPCs enforce
  every action. Changing mode does not revoke existing holds. UI retries reuse the
  same request UUID; raw backend diagnostics stay out of visible errors.

### RED → GREEN and corrections
- New PostgreSQL suite failed its missing `respond_to_offer` contract against Task 3;
  dependent cases were skipped, not counted as passing. Actual local API returned
  **PGRST202** for the new RPC before migration. Implemented 005/006, then observed
  rule/API tests passing. Own active-offer read contract also failed before its RPC.
- Fixed two test assertions comparing PostgreSQL Date objects to differently
  formatted timestamps; compare instants instead. Updated Task 3 queue assertions
  to count both waiting and held players now that automatic offers exist; priority
  and capacity assertions remain enforced.
- The initial browser command could not complete inside the restricted sandbox;
  stopped its own stale local test server and ran browser processes with approved
  local execution. Do not count that attempt as a product RED observation.
- Countdown fixture initially assumed exactly one initial React fetch. Strict Mode
  performs two, making it show expired before render. Replaced request-count expiry
  with a real elapsed-time boundary; countdown refresh then passed both viewports.
- Review regression: Not playing on an offered place changed state without its
  offer-end notification. Test observed **0 events instead of 1**. Extended the
  private withdrawal helper; both notice and audit now deduplicate, GREEN.
- Full integration first reported **41 passed / 1 failed**: privacy's expected
  single synthetic audit also saw worker-created synthetic rows. Cleanup had matched
  actor IDs but backend jobs have no actor. Confirmed all ten orphan rows were this
  run's waiting→offered/offered→expired events, with zero users/sessions. Removed
  only those verified fixtures and expanded cleanup by owned participant IDs.
  Repeated the entire integration suite: **42 passed**. No RLS/grant was relaxed.
- Batched desktop/mobile inspection covered offer, inbox and admin queue. Corrected
  one-player/message grammar, queue form spacing and offscreen skip-link clipping
  during full-page capture. Final live capture waits for saved admin state.

### Verification evidence
- `npm test`: **88 passed** — 21 domain/config/time + 67 PostgreSQL, including
  **18 Task 4 cases**. Covers fixed 12:14:59 acceptance / exact 12:15:00 rejection,
  15-minute start boundary, manual mode, holds, override/consent, cancellation,
  stale/foreign actors, notification ownership, prior liability and failure retry.
  PGlite does not claim multi-connection or scheduler execution.
- `npm run test:integration`: **42 passed** — 11 Auth, 15 privacy/Storage/Edge,
  9 participation and **7 waitlist API/concurrency/scheduler** cases. Independent
  PostgreSQL lock plus two HTTP Continue calls yields one confirmation. Same-request
  concurrent retries return one result/audit. A pre-expiry HTTP response held behind
  a row lock expires after release. Duplicate workers plus response contention create
  one next offer/event. A real minute Cron run expired/promoted with **no browser or
  client worker call**, and Cron history recorded success.
- `npm run test:e2e`: **26 passed**, desktop/mobile controlled HTTP fixtures,
  including retry UUID, safe API failure, inbox read/current-state link and countdown
  expiry refresh. Existing auth, navigation, keyboard, deep-link and fault-injected
  route-download recovery journeys still pass. Expected React fault-injection output
  and benign color-environment warnings are distinguished from failures.
- Typecheck, pinned/frozen Deno Edge typecheck, lint and production build passed.
  Initial sandbox Deno check could not reach npm; repeated with the existing normal
  cache and approved execution, passed. No package/version/config relaxation.
  Main JavaScript ~498 kB; session/inbox modules remain lazy-loaded.
- Offline generated-type freshness passed; **85 public schema contracts** match
  official local Supabase generation. SQL linter: **no schema errors**.
- Fresh isolated `bjbc_task4_clean` stack applied **001–006** on separate ports:
  **16 public tables, zero missing RLS, zero users/receipt objects**, one active
  minute job, authenticated worker access false and service private-helper access
  false. Verified empty before disposing only this test stack/volumes. Development
  database preserved; no reset.
- `npm run test:e2e:live`: **6 passed**, actual website/Auth/PostgREST with no
  interception: Auth, full session journey and Task 4 manual-offer/inbox/Continue/
  automatic-next/Decline on desktop and mobile. Final visual confirmation passed
  after the one correction batch; screenshots contain only synthetic post-login
  content and remain ignored. Keyboard action focus and viewport fit passed.
- Final cleanup: Auth users, profiles, players, sessions, participants, offers,
  notifications, outbox, audit, request ledger and receipt objects all **0**.
  Scheduler health `failures=0`, recent completion and one active minute job.
  The normal local backend/receipt runtime remains available.

### Limits and next phase
- Local scope only. In-app persistence cannot alert someone with the site closed;
  no external delivery/read claim. Inbox shows the latest 100 messages. Session
  detail refreshes through actions, focus and countdown expiry; realtime delivery
  is not claimed. Worker delay may leave an expired hold visible until the next
  minute, but the backend cannot accept it.
- Full cancellation/financial outcomes, attendance/manual fees, payments, scoped
  guests/recovery and remaining admin tools remain Tasks 5–8. No real first admin,
  owner data, hosted pilot or public deployment is configured.
- Final review is a separate self-review under the owner's no-agent preference;
  no independent reviewer. Next task: **Task 5 — attendance and manual fees**,
  after owner authorization.
- **Task 4 is complete and locally verified.** Save the phase as a local
  checkpoint; retain the feature branch. No shared-branch merge or push is needed.

## Task 5 — implemented and locally verified (30 October 2026)

### Scope and baseline
- Owner authorized Task 5 only, native sequential execution without agents. Read
  Git status, repository/ancestor instructions and the requested five documents.
  Initial worktree was clean at `f6b5169`, branch
  `codex/task-04-waitlist-notifications`; continued in place as requested.
- Plan: `docs/plans/2026-10-30-task-5.md`. Existing English copy, green/Manrope
  design and Tasks 1–4 functionality preserved. Impeccable context launcher could
  not install its engine in the restricted cache; read existing design context
  directly. No packages or private environment values were changed.
- Started the already installed Docker Desktop/local runtime. Applied additive
  migration 007 to the development database; zero users/sessions before tests.
  No database reset, remote service, commit, push or deployment.

### Implemented diff
- `007_billing.sql`: confirmed-only attendance with audited correction reasons;
  manual full-fee/cost drafts; private per-player preview; locked fee publication.
  Current database membership/role, end time, complete attendance review and an
  unchanged server preview token are enforced in PostgreSQL.
- Whole-number sen and bigint half-up rounding. Present/no-show 100%, confirmed
  late withdrawal 75%, other ordinary states 0%. Existing retained withdrawal
  liability survives rejoin. Cancelled preview is zero and publication is denied.
- Atomic immutable fee versions, cost/eligibility snapshots, superseding charge
  chain, audit events and existing actor/request ledger. Same-request retries
  return one result; conflicting payloads and stale reviews fail. Zero snapshots
  have no payable liability and display intentionally as RM 0.00 after publication.
- Cost snapshots live in the private schema with RLS/no client grants; published
  financial fields reject mutation. RLS still restricts foreign charges and allows
  suspended members to read their own existing obligations.
- Admin session navigation opens attendance and fee review. Every confirmed player
  must be marked explicitly; no automatic unmarked-to-no-show conversion. Fee form
  edits invalidate review. All participant amounts are visible before an explicit
  review checkbox/publication action. Member detail preserves Fee not yet set
  until publication, then shows own amount, rate and the exact charge's fee version.
- Unpaid fee corrections require a reason and another version. Submitted/approved
  payment-linked corrections are blocked pending Task 6's adjustment workflow.
  Attendance correction alone cannot rewrite a published charge.
- Added domain, PostgreSQL, real API/concurrency, fixture UI and live browser tests;
  regenerated types. Updated foundation constraint tests to use invalid INSERTs
  because immutable snapshots now correctly reject UPDATE before constraints.

### Test evidence and review
- Initial PostgreSQL contract failed with `installed: false`; 14 dependent cases
  were skipped, not counted as passing. Implemented 007: **14 billing cases pass**.
- Money parser stub: **6 failures**, then **13 cases pass** after implementation.
- New admin UI initially failed because the route was absent, then passed desktop
  and mobile. Initial restricted browser attempt left its own server occupying
  5173; stopped only that test process and reran with local browser execution.
- Broader test run identified tied fixture timestamps (UUID is the deliberate
  tie-breaker) and old tests trying to mutate now-immutable fields. Changed fixture
  assertions to participant IDs and preserved negative/FK/percentage INSERT checks.
- Review found an own-fee HTTP read race: newest fee version could disagree with
  the fetched charge snapshot. Regression observed **RM25.00 vs expected RM20.01**
  on both viewports. Read the charge first, then its immutable version: GREEN.
- Refresh regression also observed **RM20.01 vs expected RM0.00** after a corrected
  publication. Key the fee panel by the session's publication-updated timestamp
  so Refresh session/focus refresh reloads the charge. Both viewport checks pass.
- `npm test`: **115 passed** — 34 domain/config/time/money and 81 PostgreSQL cases.
- `npm run test:integration`: **49 passed** — prior 42 plus seven Task 5 tests.
  Real API/RLS, unmarked/post-session gates, rounding, zero/reasoned corrections,
  immutable eligibility, safe caller contracts, cancelled publication denial,
  suspended own reads, payment-linked correction denial and audit/cost privacy.
  A separately held PostgreSQL row lock plus simultaneous HTTP calls proved same
  request -> one version/audit, and different IDs -> one success/one stale preview.
- `npm run test:e2e`: **30 passed**, controlled HTTP fixtures across desktop/mobile.
  Task 5 verifies review gating, form edits clearing preview, same retry UUID,
  safe API errors, version-race regression and intentional zero. Existing auth,
  participation, offers, keyboard and route-download recovery journeys pass.
- `npm run test:e2e:live`: **8 passed**, actual website/Auth/PostgREST, no interception.
  Includes admin attended/no-show review, manual 20.01 fee/cost notes, 15.01 late
  charge preview, keyboard publication and member private charge on both viewports.
- Typecheck, frozen Deno Edge typecheck, lint and production build passed. Offline
  generated-type freshness and **89 official public contract comparisons** passed.
  Real SQL schema lint reported no errors. Expected browser fault-injection console
  output and benign color-environment warnings are not test failures.
- Fresh isolated `bjbc_task5_clean` applied **001–007**, 16 public tables, no public
  table missing RLS, new private snapshot table RLS/owner-only, private preview
  execute denied, zero users/objects/snapshots and one active scheduler job.
  The old private operator-only `identity_events` RLS exception is unchanged.
  Removed only this verified-empty test stack. Development database preserved.
- Final cleanup verified zero Auth users, profiles, sessions, participants, fee
  versions, charges, private cost snapshots, cost drafts, payments, audit/request
  fixtures, receipt objects and notifications. Original backend remains available;
  one active minute job, no Cron failures. No private environment file changed.
- Desktop/mobile admin and member screenshots inspected in two bounded batches;
  no overflow or clipped actions. Existing typography, focus and phone input size
  preserved. Screenshots contain synthetic post-login content and remain ignored.
- Final review: separate self-review against the approved Task 5 rules and plan;
  no independent reviewer under the owner's no-agent instruction. No remaining
  material findings. Test/fixture fixes and the display race are resolved.

### Limits and stop point
- Local verification only. No real accounts or session records are shipped.
  No live payment submission/receipt verification, cash/refund/cancellation workflow,
  guest access, recovery, remaining admin tools, WhatsApp or deployment was added.
- Post-publication financial cancellation and payment-linked adjustments remain
  Task 6; they are not silently approximated here. Suspended own-obligation API
  access remains tested; a full payments/history UI is still Task 6.
- **Task 5 is complete and locally verified. Stop here.** Tasks 6–8 require separate
  authorization. No commit/push/publication was performed.

## Task 5 checkpoint and Task 6 handoff — 31 October 2026

- Owner approved the local checkpoint commit and continuation of Task 6 in a new
  chat. This supersedes the earlier commit/Task 6 authorization limits above.
- Checkpoint contains the reviewed Task 5 diff and documentation. Fresh pre-commit
  checks: 115 unit/database tests, typecheck, lint, build and diff whitespace check.
  Real integration/UI/live evidence from 30 October remains recorded above; those
  suites are not claimed rerun for this checkpoint-only action.
- Keep the existing local branch/workspace. No merge, push or deployment. The new
  chat must inspect the committed state and approved Task 6 specification before
  implementing receipt workflows, verification, cash/history and audited financial
  correction/cancellation/refund handling. Stop before Tasks 7–8. Further commits
  for Task 6 still need separate owner approval.


## Task 6 — receipts, verification and financial history (31 October–1 November 2026)

Owner authorized Task 6 only in this chat, sequentially without subagents. Started
from clean b5afe8f on codex/task-04-waitlist-notifications. No commit, push, merge,
reset, real owner identity, private environment change or deployment authorized or
performed. The approved R01–R18/D01–D16 and Task 6 govern this work.

### Implemented
- Additive 008_payments.sql extends existing private receipt storage/RLS and the
  60-second receipt-view foundation. Server-only byte/metadata attestations block
  incomplete/unverified direct submission. JPEG/PNG/PDF, exact 5 MiB inclusive,
  extension/type/size/ownership and completion signatures are checked; HTML/SVG
  and directly declared active PDF content are rejected. Download-only receipts.
- Caller-scoped full submission, bank-check approval, reasoned rejection and new
  receipt resubmission. One pending/approved payment per charge. Existing request
  ledger and session-row locks prevent duplicate approvals/cash/retry revenue.
- Immutable received-money fields; reasoned full cash and explicit full refund
  recording. Cancelled sessions void unpaid/pending liabilities, reject unresolved
  submissions, stop polls/offers and flag approved money for manual refund.
  Received records remain approved/history; no automatic money-return claim.
- Reasoned paid-fee adjustment requires explicit full-refund acknowledgement and
  reviewed pending receipts. It creates another fee version and replacement full
  charges while preserving old paid snapshots/payments and manual refund flags.
  Ordinary publication remains blocked at the payment boundary. Financial state
  participates in preview tokens. No partial payments, credit or cost-splitting.
- Member payments/detail/history, suspension-safe own access, admin receipt/bank
  review/cash/refund controls, cancellation confirmation and fee-adjustment review.
  Existing English court-green design retained. Optional private operator-provisioned
  bank QR display only; no settings administration or real bank configuration.

### Verification and review
- Initial PostgreSQL installation check failed (installed false, 13 dependent cases
  skipped); implemented migration made them pass. Added metadata-binding regression:
  14 new database cases. Receipt validator stub failed two valid/boundary cases,
  then all seven format/unsafe-content cases passed.
- Paid-adjustment UI test failed at the missing acknowledgement action, then passed.
  Cancellation review found stale retained-liability/Fee not yet set copy; a failed
  browser regression now passes with No charge and payment/refund history access.
  Early fixture attempts navigated before Auth persistence; fixed the test to wait
  for successful login. No product authorization was weakened.
- Unit/database: 136 passed (41 domain + 95 PostgreSQL).
- Fixture UI: 40 passed across desktop/mobile; includes unchanged UUID/path after
  a failed submit, no duplicate upload, safe errors, rejection history, bank/cash/
  refund gates, paid-fee acknowledgement, suspension and cancelled fee copy.
- Live browser: 10 passed across desktop/mobile, actual Auth/PostgREST/Storage/Edge,
  no interception. Task 6 journey covers upload, download, rejection/resubmission,
  bank approval, cash, fee adjustment, actual refund, post-payment cancellation,
  retained money and suspended own history. Earlier live journeys also pass.
- Real integration: 60 passed on the final standalone run. Covers actual Storage/
  Edge, 5 MiB boundary/unsafe bytes, ownership/suspension, rejection/resubmission,
  bank checks, duplicate approval, opposite reviews, cash versus submission,
  approval versus cancellation, explicit refunds, stale financial previews,
  immutable paid adjustments and private QR. Earlier expanded run passed 59/60
  with an Auth bootstrap failure caused by overlapping a live synthetic admin;
  corrected suite sequencing and the full rerun passed without weakening the test.
- Typecheck, frozen strict Deno check of both Edge entrypoints, lint and production
  build pass. Generated-type freshness and 98 official public type contracts pass.
  PostgreSQL schema lint returns an empty results array (unused local removed).
- Fresh isolated bjbc_task6_clean applied 001–008: 16 public tables, no missing
  public RLS, private receipt checks RLS/client denied, zero users/objects, one
  scheduler job. Removed only that verified-empty disposable stack. Development
  stack preserved. No database reset. Docker/Edge startup needed sandbox approval;
  credential-bearing provider output was suppressed. Design launcher unavailable;
  existing product/design/components guided the implementation.
- Two bounded desktop/mobile screenshot batches inspected; no clipping/overflow.
  Improved section heading weight and mobile refresh-button inset once. Keyboard
  approval/publication and explicit labelled confirmations are exercised.
- Self-review against Task 6; no independent subagent under the owner's instruction.
  Full-refund/replacement strategy is documented in plan and operations. No unresolved
  material implementation findings. File validation is not a general malware scanner.

### Stop point
Task 6 is implemented and locally verified. Tasks 7–8, guest access,
recovery, remaining admin tools, WhatsApp and deployment remain untouched. Keep the
Task 6 diff uncommitted for owner review; no further phase is authorized.

Final cleanup confirmed zero Auth users, profiles/memberships, players, sessions,
participants/polls/votes/offers, fees/charges/payments, cost snapshots/drafts,
receipt objects/checks, audit/identity/request fixtures, notifications/outbox and
club settings. One active scheduler job, zero health/recent Cron failures, and no
public table missing RLS. Development stack and original private env files are
preserved. Final whitespace check passed. No outstanding blocked verification.

## Task 6 checkpoint and Task 7 handoff — 1 November 2026

Owner approved a local Task 6 checkpoint commit and proceeding with Task 7 in a new
chat. This supersedes the earlier Task 6 commit/Task 7 authorization limits above.
Keep the existing local branch/workspace and preserve private environment files.
Task 7 only: guest invitations/private access and payment portal, two-participation
eligibility/reservations, verified linking, and audited admin-assisted recovery.
Continue sequentially without subagents. No Task 8, real identities, deployment,
push or merge. Future Task 7 commits require separate owner approval.
Checkpoint checks and hash are reported by the checkpoint chat; full Task 6
backend/browser evidence remains recorded above.

Fresh checkpoint-only verification on 1 November: 136 unit/database tests,
typecheck, lint, build and whitespace checks passed. Real integration/UI/live and
frozen Edge/schema/type evidence above was not rerun solely for this checkpoint.

## Task 7 — guest access and account recovery (1 November 2026)

### Scope and design

Implemented sequentially without subagents in `codex/task-04-waitlist-notifications`,
starting from clean checkpoint `6d88194`. The Task 7 plan records D08–D10 and the
chosen transport before access code: 30-day single-use invitations exchange to
separate memory-only scoped sessions lasting at most 30 minutes. All capabilities
are 256-bit, with SHA-256 hashes in private RLS tables. Links use fragments, removed
before capability requests; no guest capability enters localStorage/sessionStorage.
Reloading or a lost exchange response requires verified admin reissue. This avoids
cross-origin cookie dependence, so no cookie gateway is needed. See
`docs/plans/2026-11-01-task-7.md` and the Task 7 operations runbook.

### Implemented diff

- Additive `009_guest_access.sql`; migrations 001–008 remain unchanged. Private
  guest sessions, guest request ledger, committed rate budgets and a quota guard
  have RLS and no client table grants. Existing private token table direct service
  grants are removed; narrowly granted service RPCs perform capability work.
- Active sponsors can invite a new guest; existing identities require verified
  admin reissue. Admin revocation/reissue invalidates derived access. Name/phone
  never grants access. Expiry/revocation does not delete or waive unpaid charges.
- A database trigger serializes guest confirmed/held transitions across sessions,
  including scheduler/admin paths. At most two counted/reserved places; actual
  attendance/no-show and accrued late cancellation count, future confirmed/live
  offers reserve uses. Cancelled sessions, free early withdrawal, declined/expired
  holds and unused waiting positions do not consume uses. Existing 15-minute offer
  consent/expiry, KL withdrawal cutoffs and late-liability floors remain enforced.
- `guest-access` provides one private session, own participation/offer responses,
  bank details, immutable charge/payment history, validated receipt upload and
  fixed 60-second private downloads. Guests receive no Auth JWT or direct
  PostgREST/Storage grants. Guest receipts bind guest/charge/object in private
  attestations and reuse the same session-serialized full-payment helper as
  members. Changed file bytes on a repeated submission fail. Bank checks, cash,
  rejection, cancellation, fee adjustment and actual manual refund rules remain.
- Verified linking requires an active admin, independent verification and reason.
  It revokes guest capabilities, retains all identities/records/timestamps and
  resolves duplicate operational participation using `merged_into_id`. Canonical
  roster/count/queue/member-action/attendance queries exclude retired duplicates.
  Immutable charges and approved/refunded history are unchanged by linking. A
  later reviewed preview assigns retired duplicates zero; existing paid correction
  still requires Task 6's explicit full-refund/replacement-charge adjustment.
- `account-recovery` issues a hashed, 15-minute, single-use capability only after
  active-admin verification. Consumption rechecks issuer role/status and target
  active/suspended status. Passwords go only to protected Edge and official Auth
  admin password update, never application tables, audit metadata or logs. Claim
  and completion/provider failure are audited. Failure consumes the link. Suspended
  targets stay suspended. Provider behavior was verified: old passwords/refresh
  sessions fail, while existing signed access JWTs remain valid until expiry.
- English sponsor/admin guest controls, manual Copy/Hide links, verified linking,
  admin recovery and protected reset form; existing clubhouse design retained.
  Linked guest history stays inspectable and cannot issue new guest invitations.
  Guest/recovery route download failures have a reload recovery action. No message
  sending, settings/dashboard expansion or Task 8 work was added.

### Verification and actual findings

- `npm test`: **157 passed** — 41 domain and 116 database tests. The 21 Task 7
  database cases cover scope/replay/expiry/revocation, counted uses, cancellation,
  withdrawals/holds, unpaid preservation, permissions, duplicate timestamps,
  immutable paid/refunded records, recovery actors/suspension and committed budgets.
  Ordered migrations 001–009 apply to fresh offline PostgreSQL fixtures.
- `npm run test:integration`: **70 passed**, full standalone run. Ten new real
  guest/recovery cases include independently blocked concurrent confirmed and held
  reservations across sessions, cross-session charge/receipt guesses, byte checks,
  replay/file-change rejection, linked receipt authorization, actual provider
  password/refresh behavior and capability/password-free Edge/Kong/Auth/DB logs.
  Existing 60 integration contracts pass unchanged in their asserted behavior.
- `npm run test:e2e`: **50 passed**, desktop/mobile HTTP fixtures. New cases cover
  fragment clearing, memory-only session, reload boundary, third-use explanation,
  offer consent, late withdrawal, payment/refund history, identity-verification
  gates, manual-only sharing, generic reset errors and guest route-download failure.
  Expected React errors are from deliberate failed-module fault injection.
- `npm run test:e2e:live`: **16 passed**, full real desktop/mobile browser suite,
  run sequentially after integration. Sponsor invitation → private join/free
  withdrawal, waiting offer → Continue → receipt → admin bank approval → verified
  duplicate linking, and verified reset → suspended login all work. After the last
  linked-account UI safeguard, all **six Task 7 live journeys passed again**.
- Browser typecheck, frozen Deno Edge check for all four entrypoints, lint, build,
  generated freshness, **108 official public type contracts** and real schema lint
  passed. Schema lint has zero findings. Whitespace checks cover tracked and new
  Task 7 files. No verification remains blocked. No additional full clean Supabase
  stack was created; the existing stack received the additive migration, while
  fresh offline fixtures applied all migrations. No database was reset.
- Verification found fixture isolation issues, not a reason to relax assertions:
  actorless guest audits needed test-owned cleanup and session locks against the
  scheduler. The older actor-matrix fixture also became promotion-eligible once
  guest support existed; it now explicitly uses manual mode and cleans its exact
  offer/participant audit IDs. Guest automatic promotion remains tested separately.
  An exact-duration expiry fixture now samples one statement timestamp. Two live
  text assertions were corrected to match the rendered paragraphs. One earlier
  existing browser cleanup hit a transient Auth fetch failure; its two identified
  synthetic users were deleted through Auth, then the full suite passed. No test
  assertion or production invariant was weakened to obtain the final passes.
- Final rule review added a failing regression for a late-cancelled guest rejoin
  already counted within two uses. Eligibility now excludes that candidate's
  existing use, preserving the 75% floor while blocking genuine third uses. Both
  PostgreSQL and real integration regressions pass; full backend/browser suites
  were rerun after this correction.
- Design context launcher was unavailable; incumbent PRODUCT.md, DESIGN.md and
  components guided implementation. Two bounded desktop/mobile screenshot batches
  were inspected, with one hierarchy/spacing adjustment and no clipping/overflow.
  Sensitive capability/password forms were not captured. Review was performed
  sequentially against Task 7; no independent subagent under the owner's instruction.

### Final cleanup and stop point

Confirmed zero Auth users, profiles/memberships, guests/players, sessions,
participants/polls/votes/offers, fees/charges/payments, cost drafts/snapshots,
receipt objects/checks, invitations/guest sessions/recovery tokens/guest requests,
operation requests, identity/audit fixtures, notifications/outbox, rate budgets
and club settings. Sixteen public tables have RLS; all new capability/receipt
private tables have RLS and client access remains denied. One quota guard singleton
and one active scheduler job remain, with zero worker/recent Cron failures.

**Task 7 is implemented and locally verified.** Diff remains uncommitted for owner
review; HEAD remains `6d88194`. Private env files and the existing development stack
are preserved. No real owner identities, external messages, database reset, Task 8,
commit, push, merge, publication or deployment was performed. Guest memory-session
reload and existing JWT expiry limitations are deliberate and documented; this
does not certify an externally hosted pilot.

## Task 7 checkpoint and Task 8 — local verification (1 November 2026)

The owner approved the Task 7 review/local checkpoint and Task 8, including a
private/test deployment on the specified stack when account access is available.
Fresh Task 7 checkpoint checks passed: 157 unit/database cases, TypeScript,
lint/build and staged whitespace. Commit **`2fdad99`**, `feat: complete Task 7
guest access and account recovery`, contains that work. The two EOF blank-line
fixes before committing changed no behavior. Task 8 below remains uncommitted
for review on the same branch. No push or merge occurred.

### Implemented

- Additive `010_admin.sql`: current-admin approval/rejection/suspension/reactivation
  and roles, explicit reasons, expected-state conflicts and request idempotency.
  The membership guard precedes actor share-locks to serialize mutually changing
  admins without deadlock. Self-change and last-active-admin removal are refused.
  Suspension preserves confirmed places and existing liabilities/history.
- Admin-only dashboard separates gross approved receipts, current positive
  unpaid/pending debt, pending full refunds, actual full refunds and retained
  money. Historical approved receipts remain gross received; pending receipts do
  not count. Voided/superseded charges do not count as outstanding. Aggregate sen
  values remain strings and use BigInt formatting in the browser.
- Checked bank settings use revision/reason/idempotency and complete-or-empty
  bank fields. Private QR uploads are insert-only admin JPEG/PNG up to 5 MiB;
  `settings-qr` authenticates the current admin and validates actual bytes/owner
  before a service-only attestation. New QR attachments require that attestation.
  No direct client signing, public bucket or external QR URL was introduced.
- Bounded member/audit search, original guest participation/payment history and
  separate mobile-scrollable admin navigation. Existing clubhouse style and
  English copy retained. Stale actions preserve edits and request a review.
- Hosted pilot build guard, placeholder-only separate env example and
  origin-specific CSP/privacy headers. Unconfigured/loopback pilot builds fail.
  No positive hosted build or deployed header/Access check is claimed without
  actual provider configuration.
- Current [pilot runbook](PILOT_OPERATIONS.md): admin operations, ordered migrations,
  hosted Auth/functions/Cron/bootstrap, protected Pages previews, database plus
  file backups, ownership/cadence, monitoring and separate secret rotation.
  `health:local` reports read-only sanitized metrics. No external backup schedule,
  quota automation, offsite storage or credential rotation service was installed.

### Actual verification

| Layer | Result |
| --- | --- |
| `npm test` | **176 passed**: 51 unit/domain and 125 PostgreSQL |
| Full real integration | **74 passed**, run before real browser suites |
| Full HTTP-fixture browser suite | **58 passed**, desktop/mobile |
| Full real browser suite | **18 passed**, desktop/mobile, no HTTP interception |
| Isolated database/Storage restore | **1 passed**, 26 table snapshots, 5 identities, 2 objects |
| Browser/test TypeScript, lint, build, type freshness | Passed after final corrections |
| Frozen strict Edge checks | All five handlers passed |
| Official generated public contracts | **116 matched** |
| Local schema lint | No issues |
| Pilot build boundary | Correctly refused missing hosted configuration |
| Local health/cleanup | Passed; one active worker, no failures or residual fixtures |

The full real pilot registers and approves a synthetic member, configures private
bank/QR instructions, exercises voting/capacity, member Decline, actual worker
expiry, guest Continue, 75% same-day withdrawal, no-show/present attendance,
manual fee publication, private receipt rejection/resubmission and bank approval,
cash settlement and actual full refund. Its ledger reaches RM75.04 received and
zero debt; a subsequent RM20.01 actual refund leaves RM55.03 retained. Session
clock advancement is confined to synthetic SQL fixtures; money/status actions use
real RPC/Edge/browser flows.

The restore drill created an isolated uniquely named empty local stack, applied
001–010, exported database data and actual local Storage bytes, and compared all
26 captured table snapshots plus object IDs/owners/versions and SHA-256. Restored
phone/password login, linked-member charge RLS and the private signed receipt
download passed. Only captured test IDs/paths were removed, then the verified-empty
target stack was removed. Temporary archives/private startup output were deleted.
The original stack and its data were never reset. Hosted provider restoration
and target-specific secret/config provisioning remain separately untested.

Review corrections: fixture cleanup now clears only test-owned approval references
before deleting synthetic identities. The first full integration run exposed two
orphan actorless offer-expiry audit rows: cleanup now locks owned sessions and
removes their offer audits before removing offers. Only the two confirmed orphan
test rows were removed; the unchanged strict privacy assertion passed in the full
rerun. Two bounded visual rounds found/corrected large-total wrapping and mobile
refresh-button padding; each metric now has an explicit overflow check. No private
capability/password forms were captured. Fixture route-download fault injection
emits the expected recovered React console error. No backend invariant/assertion
was weakened and no independent subagent was used.

### Cleanup and deployment boundary

Confirmed zero Auth users, all 16 public-table business records/settings, private
capabilities/operation/audit/receipt/QR fixtures and Storage objects. All public
tables and new private tables have RLS. The quota, membership and settings guard
singletons remain, plus one active minute worker with zero worker/recent Cron
failures. Final read-only health sampled worker age 50 seconds and database size
17,364,659 bytes; the live size naturally changes with normal maintenance.
Existing private env files and original migrations 001–009 were preserved.

**Task 8 local work is implemented and verified. Hosted private/test deployment
remains pending account access.** Cloudflare `whoami --json` reported unauthenticated;
Supabase is available as a plugin but is not connected. No Git remote or provider
environment credentials are configured. Supabase connection was suggested and
the owner was asked to sign in locally with `npx wrangler@4.156.0 login`, without
pasting credentials. Browser account inspection failed to initialize its runtime
assets; headless Playwright verification remained available. No hosting product
was substituted, account/security dialog automated or test URL published.
Public launch, WhatsApp, real identities/bank settings and paid services were not
performed. Continue with the protected hosted acceptance steps in the runbook
once those connections are available; no renewed deployment approval is needed.

## Hosted private preview follow-up — 1 November 2026

Both CLI logins are now connected. The authorized private preview is deployed at
https://pilot.bjbc-pilot.pages.dev, with immutable deployment
https://02598581.bjbc-pilot.pages.dev. Both URLs return an anonymous 302 to
Cloudflare Access after the owner enabled the policy. The production base domain
returns 404 and serves no app. No public launch, paid plan change, Git push or
Task 8 commit occurred. Artifact/source state is recorded in the ignored local
build manifest; this is the uncommitted Task 8 worktree above `2fdad99`.

The new Supabase BJBC Pilot project `yzckxbeiwhijrsdeyhor` in Singapore was verified
empty before applying all ten migrations. All five functions are active. Hosted
health confirms 16 public tables with RLS, both private buckets limited to 5 MiB,
ten migration records, and one active minute worker with zero failures. Separate
ignored pilot configuration/operator files preserve existing private local envs.

**Hosted functional acceptance is still blocked at signup.** The CLI reports
phone confirmation configuration converged while the actual Auth service still
requires confirmation. The rejecting SMS hook prevented delivery; no SMS
provider credentials were added. Hosted API requires a positive SMS rate, so its
standard 30 is retained with the rejecting hook. The owner then changed the
dashboard, after which Auth reports Phone provider disabled and auto-confirm
false. The required combination is Phone provider enabled, Confirm phone off.
Await a screenshot of that specific panel to guide the owner accurately. Hosted
pilot attempts did not pass; their synthetic fixture cleanup succeeded, leaving
zero hosted users, business records and files. Local verification counts above
remain local evidence, not hosted acceptance. The Access-protected browser's
authenticated render/refresh also still needs verification.

### Hosted API pilot — passed after saved Phone correction

The owner supplied the correct Phone panel and saved Enable Phone provider ON /
Enable phone confirmations OFF. Actual hosted Auth now reports
`external.phone=true`, `phone_autoconfirm=true`, email provider disabled and signup
enabled. The earlier blocker above is resolved. No SMS credentials were added.

The hosted API pilot **passed all 31 checks**, using five actual synthetic
phone/password signups and reviewed admin approval, private QR byte attestation
and signed download, safe nonadmin projections, voting/queue/decline/worker expiry,
guest capability exchange/acceptance/private receipt submission, KL 75% withdrawal,
no-show, manual fee publication, receipt rejection/resubmission/bank approval,
owner download byte checksum and foreign receipt denial, cash settlement,
cancellation and actual full refund. The ledger reached RM75.04 received,
RM20.01 refunded, RM55.03 retained and zero current debt. Backend actions used
real hosted Auth/PostgREST/Storage/Edge services; only synthetic session/offer
clocks were advanced through trusted SQL. This is API acceptance, not an
automated authenticated-browser run through Cloudflare Access.

Cleanup removed only the fixture records/files. Fresh hosted health confirms
zero users, sessions, charges/payments, audit/settings and Storage objects; all
16 public tables have RLS, both buckets remain private/5 MiB, and the single
minute worker completed 1 second before sampling with zero worker/recent Cron
failures. All ten migrations and five deployed handlers remain installed.

The private preview and immutable URL continue to require Access. The production
base domain serves no app. Authenticated browser rendering/nested refresh needs
the owner’s visual check; browser automation could not initialize its runtime.
No real owner account, real bank details, external backup automation or hosted
restore is claimed. Task 8 remains uncommitted at HEAD `2fdad99`; no push/merge.

### First owner admin — explicitly authorized

The owner registered the account named Bear and explicitly requested admin access.
Verified one matching pending/member account and no existing admins, then used
`app_private.bootstrap_first_admin` through trusted SQL without displaying the
phone or handling the password. Readback confirms **Bear / admin / active** and
one `bootstrap_first_admin` identity audit event. The hosted database now contains
a real owner identity and must be preserved; its earlier empty-state metrics are
historical. Do not reset it or rerun the empty-target synthetic fixture against it.

### Member-facing access — 2 November 2026

The owner explicitly authorized removing the outer Cloudflare email-code gate.
After the owner’s dashboard changes, fresh anonymous checks confirm both
`pilot.bjbc-pilot.pages.dev` and the immutable preview return HTTP200 with BJBC
HTML/CSP and no Access redirect. The base `bjbc-pilot.pages.dev` still returns
404 because there is no production-branch deployment; use the `pilot.` address.
The existing supported CLI token could not edit Access (403), so the agent did
not claim to delete the application or change the policy itself. The actual
dashboard policy configuration was not readable, but the requested routing
outcome is verified. Anonymous reads of profiles, sessions, charges, payments,
audit logs and club settings, plus the admin aggregate RPC, remain denied. No
member roles, records, bank settings, passwords or database permissions changed.
The earlier Access-protection statements describe the initial deployment and
are superseded by this explicit audience change. Future publication must honor
this authorized member-facing audience; the old private-only upload helper
requires an Access redirect and is not suitable unchanged for future uploads.
