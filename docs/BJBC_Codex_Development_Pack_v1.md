# BJBC — Codex Development Pack v1

Prepared: 14 October 2026, Asia/Kuala_Lumpur.
Owner: Afiq Haikal (Bear). Product: BJBC badminton club management web app.
Status: Reviewable specification and implementation plan; no application has been built or deployed by preparing this pack.
Language: Technical handoff and all user-facing website copy in English, as approved by the owner on 20 October 2026.

## 0. How to use this pack

1. Place this file at `docs/BJBC_Codex_Development_Pack_v1.md` in the project repository.
2. Read the approved requirements and the proposed defaults separately. The latter are engineering proposals, not previous user approvals.
3. Review the pack with the owner before implementation. Use the startup prompt at the end in Codex.
4. Build one phase at a time. Record implemented tasks, test evidence and remaining limitations in `docs/PROGRESS.md`.
5. Keep this document with the code. Changes to rules must update this document and the corresponding tests.

Do not ask the owner again about decisions explicitly settled below. Group unresolved business decisions into one brief review. Do not create paid services, enable WhatsApp billing or publish a public production deployment as part of document preparation.

## 1. Product brief and confirmed decisions

Build a mobile-first club portal that reduces manual coordination of voting, player lists, attendance and session payments. One club, one application, two role-based interfaces. Admins may also participate as players.

| ID | Confirmed requirement |
| --- | --- |
| R01 | Frontend: React, Vite, TypeScript and Tailwind CSS. Backend/database/auth/storage: Supabase and PostgreSQL. Frontend hosting: Cloudflare Pages. GitHub for source control. Codex assists development. |
| R02 | Start with free service tiers and a hosting subdomain. Custom domain, PWA and native mobile apps are not MVP requirements. |
| R03 | Registration requires one display name field accepting a name or nickname, phone number and password. Subsequent login uses phone and password only. No SMS OTP in MVP. |
| R04 | Admin approval is required for active membership. Pending members cannot vote or join. |
| R05 | Admin creates sessions and voting, manages members, player lists, attendance and payment verification. |
| R06 | A vote to play also joins the session subject to capacity. Priority is the server-recorded vote timestamp: earliest first. Overflow becomes waiting list. |
| R07 | Voting participants have priority. Additional join requests are allowed after voting closes when capacity permits; otherwise they queue. |
| R08 | Waiting list supports automatic promotion and manual admin control. An offered player appears as awaiting confirmation and has 15 minutes to Continue or Decline. |
| R09 | Declined or expired offers incur no charge. The next eligible waiting player receives the slot. Only accepted offers create confirmed participation. |
| R10 | Withdraw before the session's local calendar day: no charge. Withdraw on the session day after confirmation: 75% of the full session fee. This is a calendar-day cutoff, not 24 hours before start. |
| R11 | Confirmed player absent without withdrawing: no-show, charged 100%. Attending player: 100%. Remaining waitlisted players: no charge. Cancelled session: no charge. |
| R12 | After play, admin manually determines the full per-player fee using court cost and shuttle usage. Do not implement an automatic cost-sharing formula. Calculate only the applicable charge percentage. |
| R13 | Manual payment: published charge → bank/QR details → transfer in banking app → receipt upload → Pending verification → admin checks bank transaction → Paid or Rejected. |
| R14 | Before publication display Fee not yet set, not RM0 or Unpaid. |
| R15 | Guest uses name and phone, with a sponsoring member/invitation or admin verification. Maximum two guest participations; account required for the third. |
| R16 | Guest payment experience and charge rules match ordinary players. Guest must have private access to their own charge and receipt upload without treating name/phone as credentials. |
| R17 | Desired future notification channel is WhatsApp. Cost review and integration are deferred; use in-app notifications for the pilot and preserve a future delivery integration boundary. |
| R18 | Store receipts privately. Enforce role and record permissions at the backend/database. |

Scope also includes member profile, session/payment history, admin dashboard totals and outstanding charges, guest account linking after identity verification, and an audited admin-assisted password reset process.

### Explicitly out of scope

Automatic bank reconciliation, payment gateway, SMS authentication, live WhatsApp integration, automated cost splitting, wallet/credit balance, tournaments, team balancing, subscriptions, multi-club tenancy, native mobile apps and public marketing pages. Do not install packages for these features.

## 2. Proposed defaults for owner review

These close edge cases; they do not override R01–R18. The kickoff review can accept them together or adjust individual items.

