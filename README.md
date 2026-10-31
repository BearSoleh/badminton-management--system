# BJBC

Mobile-first badminton club portal. React + Vite + TypeScript + Tailwind, Supabase Auth/PostgreSQL/Storage and Cloudflare Pages. All website copy is English.

## Current phase

Tasks 1–6 are locally verified. English phone/password Auth, private records/receipt foundations and real session participation are implemented. Admins can create/edit drafts and publish voting; members see upcoming/history sessions, vote Play/Not playing, join after voting closes and withdraw with KL calendar-day charge rules. Database locks, idempotency and audit history protect priority/capacity. Waiting-list offers hold places for 15 minutes, expire through a minute backend job, and advance the queue. Members can Continue/Decline and read their own notification inbox; admins control promotion and audited overrides. Admins review attendance, enter the full per-player fee and cost notes manually, preview each charge, and publish immutable fee versions. Members see their own published charge; costs are never divided automatically. Private receipt upload, bank-check approval/rejection, full cash recording and financial history are implemented. Audited session cancellation and paid-fee adjustments preserve received money and track explicit manual refunds. Suspended members retain access to their own payments. Guest capabilities, recovery and remaining admin tools are later phases. No sample members or sessions are shipped.

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
```

`npm test` runs domain and PostgreSQL identity/core-permission tests without Docker. `test:e2e` uses explicit synthetic HTTP fixtures. `test:integration` and `test:e2e:live` use actual local Supabase services and load private values from the ignored `.env.test.local` file. Run real integration and live suites sequentially so their synthetic admins do not overlap. They require Docker and applied migrations; receipt integration also requires Storage and `npm run functions:serve` (see operations guide). `typecheck:edge` uses pinned Deno 2.9.6 through npm's cache, without a machine-level install, and a frozen server dependency lockfile. `db:types:verify` compares every public table/RPC contract with the official local Supabase generator. These are distinct verification layers; unavailable tests are never counted as passing.

[Approved specification](docs/BJBC_Codex_Development_Pack_v1.md) · [Progress and evidence](docs/PROGRESS.md) · [Setup and operations](docs/OPERATIONS.md)
