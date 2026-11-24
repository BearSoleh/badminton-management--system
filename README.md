# BJBC

Mobile-first badminton club portal. React + Vite + TypeScript + Tailwind, Supabase Auth/PostgreSQL/Storage and Cloudflare Pages. All website copy is English.

## Current phase

Tasks 1–8 have local implementation. Task 8 completes the general admin tools and operating procedures; the member-facing pilot is deployed at [pilot.bjbc-pilot.pages.dev](https://pilot.bjbc-pilot.pages.dev). The owner authorized removing the outer Cloudflare code gate; BJBC login and database permissions still protect club records. The actual hosted API pilot passed 31 checks; authenticated browser rendering remains an owner check. English phone/password Auth, private records/receipt foundations and real session participation are implemented. Admins can create/edit drafts and publish voting; members see upcoming/history sessions, vote Play/Not playing, join after voting closes and withdraw with KL calendar-day charge rules. Database locks, idempotency and audit history protect priority/capacity. Waiting-list offers hold places for 15 minutes, expire through a minute backend job, and advance the queue. Members can Continue/Decline and read their own notification inbox; admins control promotion and audited overrides. Admins review attendance, enter the full per-player fee and cost notes manually, preview each charge, and publish immutable fee versions. Members see their own published charge; costs are never divided automatically. Private receipt upload, bank-check approval/rejection, full cash recording and financial history are implemented. Audited session cancellation and paid-fee adjustments preserve received money and track explicit manual refunds. Suspended members retain access to their own payments. Scoped guest invitations/payments, a two-participation reservation limit, verified account linking and audited admin-assisted recovery are implemented. Private invitations exchange once to memory-only access; reloading requires an admin reissue. Admins can approve/suspend membership, change roles, save checked bank/private QR instructions and inspect original guest history and searchable audit records. The overview separates approved receipts, current debt, pending refunds and money actually returned. A full synthetic club pilot and an isolated database plus file restore drill are exercised locally. No sample members or sessions are shipped.

## Run locally

Use Node 22.12+ (Node 24 recommended).

```powershell
npm ci
if (-not (Test-Path -LiteralPath '.env.local')) { Copy-Item .env.example .env.local }
npm run dev
```

Without Supabase configuration, the English screens render and show a setup notice; login and registration stay disabled. To enable them, follow [the operations guide](docs/OPERATIONS.md). Never put backend keys into `VITE_` variables.

```powershell
npm test
npm run typecheck
npm run typecheck:edge
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:integration
npm run test:e2e:live
npm run db:types:verify
npm run health:local
# Separate, synthetic-only isolated restore drill (Docker):
npm run test:restore
```

`npm test` runs domain and PostgreSQL identity/core-permission tests without Docker. `test:e2e` uses explicit synthetic HTTP fixtures. `test:integration` and `test:e2e:live` use actual local Supabase services and load private values from the ignored `.env.test.local` file. Run real integration and live suites sequentially so their synthetic admins do not overlap. They require Docker and applied migrations; receipt integration also requires Storage and `npm run functions:serve` (see operations guide). `typecheck:edge` uses pinned Deno 2.9.6 through npm's cache, without a machine-level install, and a frozen server dependency lockfile. `db:types:verify` compares every public table/RPC contract with the official local Supabase generator. These are distinct verification layers; unavailable tests are never counted as passing.

For private hosting, use `npm run build:pilot` with a separate hosted test backend and follow [the pilot runbook](docs/PILOT_OPERATIONS.md). The ordinary local build may contain loopback configuration and must not be published.

[Approved specification](docs/BJBC_Codex_Development_Pack_v1.md) · [Progress and evidence](docs/PROGRESS.md) · [Setup and operations](docs/OPERATIONS.md)