| ID | Proposal |
| --- | --- |
| D01 | One participation poll per session: Play / Not playing (English labels for Nak main / Tak main). Other general-purpose polls can follow later. Changing from Play to Not playing uses withdrawal rules, never silently deletes liability. |
| D02 | Initial votes within capacity immediately confirm participation; excess votes queue. A withdrawn or declined player who explicitly rejoins receives a new timestamp and goes to the end. Original timestamps remain in history. |
| D03 | Capacity includes confirmed players plus unexpired held offers. Automatic promotion may run during voting as slots open. Post-voting joins never bypass the existing queue. |
| D04 | Offer timer begins at server-side offer creation, lasts exactly 15 minutes, and is visible in-app. Notify admins on delivery failures. Do not claim a user has read a notification. In-app notification cannot alert someone who has closed the site. |
| D05 | Stop new joins and promotion at session start. Do not create a new 15-minute offer within 15 minutes of start. Admin handles those late vacancies manually, with player consent recorded. Existing offers must expire no later than start. |
| D06 | All session-day withdrawals before play are late cancellation. After session start, member self-withdraw is disabled; admin records attendance/no-show or a justified correction. |
| D07 | Replacing a late-cancelled player does not automatically waive the original 75% charge. Any admin waiver requires a reason and an audit event. |
| D08 | Guest limit counts confirmed slots in sessions that actually took place: attended, no-show or late-cancelled. Free early withdrawals and cancelled sessions do not count. Reserve eligibility for future confirmed/held slots so a guest cannot book three sessions concurrently. |
| D09 | Anonymous guest invitation links are scoped to that guest and session, expire after 30 days and can be revoked/reissued by admin. Expiry does not erase unpaid charges. |
| D10 | Guest invitations and reset links are shared manually in pilot. No automatic WhatsApp sending. Users are told not to forward private access links. |
| D11 | Default receipt formats: JPEG, PNG or PDF, maximum 5 MB each. One active pending payment submission per charge; rejected submissions remain in history and can be replaced with a new submission. |
| D12 | One full payment per charge in MVP. No partial payment, wallet, credit or online refund system. Admin can record full cash payment, with method and audit trail. |
| D13 | Admin reviews/corrects attendance before publishing fees. Published charges are immutable; admin corrections create a new version/adjustment with a reason rather than overwriting accepted payment history. |
| D14 | If a paid session is later cancelled, void outstanding charges and flag received payments for manual refund tracking. Record actual refunds explicitly; never mark money as returned automatically. |
| D15 | Active members see session rosters with display names and participation states only. Phones, receipts and other players' debt histories are private. Pending/suspended members can access only limited account status; suspended members retain access to their own existing payment obligations. |
| D16 | Currency MYR, money as integer sen. Round 75% half-up to the nearest sen: RM20.01 × 75% = RM15.01. Store percentage and fee version with each charge. |

## 3. Architecture and responsibilities

| Component | Responsibility |
| --- | --- |
| React SPA on Cloudflare Pages | Screens, forms, client-side navigation, loading/error states and authenticated calls. Route guards improve UX but are not authorization. |
| Supabase Auth | Phone/password credentials and authenticated sessions. Passwords never enter profile tables or logs. |
| PostgreSQL | Durable data, constraints, RLS, atomic operations for slots, offers, fee publication and payment approval. |
| Database RPC functions | Validate actor and membership, lock relevant rows, apply rules and write audit/notification records in one transaction. |
| Supabase Edge Functions | Guest capability exchange, admin-assisted recovery and future integrations requiring server secrets. |
| Private Supabase Storage | Receipt objects with constrained access and short-lived authorized viewing links. |
| Scheduled backend job | Expire offers and advance queues independently of any browser. Run about once per minute; RPC checks exact expiry on every response. |
| Notification outbox | Persist domain events and in-app notifications. Reserve a provider interface for WhatsApp later; disabled by default. |

Use normal RLS-protected reads for profile/session views. Do not scatter privileged writes across browser calls. Critical state transitions must be database transactions, using session-row locks to serialize capacity decisions. For functions using SECURITY DEFINER, set an explicit safe search_path, validate the caller, restrict grants and qualify tables. Service-role credentials are server-only.

Configure Cloudflare SPA fallback so refreshing a nested route works. Only public Supabase URL/publishable key goes in VITE_ variables; these are visible to every visitor. Keep server secrets in backend secret storage. Separate pilot and later production environments; never seed real data into tests.

