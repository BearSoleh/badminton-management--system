# BJBC
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
React + Vite + TypeScript + Tailwind; Supabase Auth/PostgreSQL/Storage; Cloudflare Pages; GitHub source control. Local development only until deployment is explicitly authorized.

## Users
Members and admins of one badminton club; admins can also play. Sponsored or admin-verified guests use private invitations scoped to one session and their payments.

## Product Purpose
Reduce manual coordination of voting, participation, attendance and manual payments.

## Operating Context
Mobile-first club operations, Asia/Kuala_Lumpur calendar, MYR. Tasks 1–7 cover authentication, database/privacy foundations, sessions, voting, joining, withdrawal, timed waiting-list offers, scheduled expiry, in-app notifications, admin attendance, manually determined fee publication, private receipts, bank verification, cash, payment history, audited cancellation/refund/fee adjustments, scoped guest invitations/payments, verified account linking and admin-assisted password recovery. Remaining general admin tools stay in Task 8.

## Capabilities and Constraints
Approved R01–R18 and D01–D16 in docs/BJBC_Codex_Development_Pack_v1.md govern implementation. Registration uses one name/nickname field, phone and password. Login uses phone/password, no SMS OTP. Admin approval required. No paid services, external notifications or production publication authorized.

## Brand Commitments
BJBC. All user-facing content in English (owner amendment, 20 October 2026). No supplied logo or imagery; the wordmark is typographic.

## Product Principles
Backend enforces rules. Preserve private financial history. Show honest states. Build and verify one authorized phase at a time.

Guest names and unverified phone numbers are identity details, never credentials. Guests may reserve/use at most two non-cancelled participations before creating and linking an account. Private invitations exchange once; access lasts up to 30 minutes in browser memory. Reloading requires an admin reissue. Recovery requires identity verification outside the app, a 15-minute single-use link and no password sharing. All private links are shared manually; the app sends no message.

## Accessibility & Inclusion
Narrow-phone layouts, keyboard access, explicit labels, readable contrast and clear loading/error/empty states.
