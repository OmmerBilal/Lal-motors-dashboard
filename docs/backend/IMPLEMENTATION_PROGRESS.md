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

## Dismantling processing RPCs (0019-0021) - 2026-10-04

- 0019: approve_dismantled_part, edit_and_approve_part, reject_dismantled_part, mark_part_duplicate, keep_part_for_review. Same part row throughout. Approval is idempotent. Rejected and duplicate parts are not sellable (MISSING, not_sellable, reason kept). Duplicate target must be approved. Queue (keyset, thumbnail join) and one grouped summary read.
- 0020: queue function fixed (ambiguous RETURNS TABLE names; #variable_conflict use_column). Found because the first test run got zero rows and an error that was being swallowed. The test now asserts the call succeeds.
- 0021: queue and needs-review count include only captures with a ready photo. An in-progress upload is not a review item.
- Test: scripts/dev-tests/rpc-processing.mjs, 57/57.
- UI: not connected yet. Next step: dismantling-processing components on the summary and queue RPCs.

## Dismantling processing UI connected (2026-10-04)

- 0022: list_dismantling_completions and list_dismantling_roster (role-checked, return the names managers may see; direct profile reads are owner and engineer only).
- 0023: approve and edit-approve accept part_number (the approved edit dialog has an OEM field).
- Hook: src/components/dismantling-processing/use-dismantling-data.ts now reads the database (keeps the same exported names and shapes). Mutations: src/lib/query/processing.ts (invalidates the processing namespace only).
- Decisions go through RPCs and toast success only after the RPC returns. Duplicate target = most recent approved part on the same vehicle (shown in the toast).
- Removed fabricated OEM suggestions (formerly derived from the part id). Notes field is disabled and labelled not stored (no notes column).
- Checks: tsc clean, eslint clean, build exit 0. Browser and viewport QA NOT run.

## Customers backend (0024-0025) - 2026-10-04

- 0024: normalize_phone (digits, leading 1 removed), create_customer and update_customer (possible_duplicate returns matches and writes nothing until confirm_new), list_customers (keyset on last, first, id; lightweight DTO), customer_history (sales, payments, balance owed; detail only). Sales staff only.
- 0025: list_customers casts citext email to text (found by the test).
- Test: scripts/dev-tests/rpc-customers.mjs 36/36.
- Transient note: one run failed with a pooler auth timeout (EAUTHTIMEOUT), not a test failure. Re-run passed.
- UI: not connected. Next: customers screens on list_customers, create_customer and customer_history.

## Module 06 Parts Inventory (0026-0027) - 2026-10-04

- Sellability fix (found in review): _available_quantity counted quantity for any part, so a rejected, duplicate or not-sellable part could be reserved. Sellable now requires approved, ready_for_sale and no not-sellable reason. Regression: rpc-money-stock 63/63.
- Tests: scripts/dev-tests/rpc-parts.mjs 57/57 (roles, warehouse field edits and protected fields, stage transitions and readiness, sellability on the sales path, zero quantity visibility, rejected/duplicate protection, operational state, detail, pagination and search, thumbnail column).
- Migration-file lesson: SQL generated through shell quoting lost quote characters three times ('' and '%'). Write migration files with the file tool and check them with the apply step.
- UI: parts-data-context.tsx is DB-backed with the same API. part-detail-view reads donor, session, photo ids and history on demand, and the AI trigger is a not-connected message. capture-view no longer reports a saved part.
- Not connected: warehouse capture (no donor), photo capture on existing parts from the Parts views, barcode scanning, label printing.
- Next: browser and viewport QA for Parts, then the Customers UI (Module 07), then Module 08.

## Customers UI connected (0028) - 2026-10-04

- 0028: list_customers returns last and first name so the keyset cursor is built from the real row. (The UI first passed the display name, which was wrong; found while wiring.)
- Data: src/lib/data/customers.ts; hooks: src/lib/query/customers.ts (targeted invalidation on customers only).
- Context: sales-data-context customers come from the database. saveCustomer, findDuplicates and addDocument are removed.
- Modal: possible duplicates shown with matches; Create anyway calls with confirm_new. Tax document upload says not connected.
- Detail: header from the record; sales and payments from customer_history; quotes still mock (Module 08).
- Checks: tsc clean, eslint clean, build exit 0. Tests rpc-customers 36/36. Browser QA NOT run.
- Known: owner-ai.ts still reads mock customers for the AI command center (Module 16).

## Module 08 and 09 checkpoint (2026-10-04)

- Migrations applied on DEV: 0029, 0030, 0031 (customer quotes), 0032 (payments read models, direct payment INSERT revoked).
- Test results: rpc-quotes-sales 68/68 and rpc-payments 57/57 before the DEV database became unreachable. Money-stock, parts, customers and RLS matrix were not rerun after 0032; the rerun is the first open item.
- Static checks at this checkpoint: tsc clean, lint 0 errors (2 pre-existing warnings in scripts/dev-tests), build passes.
- Browser and viewport QA: not run. Modules 08 and 09 are [PARTIAL].
- Known gaps: customer tax exemption not applied server-side; core charge and deposit unsupported by backend; returns, AI assistant and ID scan not connected; no payment numbering.

## Module 08 and 09 browser and regression pass (2026-10-04)

Verified against DEV (Postgres reachable again):
- rpc-quotes-sales 68/68, rpc-money-stock 63/63, rpc-parts 57/57, rpc-customers 36/36, rpc-payments 63/63 (after migration 0034 and its regression check), rls-matrix 114/114.
- Browser E2E (scripts/dev-tests/e2e-sales-payments.mjs, local Chromium via playwright-core): 137/137 in the last full run before the final pending-payment responsive checks were added. That run covered the quote path (create, reload, edit, approve, convert RESERVE, fulfill, reload), POS FULFILL NOW with Out of Stock visibility, zero-stock not addable, double-submit creating one sale, pending/allocate/post/void with balance checks, wrong-customer picker, over-allocation, double post, invalid void, and the security RPC matrix for anonymous, receiving, dismantling, scrap driver, container loader and employee roles.
- Responsive: viewports 390, 430, 768, 1366, 1440 (actual innerWidth asserted). Checked for horizontal overflow on POS, quotes, sales, payments, sale detail, payment detail, and the create-payment dialog.
- Migration 0034 fixed a real defect: void_payment returned the payment row for an already-voided payment before the role check. Now authorized first; regression check added.
- Migration 0033 (POS thumbnails): endpoint verified (200 for sellable parts, 400 for invalid ids, batched POST, no per-card or original-image requests). Positive thumbnail image load NOT verified: DEV has no processed thumbnail objects.
- tsc clean; lint 0 errors and 0 warnings; build passes.

Superseded by the final completion pass below.

## Module 08 and 09 final completion pass (2026-10-04): both DONE

Status: Module 08 = [DONE], Module 09 = [DONE].

Browser E2E (scripts/dev-tests/e2e-sales-payments.mjs, local Chromium, DEV): 185 passed, 0 failed, exit 0. One final complete run after the last test fix.
- Module 08: quote create, save and reload, edit persisted, approve, convert with RESERVE, RELEASE and repeated release, fulfill and repeated fulfill, repeated conversion protection, POS FULFILL NOW, zero-stock visible as Out of Stock and not addable, double submit creates one sale, server quote and sale numbers, Parts Inventory keeps Out of Stock, POS thumbnail image rendered through a signed private URL, placeholder for a part without a thumbnail, batched thumbnail requests with no per-card media calls.
- Module 09: create payment PENDING, allocation with balance unchanged before POST, over-allocation refused, POST updates amount_paid, balance_due and payment_status, partial and full payment, double-post blocked, invalid void refused, owner reversal restores the balance, manager denied reversal of a posted payment, already-voided payment denied to unauthorized roles, authorized retries idempotent, history and audit preserved.
- Security matrix: anonymous and non-sales roles denied on quote, sale, reserve, fulfill, payment create/allocate/post/void/read, sales read; authorized manager accepted.
- Responsive (actual innerWidth asserted at 390, 430, 768, 1366, 1440): no horizontal overflow on POS, quotes, quote detail, sales, sale detail, payments, payment detail, create-payment dialog, void dialog; allocate control inside the viewport; posted state shows no Post control.

Backend regressions (DEV, one pass after all browser fixes): rpc-quotes-sales 68/68, rpc-money-stock 63/63, rpc-parts 57/57, rpc-customers 36/36, rpc-payments 70/70 (was 63; 7 new checks for migration 0034: already-voided payment denied to unauthorized roles, authorized retries idempotent), RLS matrix 114/114.

Static checks: tsc --noEmit exit 0; npm run lint 0 errors; npm run build exit 0.

Fixes made in this pass:
- Test: POS card locator matched the results panel. Cards are now found by exact SKU via data-testid, and checked by part id.
- Test: customer selection was a retry loop on a name regex. It now waits for the list_customers response and clicks the option by customer id (new data-testid on the option).
- Test: placeholder check ran after the zero-stock card had left the results; moved to when it is rendered.
- Test: thumbnail batch count included the Parts page that follows; counted on the POS screen only.
- Test: suite had no closing summary or non-zero exit; added.
- Application: test hooks only (data-testid, data-sku, data-part-id, data-customer-id) on the POS card, cart line and customer option. No behavior change.
- Application: none. The in-stock Add button was never wrongly disabled; the backend returns available 1 for an in-stock fixture.

Known gaps outside Modules 08 and 09 (not changed):
- customers.customer_number is null for every new customer. create_customer does not assign a number and there is no generator. It shows blank in the POS selection and on printed invoices. A number format is not defined in the docs, so none was invented.
- Payments have no sequence number yet.

## Modules 10 and 11 technical closure (2026-10-05)

Status: Module 10 = IMPLEMENTATION COMPLETE — MANUAL QA PENDING. Module 11 = IMPLEMENTATION COMPLETE — MANUAL QA PENDING.

Migrations: 0035 (schema, guards, access tightening), 0036 (read views, RPCs), 0037 and 0038 (review fixes), 0039 (payments list carries load ids).

Automated results (DEV, run one at a time):
- rpc-scrap 182/182; scrap-smoke 14/14 (driver 390px and 1440px, manager 390px and 1440px)
- rpc-quotes-sales 68/68; rpc-payments 70/70; rpc-money-stock 63/63; rpc-parts 57/57; rpc-customers 36/36
- RLS matrix 114/114; media-flow 24/24; route-gate 34/34
- rpc-vehicles 59/59; rpc-processing 57/57; rpc-dismantling 45/45
- tsc --noEmit exit 0; npm run build exit 0; scrap lint clean

Known out of scope (not changed): PartsDataProvider loads the parts list on every page and gets a 403 for roles without Parts access (visible in console only). customers.customer_number is null for new customers; nothing assigns it.

## Modules 12, 13 and 14 technical completion (2026-10-05)

Status: Module 12 = IMPLEMENTATION COMPLETE — MANUAL QA PENDING. Module 13 = IMPLEMENTATION COMPLETE — MANUAL QA PENDING. Module 14 = IMPLEMENTATION COMPLETE — MANUAL QA PENDING.

Migrations (additive): 0040 container loading (server reference T##-###, loader-safe column grants and view, evidence only while loading via trigger, container number format and uniqueness, loader RPCs). 0041 export management (read-only policies replace the former "for all" policies; consignee master; invoices draft → review → finalized with server number and consignee snapshot; revisions as new rows; payments with NUMERIC balance, overpayment refused, reversals as reference rows; shipping and close rules). 0042 owner dashboard read models (summary, employees, activity; owner only; range filtered in SQL).

Automated results (DEV, sequential):
- rpc-containers 173/173 (loader and export lifecycles, immutability, reversal, concurrency, role matrix)
- rpc-owner-dashboard 32/32 (authorization, range guards, aggregates compared with independent queries, empty range)
- containers-owner-smoke 19/19 (loader 390px, export 1440px, owner 390px and 1440px)
- scrap-smoke 14/14; rpc-scrap 182/182
- route-gate 34/34; RLS matrix 114/114; media-flow 24/24
- rpc-quotes-sales 68/68; rpc-payments 70/70; rpc-money-stock 63/63; rpc-parts 57/57; rpc-customers 36/36
- rpc-vehicles 59/59; rpc-processing 57/57; rpc-dismantling 45/45
- tsc --noEmit exit 0; npm run lint 0 errors, 0 warnings; npm run build exit 0

Contract changes to note (deliberate):
- container_jobs is column-restricted for authenticated clients. Consignee-era close fields (closed_by, close_override_reason) are no longer readable by loaders. The RLS matrix visibility check for container_jobs now counts the granted columns; every other table check is unchanged.
- Owner dashboard trend captions were fabricated mock text ("+3 this week" and similar). They are replaced with truthful descriptions of the number.
- Owner dashboard grid child gets min-w-0 so the frozen layout does not overflow on phones. No visual change on desktop.

Known, not changed: the session bootstrap in src/lib/session.tsx waits on two client-side Supabase REST reads; one run observed the profiles read pending for 25 seconds with no error. Recorded as an intermittent environmental observation.
Known, not changed: owner dashboard still imports the pure helpers in src/lib/mock/owner-dashboard.ts (stage type and the mock rules, unused for numbers now). The mock containers and scrap files remain for other non-dashboard references.
Policy decisions to confirm: export access stays owner, engineer admin, export manager (manager excluded, unchanged). Closing a container requires a zero balance; there is no override in this version.
