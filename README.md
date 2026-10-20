# BJBC

Mobile-first badminton club portal. React + Vite + TypeScript + Tailwind, Supabase Auth/PostgreSQL/Storage and Cloudflare Pages. All website copy is English.

## Current phase

Task 1 implements registration, phone/password login, pending/rejected/suspended account status, an active-member foundation and editable display name. The database enforces identity permissions and active membership. Sessions, billing, receipts, guests and admin management are later phases. The application does not contain sample members or sessions.

## Run locally

Use Node 22.12+ (Node 24 recommended).

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Without Supabase configuration, the English screens render and show a setup notice; login and registration stay disabled. To enable them, follow [the operations guide](docs/OPERATIONS.md). Never put backend keys into `VITE_` variables.

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:integration
```

`npm test` runs domain and PostgreSQL identity tests without Docker. Browser tests use explicitly scoped synthetic HTTP fixtures. Real Supabase integration requires Docker, a running local stack, applied migrations and test environment variables; it fails clearly when these are unavailable. These are distinct verification layers.

[Approved specification](docs/BJBC_Codex_Development_Pack_v1.md) · [Progress and evidence](docs/PROGRESS.md) · [Setup and operations](docs/OPERATIONS.md)