Verify current official Supabase phone/password settings before implementation. Explicitly test phone registration with SMS confirmation disabled; do not pretend the number is verified. Normalize phone numbers with a maintained phone parsing library to E.164. Show generic login/recovery errors and enable appropriate authentication rate limits. First admin is bootstrapped using a trusted operator action, never a public signup field.

### Recovery and guest identity

Admin verifies identity outside the app, then issues a short-lived single-use reset capability. The browser submits a new password to a protected backend endpoint; backend changes credentials through the supported Auth admin API and revokes existing sessions where supported. Admin does not view passwords. Test replay, expiry, actor permissions and suspension. Recheck provider capabilities before writing code.

For guests, use a high-entropy capability token, store only its hash, and exchange it through a rate-limited Edge Function for a short-lived scoped guest session. Guest requests always validate that session and scope; never expose the service-role key. Remove invitation tokens from the visible URL after exchange and exclude them from logs/referrers/analytics. Persist guest session safely; avoid putting permanent capabilities in localStorage. Use a secure same-site cookie gateway if cross-origin browser constraints require it; document the chosen mechanism before coding guest access.

Guest-to-member linking is an admin-verified operation. A matching unverified phone alone does not authorize claiming guest records or resetting accounts.

## 4. Lifecycle and screen inventory

### Session

Draft → Voting open → Joining open → In progress → Completed → Fees published → Settled.
Cancelled is a terminal session outcome reachable through an audited admin action. Keep operational session status and billing status in separate fields so a completed session with unpaid charges remains accurately represented.

Draft is admin-only. Voting closes at a stored timestamp. Joining closes at start under D05. Attendance is finalized before charge publication. Cancelled/completed sessions cannot accept new players.

### Participation

Confirmed, Waitlisted, Offered, Withdrawn early, Late cancelled, Offer declined, Offer expired.
Attendance is separate: Unmarked, Present, No-show, Not applicable.
Offer acceptance after expires_at fails even if the periodic expiry job has not run. Decline/expiry never creates liability. Accepted offer followed by session-day withdrawal creates 75% liability.

### Charges and payments

No published charge → Fee not yet set.
Published charge → Unpaid → Pending verification → Paid.
Rejected payment returns the charge to Unpaid with rejection reason and resubmission action. Payments keep their own Submitted/Approved/Rejected states. Cancelled liabilities are Voided, not Paid. Receipt upload completion must be verified before submission.

### Pages

| Route | Audience and content |
| --- | --- |
| /register, /login | Name/nickname registration, phone/password login, policy acknowledgement |
| /account-status | Pending/rejected/suspended status and admin contact |
| /app | Upcoming sessions, open votes, active offers, own unpaid total |
| /app/sessions/:id | Details, roster, voting/join/withdraw, offer countdown and fee state |
| /app/payments and /app/payments/:id | Own charges, bank/QR, receipt upload, history and rejection reason |
| /app/notifications | In-app messages, read state, links to current server state |
| /app/profile | Display name and account settings; phone change requires admin verification |
| /guest/access | Private invitation exchange, own session and payment actions |
| /admin | Session count, attendance summary, collection/outstanding totals |
| /admin/members | Approval, suspension, role management with restricted bootstrap/admin policy |
| /admin/sessions and /admin/sessions/:id | Draft/edit/publish, poll, roster, queue, attendance, fee review/publication |
| /admin/payments | Receipt verification, cash recording, corrections and refund flags |
| /admin/guests | Sponsor/invite, history, usage eligibility and verified account linking |
| /admin/settings | Bank/QR details and safe club configuration |
| /admin/audit | Actor, action, timestamp, reason and affected record |

Use mobile-friendly cards, large action buttons, accessible labels and explicit empty/loading/error states. Disable duplicate submits, but rely on backend idempotency. Confirm withdrawal with the applicable percentage; if fees are not published, state that the amount will be determined later. Show KL times and MYR consistently.

## 5. Database blueprint

This is a conceptual schema, not executable SQL. Codex must implement ordered migrations, constraints and policies, then regenerate TypeScript types.

