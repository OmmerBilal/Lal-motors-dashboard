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
| Business RPC foundation | PARTIAL (payments, stock, vehicles done) | Payments and stock/sales RPCs done (0004, 0005), 63/63 tests. Vehicle, receiving, dismantling, part review, scrap, container and export RPCs NOT STARTED |
| Auction Vehicles | BACKEND DONE, UI NOT STARTED | Vehicle RPCs 0006, 55/55 tests. UI still mock data |
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

## Vehicle RPCs (0006) — applied, 55/55

- match_or_create_vehicle(vin, lot, stock, source, fields): VIN, stock, then lot+source matching. Returns created / existing / conflict. Never overwrites. Concurrent intake of the same VIN creates one row (tested with a real race).
- close_vehicle(id, reason, note): soft close, reviewer roles only (owner, engineer_admin, manager), idempotent, event + audit.
- assign_carrier(ids[], carrier, price): bulk, all-or-nothing, rejects closed or in-transit vehicles, inactive carriers.
- update_transport_status(id, to, note): explicit transition table; PROBLEM needs a note; READY_TO_POST needs a price. Central Dispatch external API is NOT called. POSTED_TO_CD is local intent only.
- receive_vehicle(id): needs 4 original ready media rows with roles arrival_front/rear/left/right. Retry by the same employee is a replay; another employee is refused. Parallel receive: exactly one wins.
- Guard triggers still block receiving or dismantling from changing price, carrier, purchase fields (direct client attempts tested).

Known: UI for Auction, Dispatch and Receiving is not yet connected. Next item: Vehicle real-data integration.

## Vehicle read model + Auction Inventory (0007–0010) — 2026-10-04

- Migrations: 0007 read model (vehicle_stage, list_vehicles keyset, vehicle_stage_counts), 0008 carrier filter + vehicle_filter_options, 0009 KPI cards follow the approved card definitions exactly + reopen_vehicle (reviewer only), 0010 list adds engine and arrival_date.
- Tests: scripts/dev-tests/read-vehicles.mjs 23/23 (pagination walk with no duplicates, KPI parity, reopen, reviewer-only reopen, stage filters, search, thumbnail join, carrier filter, scrap driver sees zero vehicles, keyset index usable).
- Frontend: global TanStack QueryClient (src/lib/query/provider.tsx mounted in root layout). Service src/lib/data/vehicles.ts (RPC calls with the signed-in session). Hooks src/lib/query/vehicles.ts with stable keys and targeted invalidation. Mapper src/lib/data/vehicle-record.ts.
- Auction Inventory home (src/components/vehicles/views/auction-inventory-home.tsx): list, search, filters, KPI cards, pagination, close and reopen now come from the database. Markup unchanged.
- STILL MOCK (transitional, must be removed next): intake add paths (bulk, single, manual), vehicle detail, completion, corrections, and the VehicleDataProvider state that Dispatch, Dismantling and Owner dashboard read. Two sources of truth remain until those are moved.
- Known limits: the footer count is the number loaded so far ("+" while more pages exist). Reopen uses a fixed audit note "Reopened from Auction Inventory" (no note dialog yet).
- Verification: tsc clean, eslint clean on src, npm run build exit 0. Not yet verified in a real browser: no browser login was run (credentials are not placed in tool transcripts); mobile viewport QA for this screen is NOT done.

## Intake on the database (0011) — 2026-10-04

- 0011 find_vehicle_match(): read-only identity preview with the same rules as match_or_create_vehicle.
- Intake review: parsing stays local and deterministic (no AI). Duplicate status comes from find_vehicle_match. Confirm calls match_or_create_vehicle per draft (retry-safe, never silently duplicates). Local rows are removed only after the database accepts them.
- AI Photo/Screenshot Scan: NOT connected. The analyze action is disabled with an explicit notice. The canned sample record that used to fake extraction was deleted.
- Update-existing: NOT supported. Existing vehicles are never overwritten. A matched draft commits as a no-op ("already in inventory"). The approved checkbox remains on screen but writes nothing.
- Tests: rpc-vehicles.mjs now 59/59 (includes preview-versus-commit agreement).
- Verification: tsc clean, eslint clean on src, build exit 0. Browser QA for these screens NOT run.
- Still mock: vehicle detail, completion queue, corrections, provider state used by Dispatch, Dismantling, Owner dashboard.

