# LAL Motors — Backend Implementation Progress (DEV)

Persistent resume point. A future session should read this first, then check `git log` and the
live DEV database, in that order. Never put secrets in this file.

Last updated: 2026-10-04

## Environment

- Supabase DEV project ref: `sprbyaagxbnoupapqgio` (DEV only, not production)
- Secrets live only in `.env` / `.env.local` (git-ignored). `dev-test-credentials.json` is generated
  DEV test-user data and is git-ignored. Never print or commit any of them.
- Env key names differ from Supabase defaults: `secret_key` (service role), `connection_string`
  (Postgres), `publisher_key` (publishable). `.env` holds `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Next.js 16.3.7. Route protection lives in `src/proxy.ts` (Next 16 convention, must sit beside `app/`).
- Production: NOT created. Nothing was pushed or deployed.

## Migrations applied to DEV

| File | Status | Notes |
|---|---|---|
| `supabase/migrations/0001_initial_schema.sql` | Applied before the restart | Schema, RLS, triggers, helpers. Do not edit. |
| `supabase/seed.sql` | Applied (data present) | 10 DEV users, roles, sample records. |
| `supabase/migrations/0002_auth_account_status_and_access.sql` | Applied this session | `is_active_account()`; `has_role` / `has_any_role` require an active account; `current_access()` RPC. |
| `supabase/migrations/0003_storage_buckets.sql` | Applied this session | Buckets `operational-media`, `confidential-export-media`. Private. |

Rule: all future schema changes are new additive files (`0004_…`). Never edit an applied file.

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| Database foundation | DONE | 0001 applied; 45 tables, RLS on all 45, 71 policies |
| Auth / RBAC | DONE (server + DB), browser UI not yet tested | RLS matrix 114/114; route gate 34/34 |
| Storage / media | DONE (API + service), upload UI not built | media flow 24/24 |
| Business RPC foundation | PARTIAL | Payments and stock/sales RPCs done (0004, 0005), 63/63 tests. Vehicle, receiving, dismantling, part review, scrap, container and export RPCs NOT STARTED |
| Auction Vehicles | NOT STARTED | UI is still mock data |
| Central Dispatch | NOT STARTED | |
| Receiving | NOT STARTED | |
| Dismantling Employee | NOT STARTED | |
| Dismantling Processing | NOT STARTED | |
| Parts | NOT STARTED | |
| Customers | NOT STARTED | |
| Sales | NOT STARTED | |
| Payments | NOT STARTED | |
| Scrap | NOT STARTED | |
| Containers | NOT STARTED | |
| Export | NOT STARTED | |
| Owner Dashboard | NOT STARTED | |
| Admin AI | NOT STARTED | |
| Mobile Regression | NOT RUN | Only the login gate was reviewed in code |
| Security Regression | PARTIAL | RLS matrix + route gate + media bypass tests |
| Performance Regression | NOT RUN | See known issues (proxy latency) |
| Full E2E | NOT RUN | |
| Production Build | see last section | |

## Auth / RBAC — what is implemented

- Supabase Auth is the only identity. `auth.users` → `profiles` (trigger `handle_new_auth_user`) →
  `user_roles` → `roles`. No separate password table.
- 10 DEV users exist, one per role: owner, engineer_admin, manager, employee (Warehouse),
  auction, receiving, dismantling, scrap_driver, container_loading, export_manager.
- `account_status` (`active` / `disabled` / `removed`) is enforced in every RBAC predicate (0002).
- Server gate `src/proxy.ts`:
  - no session → `/login?next=…`
  - `/api/*` without session → JSON 401
  - disabled / removed / no-role → local sign-out, redirect to `/login?reason=…`
  - route not allowed for the role → redirect to that role's home
  - session cookie refreshed on every request
- Route map: `src/lib/auth/route-access.ts`. It mirrors `src/lib/nav.ts`. Default-deny for unlisted
  paths except Owner. Owner is allowed everywhere.
- Navigation is not authorization. RLS and the mutation triggers remain the authority.
- Clients: `src/lib/supabase/{client,server,admin}.ts`. `admin.ts` is `server-only` and holds the
  service key.

## Storage / media — what is implemented

- Buckets are private (0003). No `storage.objects` policy exists for `anon` or `authenticated`, so
  a client cannot read or write bytes directly.
- Path: `<owner_type>/<owner_id>/<client_request_id>/<variant>.<ext>`. Idempotent per client request.
- Service `src/lib/media/media-service.ts`:
  - `createUploadTicket`: metadata row written through the caller's RLS session
    (`can_access_media` and `media_owner_exists` decide). Returns a signed PUT URL.
  - `completeUpload`: checks the real bytes with sharp (not the declared MIME), writes WebP `medium`
    (1600px) and `thumbnail` (400px) variants locally, marks the original `ready`. Non-images are
    marked `failed`.
  - `getReadUrl`: signed read URL, 300 s. Lists use `thumbnail`, detail uses `medium`, `original`
    only on explicit request.
- API: `POST /api/media/upload-ticket`, `POST /api/media/complete`, `GET /api/media/url`.
- Export owner types (`export_invoice`, `export_payment`) go to the confidential bucket.
- No OpenAI or any external AI is used for resizing, compression or thumbnails.

## Tests (re-runnable, in `scripts/dev-tests/`)

Each script reads its config from the git-ignored env files and needs the dev server on
`localhost:3100` for the HTTP tests. Run from the repo root:

```
node scripts/dev-tests/rls-matrix.mjs     # direct DB as each role, plus write/RPC bypass attempts
node scripts/dev-tests/route-gate.mjs     # per-role HTTP route gate (needs dev server)
node scripts/dev-tests/media-flow.mjs     # media upload/variants/RLS/bypass (needs dev server)
node scripts/dev-tests/apply-migration.mjs supabase/migrations/000N_….sql   # one migration, in a transaction
```

Results on 2026-10-04:

- `rls-matrix`: 114 / 114 pass. Covers 10 roles, allowed and forbidden reads, a disabled-account
  case (restored afterwards), direct write bypasses, RPC bypass, and anonymous access.
- `route-gate`: 34 / 34 pass. Covers allowed routes, role-home redirects, and disabled-account
  sign-out.
- `media-flow`: 24 / 24 pass. Covers upload, retry, variants, read URLs, cross-role denial,
  owner-existence check, input validation, fake-image rejection, storage bypass, and cleanup.

## Known gaps and risks (not yet resolved)

1. Frontend is still mock-data for every module. Auth and the media API are real; no screen reads
   business data from Supabase yet.
2. No upload UI exists. Camera capture, progress, retry, preview, retake and remove are not built.
3. No business RPCs exist. Blueprint §15–16 defines the catalog. Until they are built, several
   operations (payment allocation, reservations, audit writes, receiving) cannot be performed by
   anyone, by design.
4. Proxy latency. In dev, each navigation costs about 0.8 s in `proxy.ts` (`getUser` plus
   `current_access`). Measure before optimizing; a cookie-based claims check is one option.
5. HEIC/HEIF decoding depends on the sharp/libvips build. Not verified on this machine.
6. The 0001 seed file uses placeholder profile UUIDs. The live DEV seed ran against the real
   auth UUIDs. Keep the seed file as a reference only.
7. Export immutability (finalized invoices) has no seeded finalized row, so that trigger was not
   exercised by the matrix.
8. The browser login flow has not been exercised in a real browser. Only server-side gating was
   tested over HTTP.
9. No Supabase-generated TypeScript types yet. Shapes are hand-written.
10. `claude.txt` says UI-only. The later backend brief explicitly overrides that for DEV.

## Git

- Repo: `new-production/` on `main`. `legacy-reference/` is read-only and was not touched.
- No force pushes. No pushes at all.

## Production Build

Last run 2026-10-04 on the commit that added storage (`8a80fd8` and its predecessors):

- `npm run build`: exit 0. All app routes and the media API build. The proxy builds as a Node proxy.
- `npm run lint`: 0 errors, 0 warnings.
- `tsc --noEmit`: clean.

Re-run all three before each commit.

## Performance — auth overhead (measured 2026-10-04, production build, DEV region)

Measured with `scripts/dev-tests/bench-nav.mjs` (real sign-in, real cookie, 15–30 runs, median).

| Measurement | Before | After |
|---|---|---|
| Proxy overhead on an authenticated request (fast API route) | 777 ms | 15 ms |
| Authenticated `/sales` full load (proxy + render) | 1144 ms | 51 ms |

Individual auth calls (`bench-auth-calls.mjs`): `getUser()` remote 394 ms; `getClaims()` local 2 ms;
`current_access()` 388 ms.

What changed and why it is safe:

- Identity: `getClaims()` verifies the ES256 JWT signature locally, in the proxy, the `(app)` layout,
  and the browser session. Session refresh still runs in the proxy.
- Role and status: cached per user for 15 s (`src/lib/auth/access-cache.ts`), used only for the
  route gate. Forced sign-outs evict the entry immediately.
- Data access is NOT cached. Every RLS policy and mutation trigger checks `is_active_account()` on
  each query, so a disabled or de-roled user loses data access at once. The only window is which
  app shell loads, for at most 15 s. `route-gate.mjs` waits out that window before asserting.
- `auth.getUser()` remains only in `media-service.ts` (one call per upload, not per navigation).

Remaining: the 51 ms page is mock-data rendering. Re-measure after each module moves to real data.

## Business RPCs — payments and stock (0004, 0005)

All are SECURITY DEFINER, fixed search_path, and check auth.uid() plus role inside the body.
EXECUTE is granted to authenticated only. Errors use SQLSTATE 42501 forbidden, 22023 invalid input,
P0001 business rule. Every state change writes write_audit_log().

| RPC | Who | Behaviour |
|---|---|---|
| create_payment | sales staff | Creates PENDING only. Idempotent by client_request_id. Does not touch sale money. |
| allocate_payment | sales staff | Locks payment and sale. Checks same customer, total <= payment amount, <= outstanding (excluding other pending allocations). Idempotent per (payment, sale). |
| post_payment | sales staff | Requires the full amount allocated. Locks each sale in id order and updates amount_paid, balance_due and payment_status atomically. Rejects overpayment. |
| void_payment | pending: sales staff; posted: owner or engineer_admin | Requires a reason of 5+ characters. Posted payments are reversed on each sale. Rows are kept as history. |
| create_sale | sales staff | Modes: draft (no stock change), reserve, fulfill_now. Idempotent by client_request_id. Locks parts in id order and checks availability. Any failure rolls back everything. |
| reserve_stock | sales staff | Reserves draft part lines of an OPEN sale. Physical quantity unchanged. |
| release_reservation | sales staff | Releases active reservations and returns lines to draft. |
| fulfill_sales_order | sales staff | Consumes stock for reserved lines. Retry-safe. Sold-out rows stay visible. |

Money uses NUMERIC with 2-decimal validation. No floating point is used anywhere.

Tests: `scripts/dev-tests/rpc-money-stock.mjs`: **63 / 63** pass. Coverage:
authorization (employee, scrap driver, export manager, anon), validation, the full payment
lifecycle (E2E test 4), direct update of a posted payment blocked, owner-only reversal,
over-allocation, cross-customer allocation, parallel payment race (exactly one succeeds),
stock E2E test 2 (reserve, oversell refused, release, reserve, fulfill, quantity 0 stays visible),
fulfill-now immediate consumption (E2E test 3), idempotent retry, multi-line rollback (no sale row,
no stock consumed), and a parallel reservation race for the last unit (exactly one succeeds).

Regression: `rls-matrix.mjs` still 114/114 after 0004 and 0005.

Not yet covered by an RPC: the Scrap, Container and Export flows, the Finalized-invoice immutability
test (needs an Export module), and the Vehicle / Receiving / Dismantling / Part-review RPCs.