| Table | Essential fields and relationships |
| --- | --- |
| profiles | id references auth.users; display_name; normalized phone; timestamps. No credentials. |
| memberships | user_id unique; role member/admin; status pending/active/rejected/suspended; approved_by/at. Protected from self-promotion. |
| players | id; user_id nullable unique; guest_id nullable unique; exactly one identity source. Stable participant identity after verified guest conversion. |
| guests | id; name; normalized phone unique; sponsor_user_id nullable; verified_by; linked_user_id nullable; timestamps. |
| sessions | id; title; venue; starts_at/ends_at timestamptz; capacity; voting_closes_at; waitlist_mode; operational_status; created_by. |
| polls | id; session_id unique for MVP; opens_at/closes_at; status. |
| votes | poll_id + user_id unique; choice; joined_at for the current affirmative vote; immutable event history separately. |
| participants | id; session_id + player_id unique; source vote/direct/guest/admin; queue_joined_at; participation_status; attendance; confirmed_at; withdrawn_at; charge_percent. |
| waitlist_offers | id; participant_id; offered_at; expires_at; state pending/accepted/declined/expired/revoked; response_at. Partial unique active offer per participant. |
| session_costs | session_id unique; court_cost_sen; shuttle_quantity; shuttle_cost_sen; notes. Informational inputs, no auto-split formula. |
| fee_versions | id; session_id; full_fee_sen; version; published_at/by; reason. Unique session/version. |
| charges | id; participant_id; fee_version_id; percent; amount_sen; status; supersedes_charge_id nullable. Unique current charge per participant. |
| payments | id; charge_id; method transfer/cash; amount_sen; receipt_object_path nullable for cash; status; submitted_by; verified_by/at; rejection_reason; idempotency_key. |
| guest_access_tokens | id; guest_id; session_id; token_hash; expires_at; revoked_at; scope. No raw tokens. |
| recovery_tokens | user_id; token_hash; expires_at; consumed_at; issued_by. Server-only access. |
| notifications | id; user_id or guest_id; event_key unique per recipient; type; payload; created_at; read_at. |
| notification_outbox | event_key + channel unique; state; attempts; next_attempt_at; delivery metadata. WhatsApp inactive. |
| audit_logs | actor identity; action; entity/id; safe before/after metadata; reason; timestamp. Append-only. |
| club_settings | bank display details; QR object reference; timezone fixed to Asia/Kuala_Lumpur in MVP. |

Use UUID identifiers, foreign keys, checked enum-like states and nonnegative integer amounts. Avoid destructive cascade deletes of financial history. Deactivate members rather than deleting their attendance/payment records. Store timestamps in UTC with timestamptz; evaluate cutoffs in Asia/Kuala_Lumpur using the server clock.

### Permission matrix

| Data/action | Public/pending | Active member | Guest capability | Admin |
| --- | --- | --- | --- | --- |
| Registration/login | Allowed through Auth | Own account | Not implicit access | Own account |
| Own profile/status | Own limited record | Own safe fields | Own scoped guest fields | Manage approved scope |
| Sessions/roster | No private roster | Published sessions; safe display names | Invited session only | Full management |
| Vote/join/withdraw | Denied | Own through validated RPC | Own scoped actions through backend | Audited management |
| Charges/payments | Own existing obligations if suspended | Own only | Own invited records only | All club records |
| Receipt objects | Denied except authorized own obligations | Own submission/view | Own via backend | Authorized verification |
| Membership role/status | Cannot write | Cannot write | Denied | Restricted administrative action |
| Fee/payment approval | Denied | Denied | Denied | Validated RPC only |
| Tokens/audit/outbox | Denied | Denied | Denied | Audit read; secret tables backend-only |

Implement safe roster views without exposing underlying phones or payment fields. If using database views, verify they respect invoker permissions/RLS. Suspended payment access must never restore join/vote privileges.

## 6. Backend contracts

Names below are proposed implementation contracts. Return structured error codes suitable for localized UI; never trust caller-supplied user IDs, fees, roles or timestamps.

| Operation | Input | Output / invariant |
| --- | --- | --- |
| cast_session_vote | session_id, choice, request_id | participant state; atomically allocate or queue by server timestamp |
| join_session | session_id, request_id | participant state; active member, join window, existing queue respected |
| withdraw_participation | participant_id, request_id | new state, charge_percent; server-side KL cutoff |
| respond_to_offer | offer_id, accept boolean, request_id | confirmed/declined; must be owned, pending and unexpired |
| expire_waitlist_offers | backend/admin job context | expire due offers, offer next eligible players, deduplicated notifications |
| admin_offer_slot | participant_id, reason, request_id | held slot; capacity enforced, skipping order audited |
| set_attendance | participant_id, attendance, reason if correction | attendance state; cannot turn waitlisted player into a billed no-show |
| publish_session_fee | session_id, full_fee_sen, request_id | fee version and generated charges using stored eligibility/percent |
| submit_payment | charge_id, receipt_path, request_id | pending payment; verify object ownership, size/type and active charge |
| review_payment | payment_id, approve boolean, reason, request_id | approved/rejected; approving twice cannot double-count revenue |
| record_cash_payment | charge_id, reason, request_id | approved cash payment and audit event |
| cancel_session | session_id, reason, request_id | cancelled, offers revoked, outstanding charges voided, paid amounts flagged |
| verify_and_link_guest | guest_id, user_id, reason | linked identity without duplicate participation or lost history |