## Central Dispatch on the database (0012–0014) — 2026-10-04

- 0012: carrier directory writes limited to owner, engineer_admin, manager, auction (receiving and dismantling blocked). dispatch_stage_counts() matches the approved KPI definitions.
- 0013: list_vehicles adds pickup address and PIN, transport price and transport problem.
- 0014: assign_carrier_items(): one carrier, a price per vehicle, one atomic batch.
- Tests: scripts/dev-tests/dispatch.mjs 24/24 (carrier write authority, counts vs independent count, one identity from intake to dispatch, per-vehicle prices, batch rollback, duplicate-id refusal, receiving and dismantling blocked).
- UI: central-dispatch.tsx, dispatch-modals.tsx and carrier-directory-modal.tsx read from the database hooks (src/lib/query/dispatch.ts). Success toasts fire only after the database accepts the change.
- Post to Central Dispatch = LOCAL intent only. Central Dispatch external API: NOT CONNECTED. Nothing in code calls an external provider or reports external success.
- Pickup grouping loads every open vehicle (paged until complete). Fine at DEV scale; a server-side grouped read is the next step if inventory grows.
- Still mock: vehicle detail, completion queue, corrections, and provider state read by Dismantling and the Owner dashboard.

## Vehicle Receiving + shared media capture (0015) — 2026-10-04

- 0015: list_vehicles adds received_at.
- Shared MediaCapture (camera or file → preview → upload with progress → retry with the same request id → retake/remove). Upload goes through the existing media API (ticket → signed PUT → complete). Reusable for Dismantling, Scrap and Container Loading.
- Receiving screen: typed lookup via list_vehicles with exact-identifier classification (Not Found / Already Received / Ready). Confirm calls receive_vehicle. Success is shown only after the RPC returns.
- Removed: the fabricated scan (picked a fake vehicle) and the mock problem-logged toast. Problem reporting for receiving is NOT connected and says so.
- Scan / OCR / vision: NOT used and NOT connected. Photos are evidence only.
- Verification: tsc clean, eslint clean, build exit 0. Browser and mobile viewport QA NOT run (see below).
- Known gaps: removing a photo after upload is "Retake" (creates a new evidence row; the old row stays as history). Client-side image compression is not implemented (server limit is 15 MB).

## Dismantling RPCs (0016-0018) - 2026-10-04

- 0016: start_dismantling_session, begin_dismantled_part, abandon_dismantled_part, finish_dismantling_session, flag_dismantling_issue. Retry keys on vehicle_events and parts. One active session per vehicle is enforced by the existing unique index.
- 0017: abandon marks the capture rejected, not_sellable and operational MISSING, because the schema forbids rejected parts from being AVAILABLE. Nothing is deleted.
- 0018: the completed-session part count excludes abandoned captures.
- Test: scripts/dev-tests/rpc-dismantling.mjs, 45/45.
- Rule choices, recorded: a vehicle is refused as ALREADY_DISMANTLED when its status is Dismantled, Completed or Scrapped, or a completed session exists. Finish requires at least one ready vehicle evidence photo, and every captured part must have a ready photo or be abandoned. Only the session's own employee can finish or flag.
- UI: the Dismantling Employee App is not yet connected (next step).

## Dismantling Employee App connected (2026-10-04)

- Data: src/lib/data/dismantling.ts (guard lookup, resume, RPC wrappers with stable hint codes).
- Part capture: src/components/dismantling/part-capture-slot.tsx begins the part row first (idempotent request id), then uses the shared MediaCapture against that part. Discard only before a photo exists.
- Vehicle evidence: MediaCapture with owner dismantling_session, role vehicle_evidence. Finish is disabled until at least one evidence photo exists.
- Issue flagging needs an active session. Outside one, the app says the issue was not saved.
- Removed: simulated scan, guessed part types and review states, simulated processing timer, simulated upload-failed card, the "(mock)" issue toast.
- Checks: tsc clean, eslint clean, build exit 0.
- Not run: browser and viewport QA. Module 04 stays [PARTIAL] until that passes.
