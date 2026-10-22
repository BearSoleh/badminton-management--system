# BJBC
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
React + Vite + TypeScript + Tailwind; Supabase Auth/PostgreSQL/Storage; Cloudflare Pages; GitHub source control. Local development only until deployment is explicitly authorized.

## Users
Members and admins of one badminton club; admins can also play. Guests have a later scoped private flow.

## Product Purpose
Reduce manual coordination of voting, participation, attendance and manual payments.

## Operating Context
Mobile-first club operations, Asia/Kuala_Lumpur calendar, MYR. Tasks 1–4 cover authentication, database/privacy foundations, session drafts/publication, voting, joining, withdrawal, 15-minute waiting-list offers, scheduled expiry and a private in-app inbox. Billing and scoped guests remain later phases.

## Capabilities and Constraints
Approved R01–R18 and D01–D16 in docs/BJBC_Codex_Development_Pack_v1.md govern implementation. Registration uses one name/nickname field, phone and password. Login uses phone/password, no SMS OTP. Admin approval required. No paid services, external notifications or production publication authorized.

## Brand Commitments
BJBC. All user-facing content in English (owner amendment, 20 October 2026). No supplied logo or imagery; the wordmark is typographic.

## Product Principles
Backend enforces rules. Preserve private financial history. Show honest states. Build and verify one authorized phase at a time.

## Accessibility & Inclusion
Narrow-phone layouts, keyboard access, explicit labels, readable contrast and clear loading/error/empty states.