Use database transactions and row locks for competing calls. Repeated request IDs return the original result; conflicting payload reuse is rejected. Check session capacity under the same lock as offer creation/acceptance. For guest calls, derive player identity from capability scope in the backend rather than accepting arbitrary guest_id.

## 7. BJBC implementation plan

> For agentic workers: use the executing-plans workflow if available and implement task-by-task. Native sequential Codex execution is the default; do not spawn parallel agents unless the owner requests that execution style.

**Goal:** Deliver a testable private BJBC pilot with approved membership, session participation and manual billing.

**Architecture:** React SPA on Cloudflare Pages, backed by Supabase Auth/PostgreSQL/Storage. Database transactions own business invariants; Edge Functions own privileged guest/recovery work.

**Tech stack:** React, Vite, TypeScript, Tailwind, Supabase, PostgreSQL; Vitest for domain logic, database integration tests for RLS/concurrency and Playwright for critical browser journeys.

**Spec:** Sections 1–6 of this file.

### Global constraints

- Asia/Kuala_Lumpur business calendar; integer MYR sen; 15-minute offers.
- Manual full-fee entry, no auto-split; attendance 100%, late cancellation 75%, no-show 100%.
- WhatsApp disabled; no paid services or actual notifications to outside recipients during development.
- Private receipts and backend-enforced permissions; no service key in frontend.
- Build one phase, show evidence, then continue according to owner's execution authorization.
- Select current stable compatible dependencies when implementing, verify official docs and commit a lockfile. No versions are claimed to have been tested by this document.

### Review focus

1. Two users competing for the last slot: only one confirmed/held place (Task 3).
2. Offer response at expiry and delayed worker: server rejects stale acceptance (Task 4).
3. Phone aliases, guest claiming and reset replay: no account takeover (Tasks 1 and 7).
4. Fee rounding, duplicate approval and post-payment cancellation: no corrupt balances (Tasks 5 and 6).
5. Receipt ID guessing and browser direct API calls: no cross-user disclosure (Tasks 2 and 6).

### Proposed source layout

| Path | Responsibility |
| --- | --- |
| src/app/router.tsx | Routes and layouts |
| src/lib/supabase.ts | Browser client, public configuration only |
| src/lib/money.ts, src/lib/time.ts | Display utilities; server remains authority |
| src/features/auth/ | Signup/login/status/profile/recovery screens |
| src/features/sessions/ | Sessions, poll and participation UI |
| src/features/waitlist/ | Offers, countdown and admin queue |
| src/features/attendance/ | Admin attendance |
| src/features/payments/ | Fees, charges, uploads and verification |
| src/features/guests/ | Invitations, guest portal and linking |
| src/features/notifications/ | Inbox and unread state |
| src/features/admin/ | Members, settings and dashboard |
| src/types/database.ts | Generated schema types |
| supabase/migrations/ | Ordered schema/RLS/RPC migrations |
| supabase/functions/ | Guest/recovery server endpoints |
| tests/domain/, tests/integration/, tests/e2e/ | Rules, security/concurrency and browser journeys |
| docs/PROGRESS.md, docs/OPERATIONS.md | Evidence, setup, recovery and deployment runbook |

### Task 1 — Project foundation and authentication

Files: package.json, vite.config.ts, src/app/router.tsx, src/lib/supabase.ts, src/features/auth/AuthPages.tsx, src/features/auth/phone.ts, supabase/migrations/001_identity.sql, tests/integration/auth.spec.ts.
Interfaces: normalizePhone(raw: string): string; getMyMembership(): Membership; membership status drives UI but database policies enforce access.

- [x] Inspect repository and existing instructions. If empty, scaffold the agreed stack; preserve unrelated existing work.
- [x] Add test cases: normalized equivalent Malaysian phone formats collide; signup starts pending/member; signup cannot choose admin; pending account cannot join; approved account can log in using phone/password.
- [x] Run tests and confirm missing functionality fails for the intended reason.
- [x] Implement Auth integration, display name, normalization and trusted first-admin setup. Document SMS-disabled behavior and unverified phone limitation.
- [x] Verify login/logout, expired sessions, pending/suspended screens and safe generic failures.
- [x] Run auth tests and build/type checks, record evidence and commit the phase.

### Task 2 — Database security and private storage

Files: supabase/migrations/002_core_tables.sql, 003_permissions.sql, src/types/database.ts, tests/integration/permissions.spec.ts.
Interfaces: schema and read permissions from Section 5; authorized receipt view via short-lived URL.

- [x] Write actor-matrix tests using public, pending, active A, active B, suspended, guest and admin contexts.
- [x] Confirm tests reject unknown/missing policies before implementing exposure paths.
- [x] Implement tables, constraints, RLS, safe roster projection and private storage policy.
- [x] Test direct REST/RPC attempts to change role, payment status, phones and another user's receipt path.
- [x] Verify generated types and migration-from-empty; run permissions tests and commit.

### Task 3 — Sessions, voting and participation

Files: supabase/migrations/004_participation.sql, src/features/sessions/SessionPages.tsx, src/features/sessions/api.ts, tests/integration/participation.spec.ts.
Interfaces: cast_session_vote, join_session and withdraw_participation from Section 6.

- [x] Write fixtures for capacity 2 and three affirmative votes at distinct server times; expect first two confirmed, third waiting.
- [x] Add tests for duplicate vote retry, withdrawn/rejoin order, direct join before voting closes, queue priority and two concurrent requests for the final slot.
- [x] Implement session create/edit/publish and transactional participation functions with row locks.
- [x] Implement member session detail, roster and explicit withdrawal confirmation.
- [x] Verify KL midnight boundary: Thursday 23:59:59 → 0%; Friday 00:00:00 for Friday session → 75%.
- [x] Run participation tests, review capacity evidence and commit.

### Task 4 — Waiting-list offers and in-app notification

Files: supabase/migrations/005_waitlist.sql, 006_notification_job.sql, src/features/waitlist/OfferCard.tsx, src/features/notifications/Inbox.tsx, tests/integration/waitlist.spec.ts.
Interfaces: respond_to_offer, expire_waitlist_offers and admin_offer_slot; deduplicated event record.

- [ ] Test offer at 12:00:00 expires at 12:15:00; accept 12:14:59 succeeds, accept at 12:15:00 fails even before expiry job runs.
- [ ] Test decline/expiry offers next player once, browser closed expiry, manual mode, slot holds, duplicate job execution and two simultaneous acceptance attempts.
- [ ] Implement offer creation, locking, scheduler, mode control and audit for manual overrides.
- [ ] Implement Continue/Decline screen and notification inbox. Refresh authoritative server state when countdown ends.
- [ ] Test D05 start-time boundary and cancelled sessions. Confirm in-app notifications make no claim of external delivery.
- [ ] Run waiting-list tests and commit with scheduler setup instructions.

### Task 5 — Attendance and manual fees

Files: supabase/migrations/007_billing.sql, src/features/attendance/AttendancePage.tsx, src/features/payments/FeeEditor.tsx, tests/integration/billing.spec.ts.
Interfaces: set_attendance and publish_session_fee; immutable fee_versions and charges.

- [ ] Test fee 2000 sen yields present=2000, late cancellation=1500, no-show=2000; early withdrawal/waitlisted/declined/expired/cancelled produce no liability.
- [ ] Test 2001 sen late cancellation rounds to 1501 sen, zero fee is displayed intentionally, negative fee rejected and repeated publication request creates no duplicates.
- [ ] Implement cost notes, full-fee manual input, preview by player and publication. No cost-dividing algorithm.
- [ ] Implement attendance validation so only confirmed eligible players become no-shows; require review of unmarked players before publication.
- [ ] Verify no-fee-yet copy and published fee/percentage snapshots; run billing tests and commit.

### Task 6 — Receipts, verification and financial history

Files: supabase/migrations/008_payments.sql, src/features/payments/PaymentPages.tsx, src/features/payments/ReceiptUpload.tsx, tests/integration/payments.spec.ts, tests/e2e/payment.spec.ts.
Interfaces: submit_payment, review_payment, record_cash_payment and cancel_session.

- [ ] Write tests for upload success versus incomplete upload, 5 MB boundary, unsupported type, unauthorized path, rejected-resubmit and duplicate approval.
- [ ] Implement private upload, metadata validation, submission and admin short-lived viewing links. Reject unsafe rendered HTML/SVG.
- [ ] Implement approval after admin bank check, rejection reason, cash recording and paid history.
- [ ] Test cancellation after payment: unpaid liabilities void; received money remains recorded and refund action is pending/manual.
- [ ] Test fee correction cannot silently modify an approved payment; restrict to audited version/adjustment flow.
- [ ] Run integration and critical payment browser journey, record evidence and commit.

### Task 7 — Guest access and account recovery

Files: supabase/migrations/009_guest_access.sql, supabase/functions/guest-access/index.ts, supabase/functions/account-recovery/index.ts, src/features/guests/GuestPortal.tsx, tests/integration/guest.spec.ts, tests/integration/recovery.spec.ts.
Interfaces: scoped guest session; verify_and_link_guest; single-use reset capability.

- [ ] Pin down D08–D10 and chosen guest-session transport in docs before writing access code.
- [ ] Test guest attempts one/two permitted, third blocked; concurrent reservations cannot bypass the limit; cancelled/early-withdrawn sessions do not consume uses.
- [ ] Implement sponsor/admin invitation, hashed capability exchange, scope/expiry/revocation and guest payment portal using the same charge engine.
- [ ] Test token replay handling where single-use exchange is chosen, invalid/expired/revoked tokens, cross-session record guessing and token-free logs.
- [ ] Implement verified guest-to-member linking; test phone match alone cannot claim records, duplicate same-session records are resolved without losing billing history.
- [ ] Implement audited admin-assisted reset; test non-admin issuance denied, expired/used links denied and no password is stored in logs.
- [ ] Run guest/recovery tests, demonstrate flows and commit.

### Task 8 — Admin completion and pilot deployment

Files: src/features/admin/AdminPages.tsx, src/features/admin/SettingsPage.tsx, tests/e2e/club-pilot.spec.ts, public/_redirects, .env.example, docs/OPERATIONS.md, docs/PROGRESS.md.
Interfaces: safe dashboard aggregates and settings; no client-side recalculation that changes financial records.

- [ ] Implement member approval/suspension, guest/history tools, bank/QR settings and audited admin actions.
- [ ] Test collected total uses approved payments only; outstanding excludes voided/superseded charges; refunds are reported separately.
- [ ] Complete mobile and keyboard review; cover refresh on nested routes and expired sessions.
- [ ] Run full pilot scenario from signup to settled payment including guest, waitlist decline/expiry, late cancellation and no-show.
- [ ] Document environment variables, migrations, scheduler checks, admin bootstrap, database and receipt backup/restore, and secret rotation.
- [ ] Produce a private/test deployment when account access and deployment authorization are available; do not substitute an unapproved hosting product.
- [ ] Share test evidence and limitations. Public launch and WhatsApp integration are separate actions.

### Verification commands to establish in package scripts

`npm run typecheck` — TypeScript without emit.
`npm run lint` — configured static analysis.
`npm run test:unit` — deterministic domain tests.
`npm run test:integration` — local Supabase actor/RLS/transaction tests; fail clearly if local backend is unavailable.
`npm run test:e2e` — seeded Playwright pilot journeys.
`npm run build` — production SPA build.

These are required script contracts for the implementer to create, not commands already run on an application. Do not claim tests pass if they were skipped or backend dependencies were unavailable.

## 8. Pilot acceptance checklist

- [ ] Name/nickname + phone + password registers; phone/password logs in; duplicate canonical phone rejected.
- [ ] Admin approval is required; role escalation via direct API fails.
- [ ] Earliest votes get places; overflow queues; no overbooking under concurrency.
- [ ] Held offers consume capacity and expire after 15 minutes without an open browser.
- [ ] Decline/expiry creates no bill; acceptance followed by same-day withdrawal creates 75% liability.
- [ ] KL calendar midnight, not a 24-hour duration, controls free withdrawal.
- [ ] No-show is 100%; cancelled session is no liability.
- [ ] Admin manually sets full fee; no automated cost splitting exists.
- [ ] Fee not yet set appears until fee publication.
- [ ] Receipt is private; upload alone does not mark Paid; rejected receipts can be resubmitted.
- [ ] Guest pays through their private access flow; third guest participation is blocked.
- [ ] Notifications work in-app; UI does not suggest WhatsApp was sent.
- [ ] History and totals survive retries, fee corrections and cancelled sessions without false refunds.
- [ ] UI works on a narrow phone viewport, keyboard navigation and nested-route refresh.
- [ ] Recovery, backup/export and restore procedure is documented and exercised with synthetic data.

## 9. Setup and operations checklist

Owner-provided items when setup begins: GitHub repository/access, Supabase project/access, Cloudflare project/access, club bank/QR details and intended first admin phone. Provide secrets through environment/secret settings, not chat or repository files.

Browser environment example names: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Backend-only credentials must not use VITE_ prefixes. Keep .env files out of git; commit a placeholder-only .env.example.

Develop against local Supabase where possible. Use synthetic names/phones/receipts. Apply migrations to a clean test database before pilot. Monitor free-tier quotas and scheduler operation; verify current provider limitations during setup. Do not promise permanent zero cost or uninterrupted free-tier availability. No SMS/WhatsApp/payment processor accounts are required for the initial pilot.

Export database records and private receipt files with a documented restore mapping; a database-only export is not a receipt backup. Limit access to backups. Record recovery ownership and cadence before the first real paid session.

Future WhatsApp integration must review provider pricing, account eligibility, recipient consent, approved template requirements and delivery callbacks. Use a notification adapter/outbox so adding it does not change participation or billing rules. Do not send WhatsApp messages during tests.

## 10. Codex startup prompt — copy into a new session

```text
You are helping me build BJBC, a badminton club management web app.

Read docs/BJBC_Codex_Development_Pack_v1.md completely before taking implementation action. It contains the specification, proposed defaults, database/permissions blueprint, backend contracts, implementation plan and acceptance checklist.

First inspect the repository and any AGENTS.md instructions. Do not overwrite existing work. Summarize the architecture and the proposed defaults that require my review in one short message. Do not ask again about confirmed R01–R18. Verify current official provider documentation when choosing Auth settings or platform APIs.

This first turn is a kickoff review. After I approve the spec/defaults and authorize implementation, work sequentially through Task 1 onward, one testable phase at a time. Use the exact agreed stack: React + Vite + TypeScript + Tailwind, Supabase Auth/PostgreSQL/Storage and Cloudflare Pages. Use native sequential execution, not parallel agents, unless I ask otherwise.

Keep the project mobile-first. Enforce authorization and business rules in the backend/database. Registration is name OR nickname + phone + password; login is phone + password. No SMS OTP. Admin approval is required.

Do not change these rules: timestamp-based vote priority, 15-minute waiting-list offers, KL calendar-day cancellation cutoff, 75% late cancellation, 100% no-show, manual per-player fee entry after the session, manual receipt verification, and two guest participations before account creation.

WhatsApp is deferred pending a cost review. Use in-app notifications in the pilot. Do not add a payment gateway, automatic cost-splitting formula, subscriptions or native mobile app.

Write meaningful tests for permissions, concurrent slot allocation, offer expiry, billing and guest access. Never claim tests passed unless you ran them. Keep migrations, generated database types, setup instructions and docs/PROGRESS.md current. At each phase report what works, test evidence, limitations and the next task.

Never expose secrets in frontend code or logs. If credentials/access are missing, complete local work and state exactly what setup is needed. Do not subscribe to paid services, send real external notifications or publish a public production deployment without my explicit instruction.
```

## 11. Review record

This pack consolidates the owner's conversation decisions through 14 October 2026. No repository was inspected and no dependency/provider setup was executed for this documentation task. D01–D16 and the conceptual technical design are proposed for kickoff review. The implementation plan is supplied together at the owner's request; supplying it does not imply an application has been implemented or tested.

Official implementation references to recheck at build time:

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/cron
- https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
- https://supabase.com/pricing
- https://developers.cloudflare.com/pages/platform/limits/

End of handoff.

## 12. Owner approval — 20 October 2026

Specification and D01–D16 approved. Task 1 authorized with native sequential execution. All user-facing copy must be English. R14 is displayed as **Fee not yet set**; its financial behavior is unchanged. The root file is preserved as the original handoff. No deployment is authorized.

Task 1 local foundation verification completed on 21 October 2026 against actual Supabase Auth/PostgREST and live desktop/mobile browser journeys. The owner subsequently authorized Task 2 on 21 October and Task 3 on 22 October. Both foundations and Task 3 participation are locally verified; see docs/PROGRESS.md for evidence and phase limits. Guest direct access remains denied until Task 7's capability backend. Task 4 is not started or authorized.
