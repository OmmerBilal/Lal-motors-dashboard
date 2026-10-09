# LAL Motors — Complete Project Guide

**Status of this document:** written from direct inspection of the current repository — the actual source files, the
actual `supabase/migrations/*.sql` (75 files, applied to the DEV database), and actual test-run output — not from the
older planning documents in `docs/backend/`. Where this guide states a fact about behaviour, it is because the
relevant code or migration was read (or, for several modules this pass, exercised against DEV and verified). Where
something is inferred rather than confirmed, it is labelled **(assumption)**. Treat this file, together with the
code itself, as the primary reference; treat `docs/backend/*` as historical planning context (see §16).

Repository: `new-production` (local path `lul-motors/new-production`). Current branch at time of writing: `main`.
Latest commit inspected: `7f13e9bd` ("Warehouse Employee App: simple inventory location workspace"), 94 commits on
`main`, 75 applied migrations.

---

## 1. Project overview

**Business:** LAL Motors buys vehicles at auction, intakes them, dismantles them for parts, sells parts (in-store and
export), and separately runs a scrap-metal recycling operation with its own drivers and reconciliation. The product
is the internal operating system for this business: one database, one set of real people with roles, one
browser app with a role-specific workspace per person.

**Stack:**
- **Next.js 16** (App Router, React 19), **TypeScript**, **Tailwind CSS v4**.
- **Supabase** (hosted Postgres + Auth + Storage). All business logic that matters lives in **Postgres functions
  (RPCs)**, not in server actions or API routes — the browser calls `supabase.rpc(name, args)` directly for almost
  everything. A thin Next.js **API route layer** exists only for things an RPC cannot do: signed media URLs, and the
  AI integration (which must keep the OpenAI key server-side).
- **TanStack Query** for client data fetching/caching (`src/lib/query/*`), **base-ui** component primitives wrapped
  in `src/components/ui/*` (shadcn-style), **sonner** for toasts, **Zod** for AI tool-argument validation, **sharp**
  for server-side image processing.
- No separate backend service: Postgres (via RPC), Supabase Auth, and Supabase Storage are the entire backend.

**Architectural principles, consistently applied across the whole codebase (verified in many modules this session):**
1. **One source of truth per business entity.** One `vehicles` row per vehicle (shared by auction intake, receiving,
   dismantling, dispatch — never copied between modules). One `parts` row per part (shared by dismantling capture,
   Parts Inventory, the Sales desk, Warehouse, and Container planned-parts — again, referenced, never copied). One
   `profiles` row per person; roles are layered on with `user_roles`, never a second identity table per role.
2. **The database is the authority, not the browser.** Every state transition, money calculation, stock decrement,
   duplicate check and permission check happens in a `SECURITY DEFINER` Postgres function that re-validates
   everything itself (role, current row state, arithmetic) — a client sending a "nicer" payload cannot bypass it.
   Client-side logic (e.g. the auction-paste parser, form validation) is for UX responsiveness only; the server
   re-checks the same rules before committing.
3. **Idempotency by client request id.** Any "create" RPC that a flaky connection might retry takes a
   `p_client_request_id uuid`; the first call creates the row, a retry with the same id returns the same row instead
   of creating a second one.
4. **Append-only history, never silent overwrite.** State changes write a history/event row (`part_operations`,
   `vehicle_events`, `container_events`, `scrap_load_events`, `audit_logs`, …) alongside the row update. A
   correction is typically a *new* row referencing the old one (see export invoice revisions, scrap payment
   corrections), not an edit that destroys the previous value.
5. **Role-scoped, additive migrations.** Nothing in `supabase/migrations/0001...` is ever edited once applied,
   because migration state in DEV tracks what has actually been run. Every later migration is additive: new
   columns, new functions (`create or replace function ...`), new tables, or an explicit `revoke`/`grant` change —
   never a rewrite of an earlier file. This guide's §6/§7 reflect the *latest* `create or replace` of each function.
6. **Private media only.** Both Storage buckets are private; the browser never gets a public URL, only a
   short-lived signed URL after a server-side permission check (§9).

---

## 2. Repository map

```
new-production/
├── src/
│   ├── app/                     Next.js App Router: pages (route segments) and API routes
│   │   ├── (app)/                One route group per module, each with its own page.tsx (§4)
│   │   ├── api/                  Server-only routes: media signing, AI (§9, §10)
│   │   ├── login/, accept-invite/, reset-password/   Auth pages (outside the (app) shell)
│   ├── components/               React components, one directory per module (mirrors src/app/(app)/*)
│   │   └── ui/                   Design-system primitives (button, dialog, table, …) — shared, generic
│   ├── lib/
│   │   ├── data/                 One RPC-calling function per server operation, grouped by module
│   │   ├── query/                TanStack Query hooks wrapping lib/data (cache keys, invalidation)
│   │   ├── supabase/             The three Supabase client factories (§11)
│   │   ├── auth/                 route-access.ts — the route protection table
│   │   ├── ai/                   AI integration: config, tool registry, streaming, provider errors
│   │   ├── mock/                 NOT mock data in the "fake backend" sense — see note below
│   │   ├── media/                media-service.ts — the one place upload/signing logic lives
│   │   ├── dismantling/          Small pure helpers (part classification)
│   │   ├── nav.ts, types.ts, session.tsx, effective-user.ts, receive-eligibility.ts, log.ts, utils.ts
│   ├── middleware.ts (not inspected individually; route gating is in src/lib/auth/route-access.ts, enforced by
│     the (app) layout / middleware pairing — confirmed behaviourally via route-gate.mjs, §12)
├── supabase/
│   └── migrations/               75 numbered, additive SQL files — THE schema and backend logic (§6, §7)
├── scripts/dev-tests/            67 Node test/QA scripts, no framework (§12)
├── docs/backend/                 Pre-existing planning docs — historical, see §16
├── public/                       Static assets
├── LAL_MOTORS_COMPLETE_PROJECT_GUIDE.md   This file
├── AGENTS.md / CLAUDE.md         Editor/agent instructions (not business documentation)
├── package.json, tsconfig.json, eslint.config.mjs, next.config.ts, components.json, postcss.config.mjs
```

**Note on `src/lib/mock/`:** despite the directory name, several files here (`vehicles.ts`, `parse-intake.ts`) are
**not** a fake backend — they are the real `VehicleRecord` TypeScript type, the real field list used by the
Auction Bulk Import parser, and the real client-side intake parsing logic described in §5 and §7. The "mock" name
is a holdover from an earlier prototype phase; `vehicles.ts` specifically defines the shape every intake draft is
built into before the server re-validates it. Other files under `mock/` (e.g. `pos.ts`, `central-dispatch.ts`) hold
shared display types/formatters used by their respective real, database-backed modules. None of this directory
fabricates data that reaches the database unvalidated — every write still goes through an RPC.

**Excluded from the file-by-file index (§3):** `node_modules/`, `.next/`, build artefacts (`next-env.d.ts`,
`tsconfig.tsbuildinfo`), `public/` static assets, and `src/components/ui/*` (24 generic design-system primitives —
listed as a group in §3.7, not individually, because they are standard shadcn-pattern wrappers around base-ui with
no business logic: button, dialog, table, select, etc.). Everything else first-party (255 `.ts`/`.tsx` files under
`src/`, plus 75 migrations and 67 test scripts) is accounted for, individually where that adds value, by directory
with a stated inclusion criterion where an individual listing would not.

---

## 3. File-by-file code index

### 3.1 `src/lib/data/` — one RPC-calling module per business area (verified: every exported function wraps exactly
one `supabase.rpc(...)` call or a thin read query, and maps/throws a user-facing error message; none contains
business logic itself)

| File | Responsibility |
|---|---|
| `vehicles.ts` | Vehicle list/KPI reads, close/reopen, intake preview/evaluate/commit (the Auction Bulk Import server contract, §5/§7.1), carrier list/add, dispatch counts, carrier assignment, transport status updates |
| `vehicle-record.ts` | Single-vehicle detail read/edit used by the vehicle detail view |
| `vehicle-workspace.ts` | Reads behind the Auction/Vehicle workspace shell: pending intake batches, vehicle KPIs, etc. |
| `receiving.ts` | Vehicle Receiving & Arrival: eligibility, receive action, arrival photo state |
| `dismantling.ts` | Legacy (pre-v2) dismantling reads/writes, kept for any remaining callers |
| `dismantling-v2.ts` | Current dismantling workflow: readiness, assignment, session start, part capture/save, Finish (§5.3) |
| `processing.ts` | Vehicle Dismantling Processing (management review of dismantling work): queues, completion approval |
| `parts.ts` | Parts Inventory reads/writes: list, field edits (`update_part_fields`), lifecycle actions |
| `manual-part.ts` | `createManualInventoryPart` — the one RPC that adds an inventory part with no donor vehicle |
| `warehouse.ts` | Warehouse Employee App: summary, bounded list/search, part detail + history, `warehouse_set_location` |
| `customers.ts` | Customer master CRUD/search |
| `quotes.ts` | Quote creation/line validation, quote→sale conversion |
| `sales.ts` | Sales desk: sellable-part search, create_sale (draft/reserve/fulfill_now), sale detail |
| `sales-checkout.ts` | One-step checkout with payment, customer outstanding balance, receive-payment-from-customer |
| `payments.ts` | Payment/allocation reads for the Payments view |
| `scrap.ts` | Scrap Driver + Scrap Management: loader/driver RPC wrappers, manager summary/list/detail, planned-load office RPCs (§5.5) |
| `containers.ts` | Container Loading + Export Management: loader RPC wrappers, export container/invoice/payment RPCs, planned-parts office RPCs (§5.6) |
| `owner-dashboard.ts` | Owner Dashboard KPI/read models |
| `team.ts` | Team & Users: list, invite, role/status changes, activity reads |
| `dispatch-read.ts` | Central Dispatch read models (counts, groupings) |

### 3.2 `src/lib/query/` — TanStack Query hooks (one file per `lib/data` module it wraps; each exposes `use*`
read hooks with a stable query-key namespace and `use*Mutations`/individual mutation hooks that invalidate only
their own namespace — verified pattern in scrap.ts, containers.ts, warehouse.ts, sales.ts this session)

Files mirror `lib/data/`: `containers.ts`, `customers.ts`, `dismantling-v2.ts`, `dispatch.ts`, `media.ts`,
`owner-dashboard.ts`, `payments.ts`, `processing.ts`, `quotes.ts`, `receiving.ts`, `sales.ts`, `scrap.ts`, `team.ts`,
`vehicle-workspace.ts`, `vehicles.ts`, `warehouse.ts`, plus `client.ts` (query client singleton) and `provider.tsx`
(the `QueryClientProvider` wrapper used in the root layout).

### 3.3 `src/lib/` (root files)

| File | Responsibility |
|---|---|
| `session.tsx` | The one `SessionProvider`: owns the Supabase browser client, the signed-in `User`, sign-in/out |
| `effective-user.ts` | Owner "preview" mechanism — lets an owner view a route as if they were another role, read-only (§8.5) |
| `nav.ts` | `getPrimaryNav(role)` (sidebar items per role), `ownerPreviews` (label lookup for `/preview/*` pages), `HOME_BY_ROLE`-adjacent helpers |
| `receive-eligibility.ts` | `canReceiveVehicle` / `receiveStateBlocker` — the one decision used by Auction, Auction detail and the Receiving deep link (tested directly in `receive-eligibility.mjs`) |
| `types.ts` | `Role` union, `roleLabels`, shared `User` type |
| `log.ts` | Structured server-side logging helper used by the media service and elsewhere |
| `utils.ts` | Small generic helpers (e.g. `cn` class-merging) |
| `middleware.ts` | **(assumption — not individually re-read this pass)** Next.js middleware entry; route protection is defined declaratively in `auth/route-access.ts` and was verified behaviourally (34/34 in `route-gate.mjs`, §12), not by re-reading the middleware file itself in this pass. |

### 3.4 `src/lib/auth/route-access.ts`

Exports `ROLE_KEYS`, `isRouteAllowed(pathname, roleKeys)`, `homeForRole(role)` / `homeForRoles`, and the
`{ prefix, roles }` allow-list table. One array of route prefixes to allowed role keys; `/preview/*` is
`OWNER_ONLY`; `/api/media` and `/api/ai` are open to every active role (the RPC/service layer behind them does the
real per-owner-type permission check, per the file's own comment). Verified behaviourally for every role in §12.

### 3.5 `src/lib/ai/`

| File | Responsibility |
|---|---|
| `config.ts` | Reads the OpenAI key/model env vars (§10), one place only |
| `tools.ts` | The named AI tool registry: each tool has a role list, a Zod arg schema, and calls an existing RPC — "No tool runs SQL" (§10) |
| `command.ts` | AI Command Center orchestration: turns a natural-language request into a tool call |
| `analyze.ts`, `analyze-part.ts` | Auction-screenshot and part-photo AI analysis (candidate extraction, not auto-commit) |
| `stream.ts`, `client-stream.ts`, `progress.ts` | Server-sent progress streaming for long AI calls, and the client reader for it |
| `http.ts` | Shared fetch/error helpers for the AI routes |
| `provider-errors.ts` | Maps OpenAI/provider errors to user-facing messages |
| `openai.ts` | The actual OpenAI client call site |
| `intake-handoff.ts` | Hands an AI-read auction-screenshot candidate to the normal intake review flow (never auto-creates a vehicle) |

### 3.6 `src/lib/media/media-service.ts` and `src/lib/supabase/`

`media-service.ts`: the one upload/read service (§9) — two Supabase clients per the file's own header comment
(quoted in §9.1), sharp-based variant generation, no external image/AI service for this path.
`supabase/client.ts` (browser client), `supabase/server.ts` (SSR/server client), `supabase/admin.ts` (service-role
client, server-only, used only after an RLS check has already passed) — see §8.1 and §11 for exact env var names.

### 3.7 `src/components/` by module

| Directory | Module | Notes |
|---|---|---|
| `vehicles/` | Auction Vehicle Inventory, vehicle detail, intake/review flow (§5.1, §7.1) | `vehicle-workspace.tsx` is the shell; `views/*` are the screens (home, intake, review, detail, list, existing-vehicle-merge, completion-review); `owner-dashboard/*` are Owner Dashboard cards |
| `central-dispatch/` | Central Dispatch (carrier assignment, transport status) | `central-dispatch.tsx`, `dispatch-table.tsx`, `dispatch-modals.tsx`, `carrier-directory-modal.tsx` |
| `vehicle-receiving/` | Vehicle Receiving & Arrival | Single large component `vehicle-receiving.tsx` |
| `dismantling/` | Dismantling Employee App (the real employee workflow, §5.3) | `dismantling-workspace.tsx` + role router |
| `dismantling-processing/` | Vehicle Dismantling Processing (management review, §5.3) | Workflow shell, needs-review queue, completed-today list, employee detail, photo gallery, analyze-part dialog |
| `parts/` | Parts Inventory / Parts Operations (management) and the data context both it and Warehouse read from | `parts-workspace.tsx`, `views/*` (capture, list, detail, inventory), `parts-data-context.tsx`, `operations-view.tsx` |
| `warehouse/` | Warehouse Employee App (§5.4, this session's work) | One file, `warehouse-app.tsx` — summary cards, Pending Putaway / Stored Inventory / Search Inventory tabs, the part dialog with the location-only edit |
| `sales/` | Customers & Sales: desk/POS, payments, quotes, customer views | `pos/*` (desk steps, print), `payments/*`, `views/*` (customer detail, receive-payment) |
| `scrap/` | Scrap Driver + Scrap Management (§5.5) | `driver/*` (loader-equivalent evidence app), `manager/*` (dashboard, payments, discrepancies, tire/rim, daily close, reports, planned — N/A here), `scrap-shared.tsx`, `scrap-tracking.tsx` (role router) |
| `containers/` | Container Loading + Export Management (§5.6) | `loader/*` (container-loader-app, loader-planned-parts), `export/*` (management app, container detail, new-container-dialog, planned-parts-section, invoice-document), `containers-workspace.tsx` (role router) |
| `team/` | Users & Activity, Audit | `team-view.tsx`, `invite-dialog.tsx`, `employee-daily-activity.tsx`, `audit-view.tsx` |
| `ai/` | AI Command Center UI | `ai-command-center.tsx` |
| `media/` | Shared capture/display components used by every module above | `media-capture.tsx` (Take Photo / Choose from Device, upload states), `image-input.tsx` (AI screenshot picker), `signed-photo.tsx` |
| `patterns/` | Generic small UI patterns reused everywhere | `empty-state.tsx`, `status-badge.tsx`, `metric-card.tsx`, `page-header.tsx`, `search-bar.tsx`, `module-placeholder.tsx` |
| `shell/` | App chrome | `app-shell.tsx` (sidebar + header + preview-mode banner), `sidebar-nav.tsx` |
| `auth/` | `auth-card.tsx` — the login form shell |
| `ui/` | 24 generic design-system primitives (alert-dialog, avatar, badge, button, calendar, card, checkbox, dialog, dropdown-menu, input, label, popover, progress, scroll-area, select, separator, sheet, skeleton, sonner, switch, table, tabs, textarea, tooltip) — base-ui wrapped in a consistent style; no business logic |

---

## 4. Modules: roles, routes, key screens and workflows

Each row is a role's **primary home module** as defined in `src/lib/nav.ts`/`route-access.ts`, verified behaviourally
for every role this session (`route-gate.mjs`, 34/34; `nav-role-access.mjs`, 23/23; and a live sign-in + landing-page
check for all ten seeded demo accounts).

This table states each role's exact allowed route prefixes **as literally read from
`src/lib/auth/route-access.ts`'s `ROUTE_RULES`/`HOME_BY_ROLE`** (not inferred from the sidebar alone — the sidebar
in `nav.ts` and the URL gate in `route-access.ts` are two separate, hand-maintained lists, and this pass found they
are **not always identical**; every such gap is called out explicitly below rather than silently resolved one way
or the other). "Sidebar" = appears in `getPrimaryNav(role)`. "URL only" = `isRouteAllowed` permits it but no sidebar
item links to it.

| Role key | Product name | Home route | Sidebar modules | URL-reachable but not in sidebar |
|---|---|---|---|---|
| `owner` | Owner / Admin | `/dashboard` | Every module in this table (owner is special-cased to pass every route check, not listed in any rule's role array) | — |
| `engineer_admin` | Engineer Admin | `/vehicles` | Vehicle Operations, Central Dispatch, Vehicle Receiving & Arrival, Dismantling Employee App (own, real access — not a preview), Vehicle Dismantling Processing, AI Command Center, Parts Inventory, Parts Operations, Customers & Sales, Containers & Export, Scrap Loads, Audit & History | — |
| `manager` | Front Desk Manager | `/dismantling-processing` | Vehicle Dismantling Processing, Vehicle Operations, Central Dispatch, Parts ("Pending Parts & Inventory"), Parts Operations, Customers & Sales, Scrap Module | **AI Command Center** (`/ai-command-center` is allowed for `manager` in `route-access.ts`, but `nav.ts`'s `manager` case has no entry for it) |
| `employee` | Warehouse Employee | `/parts` | Warehouse Employee App (§5.4) — Pending Putaway / Stored Inventory / Search Inventory | — |
| `auction` | Auction Vehicle Employee | `/vehicles` | Auction Vehicle Intake (`/vehicles`), Central Dispatch | — |
| `receiving` | Vehicle Receiving Employee | `/vehicle-receiving` | Vehicle Receiving & Arrival | — |
| `dismantling` | Dismantling Employee | `/dismantling` | Dismantling Employee App: My Assigned Vehicles → vehicle evidence → part capture (§5.3) | — |
| `scrap_driver` | Scrap Driver | `/scrap` | My Scrap Loads (evidence-only: number/weight never entered by the driver) | — |
| `container_loading` | Container Loading Employee | `/containers` | My Assigned Containers → number confirm → planned-part loaded-quantity confirm → photos → Mark Loading Finished (§5.6) | — |
| `export_manager` | Export Manager | `/containers` | Containers & Export | **AI Command Center** (same gap as `manager`: allowed by `route-access.ts`, absent from `nav.ts`'s `export_manager` case, which has only one entry) |

`manager` does **not** have `/containers`, `/audit` or `/team` (refused, redirected home — confirmed:
`route-gate.mjs`, `manager | GET /containers -> 307 /dismantling-processing`, `manager | GET /audit -> 307
/dismantling-processing`). `engineer_admin` does **not** have `/team` or `/dashboard` (refused — confirmed:
`route-gate.mjs`, `engineer_admin | GET /team -> 307 /vehicles`); an earlier draft of this table incorrectly listed
"Team" under `engineer_admin` and has been corrected.

### 4.1 Auction Vehicle Inventory (roles: owner, engineer_admin, manager, auction)

Screens: Home (purchased-vehicle list + "Add Purchased Vehicles" cards), Intake (Bulk Paste / Single Paste / AI
Photo-Screenshot Scan / Manual Entry), AI Vehicle Review (the batch review grid, §5.1/§7.1), vehicle detail, vehicle
merge (when an edit would collide with another vehicle's identifiers).

### 4.2 Central Dispatch (owner, engineer_admin, manager, auction)

Groups open (not-yet-transported) vehicles, assigns a carrier in bulk, tracks transport status
(`NEED_TRANSPORT → READY_TO_POST → POSTED_TO_CD → ASSIGNED → IN_TRANSIT → ARRIVED`, or `PROBLEM`).

### 4.3 Vehicle Receiving & Arrival (owner, engineer_admin, receiving)

Confirms a vehicle's physical arrival at the yard; records arrival photos; gated by `receive-eligibility.ts` so a
vehicle that is already dismantled, or not yet transport-arrived, is refused with a specific reason rather than a
generic error.

### 4.4 Dismantling (Employee App: dismantling; Processing/management: owner, engineer_admin, manager)

The **v2 canonical workflow** (migrations 0061–0064, described in the repository's own
`docs/backend/AUTONOMOUS_WORK_QUEUE.md` and verified again this session indirectly via `nav-role-access.mjs` and
`route-gate.mjs`, though the deep workflow steps below were not individually re-run this pass — carried over from
direct work earlier in this development history):
1. Management marks a received, not-yet-dismantled vehicle **Ready for Dismantling**.
2. Management **assigns** the ready vehicle to one active `dismantling` employee. One open assignment per vehicle.
3. The employee sees **only their own** assignments — searching for another employee's vehicle is refused with no
   details leaked.
4. The employee **starts** the assignment (idempotent), capturing vehicle evidence photos, then **captures parts**
   one at a time (name + details required, then a photo, then Save Part & Next).
5. The employee **finishes**; management reviews in Vehicle Dismantling Processing and **approves/corrects**
   completions (with a required reason for a correction).

Task 2 of this session's work removed the **owner's** sidebar shortcut to the employee-facing preview
(`/preview/dismantling`) because it duplicated "Vehicle Dismantling Processing" in the same sidebar; the employee's
own access, `engineer_admin`'s own direct access, the route itself, and all backend behaviour are unchanged
(verified: §5.2, §12).

### 4.5 Parts Inventory / Parts Operations (owner, engineer_admin, manager) and Warehouse Employee App (employee)

Parts Inventory is the management view of every `parts` row: capture queue, pending review, full inventory, field
edits (price/SKU/sale channel for reviewers; descriptive + location fields for warehouse-capable roles via
`update_part_fields`). The **Warehouse Employee App** (this session's work, §5.4) is a deliberately small,
non-overlapping employee screen over the *same* `parts` rows: Pending Putaway, Stored Inventory, Search Inventory,
and the one write it is allowed — assigning/changing the warehouse `location` field.

### 4.6 Customers & Sales (owner, engineer_admin, manager)

Customer master, quotes, the Sales desk/POS (search → add to cart → one-step checkout with payment → one-page
receipt), customer outstanding balance + receive-payment, Payments view (defaults to posted payments). Draft /
Reserve / Fulfill Now stock modes back onto `inventory_reservations` (§7.4).

### 4.7 Scrap (Scrap Driver: scrap_driver; Scrap Management: owner, engineer_admin, manager — see note on `auction` below)

Office creates a scrap load and assigns it to an active `scrap_driver`; the driver (and only that driver) confirms
the load (evidence: load photo, delivery, ticket photo) and completes it; management measures weight/rate, records
payments, handles discrepancies and tire/rim obligations, and runs Daily Close.

**A verified gap between the database permission and the web route, worth knowing about:** the database function
`is_scrap_office()` deliberately includes `auction` (its own migration comment explains this mirrors a legacy
cross-cutting rule — §8.2), so a scrap RPC itself would accept an `auction`-role caller. But `route-access.ts`'s
`/scrap` rule is `["engineer_admin", "manager", "scrap_driver"]` — it does **not** include `auction`. The practical
effect: an `auction` user cannot load the `/scrap` page shell at all (refused at the route gate before any RPC is
even called), so this DB-level permission is currently **not reachable through the web app** for that role. This is
not a security hole (the route gate is a legitimate "front door" even if a back door exists in the database), but
it means the database is more permissive than the UI for this one role/module pair — worth knowing if a future
change (e.g. a new AI tool, or a future screen) exposes the `/scrap` RPCs to `auction` by some other path.

### 4.8 Containers / Loading / Export / Invoices (Loader: container_loading; Management: owner, engineer_admin,
export_manager)

Management creates a container and assigns it to an active `container_loading` employee, and plans parts onto it by
searching the *same* Parts Inventory and reserving a quantity (the planned-parts stock hold, §7.5). The loader
confirms the container number (with a photo), confirms loaded quantities per planned part (bounded 0..planned),
adds loading photos and a final-list photo, then **Mark Loading Finished** — which exports the loaded quantity from
stock once and releases the unused planned quantity, transactionally and idempotently (§7.5). Management then
reviews Actual Loaded Parts, drafts an invoice (optionally pre-filled from the loaded parts, prices entered by
management, never from Parts Inventory's selling price), and uses the existing Draft → Review → Finalize → Payments
→ Mark On The Way → Close lifecycle, unchanged by this session's planned-parts work.

### 4.9 Owner Dashboard, Team/Users & Activity, Audit, AI Command Center

Route access (`route-access.ts`), restated precisely because this is easy to get wrong by assuming symmetry: Owner
Dashboard `/dashboard` is **owner only**. Team & Users `/team` is **owner only**. Audit & History `/audit` is
**owner and engineer_admin**. AI Command Center `/ai-command-center` is **owner, engineer_admin, manager and
export_manager** (the latter two by URL only — §4's table above).

Owner Dashboard: fleet/financial KPIs read from owner-dashboard RPCs. Team & Users: list/invite/role/status
management plus daily-activity read models. Audit & History: `audit_logs` reads, gated by `audit_read_roles`
(migration 0047). AI Command Center: natural-language tool-calling over the registry in `src/lib/ai/tools.ts`
(§10), with a **propose → approve** pattern for any write.

---

## 5. End-to-end business workflows (as implemented)

### 5.1 Auction intake (paste → parse → review → commit)

1. **Paste.** The auction-authorized role pastes raw text (or a screenshot, for AI Scan) into
   `IntakeView` (`src/components/vehicles/views/intake-view.tsx`), method Bulk Paste / Single Paste / Manual / AI
   Scan.
2. **Parse (client-side, pure function).** `buildIntakeItems(method, sourceText, existingVehicles)` in
   `src/lib/mock/parse-intake.ts` turns the raw text into one `IntakeItem` draft per vehicle. **This is the function
   this session's Task 1 rewrote** — see §7.1 for the exact bug and fix.
3. **Review.** `ReviewView` (`src/components/vehicles/views/review-view.tsx`) shows one card per draft, then makes
   **one server round trip** — `evaluateIntakeBatch` → RPC `intake_evaluate_batch` — which re-checks every row
   against the rest of the batch *and* the database (duplicate / conflict / existing / invalid), using the exact
   same logic the commit will use. The person can edit a row, remove a row, or merge into an existing vehicle.
4. **Commit.** Only rows the person explicitly selects (and that the server still classifies as `new`) are sent to
   `intakeVehicles` → RPC `intake_commit_batch`, which re-runs the evaluation **again** server-side and creates a
   vehicle, through `match_or_create_vehicle`, only for rows that are still `new` at that instant (protects against
   a race between two people pasting overlapping batches).

### 5.2 Dismantling: employee capture → management approval

See §4.4. Vehicle evidence and part photos flow through the shared media service (§9) with `owner_type =
'dismantling_session'` / `'part'`. Completion review requires a reason for any correction and writes one
`COMPLETION_APPROVED` (or correction) event.

### 5.3 Parts Inventory → Warehouse location (this session's new piece)

A part's lifecycle touches three screens over time, all reading/writing the **same** `parts` row:
`Dismantling capture → Manager Approval (Parts Inventory / Processing) → Parts Inventory (full record, pricing,
SKU) → Warehouse (location only) → Sales desk / Container export (sale or export)`. The Warehouse Employee App adds
**only** the physical `location` field; it never touches price, SKU, quantity, or approval state (enforced
server-side by `_warehouse_is_inventory()` and the fact that `warehouse_set_location` is the *only* write RPC
granted to the `employee` role for parts — see §7.3).

### 5.4 Customers & Sales: quote/sale → payment

Sales desk search (`search_sellable_parts`) only returns parts that are sellable *and* have available stock
(`_available_quantity`, §7.4). Adding to cart in Reserve or Fulfill Now mode creates/consumes an
`inventory_reservations` row. Checkout (`create_sale_with_payment`) is one transactional RPC: creates the sale,
reserves/fulfills stock, and posts the payment together — never a multi-step client orchestration that could leave
a half-done sale.

### 5.5 Scrap: load → driver evidence → Finish → payment/reconciliation

Office creates a load (assigned to an active `scrap_driver`) — **added this session**. The driver uploads the load
photo, marks delivered, uploads the ticket photo, and the load becomes `ready_for_review`; management measures
weight/rate (or overrides with a reason), records a payment, and may flag/resolve a discrepancy. Daily Close blocks
the day once every load's financials are settled (exact blocker rules: §7, "scrap" migrations 0035–0039, 0055,
0070 — see migration comments for the full blocker list; not re-derived from scratch this pass beyond what this
session's own work touched).

### 5.6 Containers: plan → load → finish → invoice

**This session's major addition.** Management creates a container (`export_create_container`), assigning an active
`container_loading` employee — no physical container number required yet. Management **plans parts** onto the
container by searching the same sellable-parts universe (`export_container_search_parts`, bounded to 20 results,
2-character minimum) and adding a quantity (`export_container_add_planned`), which places a **stock hold**: the
planned quantity is subtracted from that part's availability everywhere else (Sales, other containers) via
`_available_quantity()` (§7.5) — so the same unit can never be sold and exported at once. The assigned loader
confirms the container number (with a required photo), confirms **loaded quantity per planned part** (0..planned,
loader cannot exceed the plan), adds loading photos and a final-list photo, then **Mark Loading Finished**
(`container_loader_finish`): atomically, for every planned line, exports the loaded quantity from `parts.quantity`
(writing a `CONTAINER_EXPORT` `part_operations` row) and releases the unused planned-minus-loaded quantity back to
availability; the container moves to `ready_for_invoice`. A second call to Finish is a safe no-op (verified:
§12). Management then reviews Actual Loaded Parts and can prefill a draft invoice's lines from the loaded parts
(quantity = loaded quantity; **unit price is always entered by management**, never read from Parts Inventory's
selling price) before using the existing Draft → Review → Finalize → Payments → On The Way → Close lifecycle,
which this session did not modify.

### 5.7 Owner Dashboard, Team/Users

**(assumption — not re-derived this pass)** Read-model RPCs aggregate counts/KPIs across the domains above; Team
management writes go through role/invite RPCs with their own guards (migrations 0044–0046). Not independently
re-verified in this session beyond confirming the routes and roles are unaffected by this session's changes
(`route-gate.mjs`, `nav-role-access.mjs`).

### 5.8 AI Command Center

A person asks in natural language; the model may choose only from the named tools in `src/lib/ai/tools.ts`, each
scoped to specific roles and calling an existing RPC (never raw SQL). A **write** tool runs in two steps: `preview`
computes a content fingerprint of the current state and a human-readable summary; `execute` re-reads the state,
checks the fingerprint still matches (nothing changed underneath), and only then calls the RPC. This is the same
propose/approve shape as the review-then-commit pattern in §5.1.

---

## 6. Data model

**Scale:** 75 migrations, ~290 distinct `public.*` functions (including internal `_`-prefixed helpers), organized
into the domains below. This section lists the tables this session worked with directly (verified by reading their
`create table` statements) plus the domains documented in the original schema blueprint (§16) for tables not
touched this session — those are marked **(per blueprint, not re-verified this pass)**.

### 6.1 Identity & access
`profiles` (one row per person; `account_status`: active/disabled/removed), `roles` (the 10 role keys — see table in
§4), `user_roles` (join table; `assigned_by`, `assigned_at`). Role helpers: `has_role`, `has_any_role`, and
domain-scoped staff checks (`is_parts_staff`, `is_sales_staff`, `is_scrap_office`, `is_container_staff`,
`is_export_authorized`, `is_vehicle_domain_staff`, …) — each a `SECURITY DEFINER SQL` function, each with its own
doc comment explaining exactly which roles and why (verified directly for the ones this session touched or added;
the full set is defined mainly in migration 0001 and tightened in several later ones, e.g. 0055 for scrap office
roles).

### 6.2 Vehicles
`vehicles` (one row per vehicle; business identifiers `vin`/`lot_number`/`stock_number`/`auction_item_number` are
all nullable `text`, never the primary key; money columns are `numeric(12,2)`; `total_landed_cost` is a generated
column `purchase_price + auction_fees + transportation_cost`; `status` is a free-text/lookup column by design, not
a Postgres enum, because business statuses change too often — see §6, full column list verified by reading
`supabase/migrations/0001_initial_schema.sql` lines ~648–710 this session), `vehicle_events` (append-only history),
`carriers`, `vehicle_intake_batches`/`vehicle_intake_items` (the server-side record of a pasted batch, independent
of the client-side parser), `vehicle_completions` (dismantling completion decisions), dismantling assignment tables
(migration 0061, **(per blueprint, not re-verified this pass)** for exact column names).

### 6.3 Parts
`parts` (one row per part; columns verified directly this session: `status`, `stage`, `not_sellable_reason`,
`operational_status` (`AVAILABLE`/`RESERVED`/`SOLD`/`MISSING`/`DAMAGED`/`RETURNED`), `quantity`, `price`,
`stock_sku`, `part_number`, `location`, `zone`/`rack`/`shelf`/`bin` (present in schema but **not currently used by
any UI** — the Warehouse Employee App deliberately uses only `location`, per this session's explicit instruction
not to invent use of unused columns), `thumbnail_asset_id`, `inventory_source` (`'manual'` for parts created without
a donor vehicle), `source_vin`/`source_lot`/`vehicle_id` (donor reference), `dismantling_session_id`),
`part_operations` (append-only history: `action_type`, `previous_location`/`new_location`,
`previous_quantity`/`new_quantity`/`quantity_delta`, `actor_id`/`actor_name`/`actor_role`).

**Sellability rule** (`_part_is_sellable_state(p public.parts)`, defined in migration 0029, the version actually in
effect after 0073 restored it — see §7.4 for why this matters):
```sql
p.status = 'approved' and p.stage = 'ready_for_sale' and p.not_sellable_reason is null
  and p.operational_status not in ('MISSING', 'DAMAGED', 'RETURNED')
```
**Available-to-sell rule** (`_available_quantity(p_part_id)`, current version from migration 0073, incorporating
this session's container-hold addition from 0071):
```sql
case when _part_is_sellable_state(p) then
  p.quantity
    - (active inventory_reservations for this part)      -- Sales Draft/Reserve/Fulfill holds
    - (active container_planned_items for this part)     -- Container planned-but-not-yet-loaded holds
else 0 end
```
This single function is the **one** place "can this many units be sold/planned right now" is decided; Sales
reservations and Container planned-part holds both read and are both counted by it, which is exactly how this
session guaranteed a unit cannot be sold and exported at the same time (§5.6, §7.5).

### 6.4 Customers & Sales
`customers`, `quotes`/`quote_items`, `sales`/`sale_items` (`payment_status`: PAID/PARTIAL/UNPAID; `status`:
OPEN/CANCELLED; `fulfillment_status`), `inventory_reservations` (`status`: active/fulfilled/released/expired; one
active reservation per `sale_item_id`, enforced by a partial unique index), `payments`/`payment_allocations`
(payments are allocatable across sales, not sale-coupled — `create_payment → allocate_payment → post_payment` is
the only path that changes a sale's paid amount), `invoices`, `returns`, `sales_settings`.

### 6.5 Scrap & Tire/Rim
`scrap_loads` (status: `new`/`ready_for_review`/`approved`/`closed`; **this session added** `assigned_loader_id`,
`assigned_by`, `assigned_at`, `created_by`), `scrap_load_financials`, `scrap_load_events`, `scrap_discrepancies`,
`scrap_payments`, `driver_check_submissions`, `rim_obligations`/`rim_returns`, `daily_closes`.

### 6.6 Containers / Export
`container_jobs` (status: `loading`/`ready_for_invoice`/`on_the_way`/`closed`; **this session added**
`assigned_loader_id`, `assigned_by`, `assigned_at`, `loading_finished_by`, `parts_planning` (a flag distinguishing
new planned-parts-capable containers from legacy ones with no structured part list)), **`container_planned_items`
(new table, this session)** — one row per part planned onto a container, referencing `parts.id` directly (never a
copy): `planned_qty`, `loaded_qty`, `released_qty`, `status` (`planned`/`removed`/`finalized`), `added_by`,
`finalized_at`/`finalized_by`. `container_events`, `container_shipping_info`, `consignees`,
`export_invoices`/`export_invoice_line_items` (**this session added** `source_item_id` on line items, pointing back
at a finalized `container_planned_items` row, for invoice-prefill lineage) `/export_invoice_revisions`,
`export_payments`.

### 6.7 Cross-cutting
`media_assets` (polymorphic: `owner_type`/`owner_id`/`role`/`variant`/`status`, see §9), `audit_logs`
(append-only, written only through `write_audit_log()` — no direct client insert path).

### 6.8 Status fields and stock rules, summarized
- **Vehicle status:** free-text column, not an enum (business statuses change too often for a migration each time).
- **Part sellability vs. availability:** two different questions, §6.3 above — sellability is a property of the
  part's *state*; availability additionally subtracts live holds (sales reservations + container plans).
- **Container status / parts_planning:** `parts_planning = false` is how a **legacy** container (opened before this
  session's work, with no planned-items feature) is distinguished from a new one — its Loaded Parts section shows
  "No structured loaded-part list recorded for this legacy container" rather than fabricating one.

---

## 7. Backend behaviour: notable RPCs, transactions, idempotency, validation (linked to real paths)

This section documents the RPCs **this session added or changed**, with enough detail to maintain them, plus the
general shape every other RPC in the system follows (confirmed consistent across every domain inspected this
session: scrap, containers, warehouse, sales, parts, vehicles).

### 7.1 Auction Bulk Import parser fix — `src/lib/mock/parse-intake.ts` (client-side only; no RPC changed)

**Root cause of "4 vehicles become ~60 records":** the old bulk-mode code was
```js
const lines = sourceText.split(/\n+/).map(l => l.trim()).filter(Boolean);
drafts = lines.map(parseLine);     // one "vehicle" per non-blank PHYSICAL LINE
```
`split(/\n+/)` collapses a blank-line paragraph separator and an ordinary single newline identically, so the
block/paragraph boundary information in the pasted text was discarded entirely before parsing began; every one of
the ~15 non-blank lines inside each of the 4 real vehicle blocks became its own fabricated "vehicle" (including
label lines like `Vehicle image` and `Cost Details`, and bare field values like a lone `$850.00` or `E300`).

**Fix** (`buildIntakeItems`, bulk branch): a new `splitBlocks()` finds the boundary between vehicles using, in
order of how much signal they need: (a) repeated `Vehicle image` marker lines, if present; (b) blank-line runs,
otherwise; (c) repeated `"<year> <word…>"` title lines, if the paste has neither blank lines nor markers; (d) the
whole input as one block, only as a last resort (never "one record per line"). Each resulting block is then parsed
by a new `parseBlock()` that scans **every line of the block** for labeled or shaped fields (VIN, `Stock#:`, the
`<letter> - #<number>` lane/lot code, the `<year> <make> <model>` title line, `Date Won:`, a bare `$amount`,
`Pick up By:`, a `Pickup PIN:` label whose value may be on the next line) — order-independent, so reordered fields,
extra whitespace, and missing optional fields never break a block. `Vehicle image` and `Cost Details` are explicit
"noise" lines, stripped before field-scanning and never contribute to the record count.

**Fields parsed, and exactly where each one goes (schema-checked this session — see §7.1a for what was
deliberately *not* mapped):**

| Source text | Draft field | Schema column (via `match_or_create_vehicle`) |
|---|---|---|
| `VIN: …` | `vin` | `vehicles.vin` (`text`) |
| `Stock#: …` | `stockNumber` | `vehicles.stock_number` |
| `A - #25` (lane/lot code) | `lotNumber` | `vehicles.lot_number` |
| `2012 KIA OPTIMA SX` | `year`, `make`, `model` | `vehicles.year` (`int`), `make`/`model` (`text`) |
| `$850.00` | `purchasePrice` | `vehicles.purchase_price` (`numeric(12,2)`) |
| `Date Won: …` | `saleDate` | not read by `match_or_create_vehicle` today — UI-only (see §7.1a) |
| `Pick up By: …` | `pickupDeadline` | not read by `match_or_create_vehicle` today — UI-only |
| `Pickup PIN:` + next line | `pickupPin` | not read by `match_or_create_vehicle` today — UI-only |
| `Atlanta East` (positional, first unlabeled line) | `location` | `vehicles.location` |
| `Pre-Bid` (positional, second unlabeled line) | `pickupStatus` | not read by `match_or_create_vehicle` today — UI-only; always flagged `uncertainFields` since it is a best-effort positional guess |

**7.1a — deliberately *not* mapped, and why (the "never map a date into a numeric field" requirement):** the
`Due: Tue, Oct 20` line is a **payment due date**, and the only schema column with a similar name,
`vehicles.balance_due`, is `numeric(12,2)` — a date string must never be written there. There is no other schema
column for "payment due date" (distinct from `pickup_deadline`, which is the *physical pickup* deadline and is
correctly used for `Pick up By:`). Rather than invent a column or silently drop the information, the parser adds a
line to a new, **UI-only** `reviewNotes` array on the `IntakeItem` (shown in the review card as "Found in the text,
not stored (no matching field yet)"), which is **never sent to the server** — it lives beside `draft`, not inside
it. The same mechanism is used for the buyer name (`Safdar Pooya`), which has no schema field at all. The complete
raw block text is *also* always preserved in `sourceExcerpt` and shown in the reviewer's "Original source for this
vehicle" panel, so nothing from the paste is ever silently discarded even where it has no field to go in.

**Validation added, mirroring (not replacing) the server's own rules in `_intake_evaluate_rows`:** a block with no
year, make or model, or with none of VIN/lot/stock, gets a local `errors` entry immediately (same wording as the
server's `intake_evaluate_batch` reasons); a VIN-shaped token that is not exactly 17 characters is captured (so the
reviewer can see and fix it) and flagged `"VIN must be 17 characters"`. These are UX conveniences — **the server
re-validates everything again** in `intake_evaluate_batch`/`intake_commit_batch` regardless of what the client
thinks, per the architectural principle in §1.

**What this session did *not* touch:** `intake_evaluate_batch`, `intake_commit_batch`, `_intake_evaluate_rows`,
`match_or_create_vehicle` (all in migrations 0006 and 0056) — the server-side duplicate/conflict/existing-vehicle
logic — were read in full to confirm the fix only needed to change client-side parsing, and were re-run as a
regression (§12) to confirm they still pass unmodified.

### 7.2 Navigation cleanup — `src/lib/nav.ts` (data change only, no RPC)

Removed one array entry (`{ id: "dismantling", label: "Dismantling Employee App", href: "/preview/dismantling", …
}`) from the `case "owner":` branch of `getPrimaryNav`. Nothing else changed: the route `/preview/dismantling`
still exists and is still owner-reachable by URL (`route-access.ts` is unchanged), `ownerPreviews` (used only for
page-title lookup, not sidebar rendering) still has its entry, `engineer_admin`'s own separate (non-preview, real)
`/dismantling` nav entry is untouched, and the `dismantling` role's own primary nav is untouched.

### 7.3 Warehouse location — `warehouse_set_location(p_part_id, p_location)` (migration 0074)

The **only** write RPC granted for the `employee` role's own Parts touch point. Validates: caller has
`employee`/`owner`/`engineer_admin`/`manager` role; the part is a valid placeable inventory part
(`_warehouse_is_inventory`: approved, not marked non-sellable, not missing/damaged/returned); the location text is
1–80 characters with no control characters. Setting the **same** location is a no-op (no history row, matching the
idempotency principle in §1 even though this isn't a client-request-id style idempotency — it's "setting what's
already true changes nothing"). A real change writes one `part_operations` row (`action_type = 'LOCATION_CHANGE'`,
`previous_location`/`new_location`, actor) and one `audit_logs` row. `warehouse_list`/`warehouse_search` are
bounded (≤50 / ≤25 rows, keyset-paged) read RPCs scoped to the same `_warehouse_is_inventory` rule, and their
returned row shape (`_warehouse_row`) deliberately has no price/cost column.

### 7.4 `_available_quantity` regression and fix (migrations 0071 → 0073, this session)

0071 (Containers planned-parts work) redefined `_available_quantity` from an **older** body (migration 0026's,
which checked `status`/`stage`/`not_sellable_reason` but not `operational_status`), inadvertently dropping the
`operational_status not in ('MISSING','DAMAGED','RETURNED')` exclusion that migration 0029 had added via
`_part_is_sellable_state`. This was caught by running the **existing** `rpc-parts-sellability.mjs` suite as a
regression (3 of 14 checks failed: damaged/missing/returned parts showed `available=2` instead of `0`). Fixed in
0073 by rebuilding `_available_quantity` on top of `_part_is_sellable_state(p)` again, with the container-hold
subtraction kept. Re-run: 14/14. **Lesson for future changes to this function: always rebuild it as
`_part_is_sellable_state(p) ? (quantity − reservations − container holds) : 0`, never re-derive the sellability
condition inline.**

### 7.5 Container "Mark Loading Finished" — `container_loader_finish` (migrations 0040, rewritten in 0071)

Transactional, idempotent. Locks the container row; if status is no longer `'loading'`, returns the current state
unchanged (safe replay — verified directly: a second call after Finish leaves `parts.quantity` unchanged, §12).
Requires: caller is the **assigned** loader; container number confirmed; at least one loading photo; a final-list
photo; and (if any parts are planned) at least one unit loaded somewhere in the plan. For each `planned` line, locks
the part row, checks `parts.quantity >= loaded_qty` (refuses with a clear message if stock changed underneath),
decrements `quantity` by `loaded_qty`, writes one `part_operations` row (`action_type = 'CONTAINER_EXPORT'`),
marks the line `finalized` with `released_qty = planned_qty − loaded_qty`, and re-syncs the part's
`operational_status`. Only then does the container itself move to `ready_for_invoice`. A media-insert guard fix was
needed in a follow-up migration (0072): the new "loader must be assigned" check in `_container_media_guard`
initially also blocked the **server's own** service-role writes of processed photo variants (which have no
`auth.uid()`); fixed by scoping that check to real user sessions only, leaving the existing "evidence only while
loading" rule intact for everyone.

### 7.6 General RPC shape (confirmed in every domain this session touched)

```sql
create or replace function public.some_action(...)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._some_domain_require_role();      -- 42501 if wrong role, 28000 if unauthenticated
  select * into v_row from public.some_table where id = p_id for update;  -- lock
  if not found then raise exception '...' using errcode = '22023'; end if;
  if v_row.status <> 'expected' then raise exception '...' using errcode = 'P0001'; end if;
  -- ... business logic, arithmetic, further locks ...
  perform public._write_history_event(...);
  perform public.write_audit_log(...);
  return public._read_model_json(v_id);
end;
$$;
```
Error codes used consistently: `28000` unauthenticated, `42501` forbidden (wrong role), `22023` invalid input /
not found, `P0001` state conflict (illegal transition, already done, day closed, etc.).

---

## 8. Authentication and authorisation

### 8.1 Supabase clients (verified by reading the three files directly)

| Client | File | Env vars read |
|---|---|---|
| Browser (anon/public key, RLS as the signed-in user) | `src/lib/supabase/client.ts` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Server/SSR (same key, server-rendered RLS session) | `src/lib/supabase/server.ts` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Admin (service role, bypasses RLS — server-only) | `src/lib/supabase/admin.ts` | `NEXT_PUBLIC_SUPABASE_URL`, `secret_key` |

The admin client is used in exactly one place of consequence in application code: `media-service.ts`, and only
**after** the RLS-scoped user client has already confirmed the caller may touch that media owner — see §9.1's
quoted header comment. `secret_key` is never sent to the browser.

### 8.2 Roles (verified: `select key, label from public.roles`, live DEV, this session)

```
owner, engineer_admin, manager, employee, auction, receiving, dismantling, scrap_driver,
container_loading, export_manager
```
(`employee` = "Warehouse Employee"; `manager` = "Front Desk Manager" — there is **no separate role** for "Front
Desk Manager" vs. a generic "Manager"; they are the same role, one account.)

Role-checking helpers (`has_role`, `has_any_role`, and the domain-scoped `is_*_staff`/`is_*_office`/
`is_*_authorized` functions) are `SECURITY DEFINER SQL`, called from inside every write/sensitive-read RPC — never
trust a role claim passed from the client. `is_scrap_office()` deliberately includes `auction` (a documented,
intentional cross-cutting legacy-mirroring rule, per its own migration comment); `is_export_authorized()`
deliberately excludes `manager` (Front Desk Manager does not get Export access by default — also an explicit,
documented business rule).

### 8.3 Route protection (`src/lib/auth/route-access.ts`, read in full this pass, verified behaviourally)

One `{ prefix, roles }[]` table (`ROUTE_RULES`); `isRouteAllowed(pathname, roleKeys)` is the single decision
function; `homeForRole`/`homeForRoles` compute where an unauthorized or just-logged-in user should land instead.

**The owner-only mechanism, exactly as implemented (worth stating precisely, since it is easy to misread):**
`OWNER_ONLY` is declared as an **empty array** (`const OWNER_ONLY: readonly Role[] = []`), not `["owner"]`. A route
using it (`/dashboard`, `/team`, `/preview`) therefore has a role list that **matches no role at all** by itself —
what actually makes those routes work for the owner is a separate, earlier check inside `isRouteAllowed`:
`if (roles.includes("owner")) return true;`, checked *before* any per-route rule is consulted. The practical
behaviour (owner can reach them, no one else can) is what this guide's §4 states, but the mechanism is "owner is
special-cased past every rule," not "owner is listed in these rules" — a future change to `OWNER_ONLY` that adds
`"owner"` to the array would be a no-op; a future change that removes the `roles.includes("owner")` special case
would break every one of these routes for the owner, not just the `OWNER_ONLY` ones.

**Default-deny, from the file's own header comment (quoted verbatim):** "Paths are matched by prefix, most
specific first. A path with no rule is DENIED for everyone except Owner (default-deny), so a newly added route is
closed until it is listed." — i.e. forgetting to add a new route to `ROUTE_RULES` fails safe (closed), not open.

`/preview/*` is owner-only (via the mechanism above). `/api/media` and `/api/ai` are reachable by every active
role — the real per-request permission check for those lives in the RPC/service layer behind them
(`can_access_media`, tool role lists), not in this table. Verified this session: 34/34 role×route checks in
`route-gate.mjs` against a live server, covering every role's allowed home, a representative set of refused routes
(redirecting to that role's own home), and a disabled account being redirected to `/login?reason=disabled`.

### 8.4 RLS and RPC permission checks

Every table that matters has RLS **enabled**; most have either no client-facing policy at all (RPC/service-role
only) or a narrow `select`-only policy scoped by a role-check function (the pattern seen directly this session on
`container_jobs`, `container_events`, `container_planned_items`, `parts`, `media_assets`). Every state-changing
operation goes through a `SECURITY DEFINER` RPC that re-checks the role itself (so RLS is the **second** line of
defence for reads, and RPCs are the **only** line for writes — there is no direct-client-`UPDATE` path for business
tables in the modules this session touched). `_rpc_require_roles(...)` / per-domain `_..._require_*()` helpers
raise `42501` for a wrong role and `28000` for no session.

**Scoped-to-self access** (a pattern this session implemented twice, for Scrap loads and Container loads): row-level
`assigned_*_id = auth.uid()` checks, both in the RLS policy (`container_jobs_scoped_read`,
`container_events_scoped_read`) **and** inside the `SECURITY DEFINER` RPCs (`_container_require_access`,
`_container_access`) — doubled deliberately, because the loader-facing RPCs are themselves `SECURITY DEFINER` and
so bypass RLS from the function owner's perspective; the explicit in-function check is what actually stops one
loader from reading another loader's container data.

### 8.5 Preview mode (`src/lib/effective-user.ts`)

Lets an `owner` view the app **as if** they were another role, read-only, for QA/training — a banner marks this in
the shell (`isPreview`/`previewLabel` from `useEffectiveUser()`). It is a **client-side display mode**, not a
second authentication identity: the underlying Supabase session, and every RPC call the preview screen makes, is
still the owner's real session and real role checks — a preview cannot do anything the owner's own account could
not already do server-side. **(assumption — the exact mechanism of how "view as" is implemented, e.g. whether it
swaps the `User` object passed to components vs. actually impersonating role checks, was not re-read line-by-line
this session; confirmed only that it exists and that `/preview/*` routes are owner-gated.)**

### 8.6 What was NOT re-verified this session

RLS policy text for tables outside Scrap/Containers/Parts/Warehouse (Sales, Vehicles, Team, Customers) was not
individually re-read this pass; those modules' access behaviour is taken on the basis of the original schema
blueprint (§16) plus this session's `route-gate.mjs`/`nav-role-access.mjs` results, which test **route** access,
not **row-level** access within an allowed route.

---

## 9. Photos and files

### 9.1 Upload/capture flow (`src/lib/media/media-service.ts`, header comment quoted verbatim — verified this
session by reading the file)

> Media upload / read service. Two clients, two jobs:
> - `userClient` (RLS session of the caller) → AUTHORIZATION. Every row insert/select on `media_assets` goes
>   through the caller's session, so `public.can_access_media()` and `public.media_owner_exists()` decide, in the
>   database, whether this person may attach or see a file for this owner. The app never re-implements that rule.
> - `adminClient` (service role, server-only) → BYTES. Signed upload/read URLs and variant generation. Only
>   reached AFTER the RLS step above has passed for this caller.
>
> Variant generation runs locally with `sharp` (resize / orient / WebP). No external AI or image API is called, so
> this path costs nothing per image.

Client-facing component: `MediaCapture` (`src/components/media/media-capture.tsx`) — states: Empty → (Take Photo /
Choose from Device) → Selected/Not Saved Yet → Uploading → Saved (or a failure message with Retry). Uses the
device camera (`capture="environment"`) on touch devices, falling back to a file picker; a separate hidden input
handles "Choose from Device" explicitly.

**Object path convention** (from the storage migration's own comment, deterministic and collision-proof):
`<owner_type>/<owner_id>/<client_request_id>/<variant>.<ext>` — `media_assets.(bucket, storage_path)` is unique, so
a retried upload cannot create a duplicate.

### 9.2 Storage buckets (verified: `supabase/migrations/0003_storage_buckets.sql`)

| Bucket | Public? | Who can reach it |
|---|---|---|
| `operational-media` | No | Vehicle, part, dismantling, scrap, rim, container (number/loading/final-list) and customer evidence — anyone who passes the `can_access_media()` domain gate for that owner type |
| `confidential-export-media` | No | Export invoices and export payment proof — owner, engineer_admin, export_manager only |

Both are **private**; `storage.objects` has no client-facing RLS policy at all, so bytes move only through signed
URLs the server generates after the `can_access_media()` check — the Storage service key never reaches the
browser.

### 9.3 Media roles and variants (verified: grep of `media-service.ts` and this session's own migrations)

Variants: `original`, `medium`, `thumbnail`. Roles seen this session (not an exhaustive list of every role ever
used, but every one this session's modules rely on): `load_photo`, `ticket_photo` (Scrap), `number_photo`,
`loading_photo`, `final_list` (Containers), `capture` (Dismantling part photo), `vehicle_evidence` (Dismantling
session), `check_photo` (Scrap driver check). `can_access_media(owner_type, owner_id)` is one function with one
`case` branch per `owner_type` — extended this session for `'container'` (now `_container_access()`, assignment-
scoped) and for `'part'` (extended to also admit a loader whose assigned container has that part planned — so a
loader can see a planned part's thumbnail without being Parts staff).

### 9.4 Relevant environment variables

See §11 for the full list. Only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `secret_key`
are involved in the media path — no separate storage-specific env var exists; bucket names are hardcoded (by
design — they are a fixed, small, reviewed set, not configuration).

---

## 10. AI integration

**Supported operations** (`src/lib/ai/tools.ts`, `command.ts`, `analyze.ts`/`analyze-part.ts`): a named **tool
registry** the model may call, each tool declaring its own `kind: "read" | "write"`, a role list, and a Zod
argument schema; **no tool executes raw SQL** — every tool calls an existing, already-reviewed RPC. Two specific
non-tool-call AI features: auction-screenshot candidate extraction (feeds the normal intake review flow, §5.1 —
never auto-creates a vehicle) and part-photo analysis (dismantling "Analyze Part" dialog).

**Write safety (propose → approve):** a write tool's `preview()` computes a **canonical, key-sorted-JSON
fingerprint** of the current state plus a human-readable summary (`WritePreview { summary, target, fields,
fingerprint }`); its `execute()` re-reads the state and refuses to proceed if the fingerprint has changed since the
preview was shown — i.e. nothing can be approved against stale state, and the model cannot "sneak" a write in
without a human having seen the actual preview text that matches what will happen.

**Role restrictions (verified this session by reading `tools.ts`):** three named role-sets reused across tools —
`SALES_OFFICE = [owner, engineer_admin, manager]` (export_manager deliberately excluded — mirrors `is_sales_staff`
excluding sales from export), `OWNER_ENGINEER = [owner, engineer_admin]`, `OWNER_ONLY = [owner]` (e.g.
`owner_dashboard_summary`, because the underlying RPC itself is owner-only in the database and the tool simply
follows that, never widening it).

**Failure handling:** `provider-errors.ts` maps OpenAI/provider failures to user-facing messages; `stream.ts` /
`client-stream.ts` implement server-sent progress events for long-running calls (`PROGRESS_LABELS`,
`SLOW_WARNING_MS` — a "this is taking a while" notice rather than a silent hang).

**Provider/key prerequisites — env var names only, never values:** `OPENAI_API_KEY` (preferred) or `OpenAI_key`
(accepted fallback, legacy naming — both read in `src/lib/ai/config.ts`, `OPENAI_API_KEY` taking priority),
`OPENAI_MODEL` (optional, defaults to `gpt-4.1-mini`), `OPENAI_TRANSCRIPTION_MODEL` (optional, defaults to
`whisper-1`). Without a key configured, `config.ts`'s own comment states the key "is never logged, or placed in a
response" — AI routes fail closed with an error, they do not silently no-op (**(assumption)** — the exact
fail-closed error path was not independently re-tested this session).

**Known limitation:** two different env var names (`OPENAI_API_KEY` vs. the legacy `OpenAI_key`) both work, which
is intentional backward compatibility per the code comment, but is worth normalizing to one name in a future
cleanup pass if there is ever confusion about which is authoritative (currently `OPENAI_API_KEY` wins if both are
set).

---

## 11. Environment setup

### 11.1 Required environment variables — **names only**, no values here or anywhere in this repository

| Variable | Used by | Required for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser, server, admin Supabase clients | everything — the app cannot start meaningfully without it |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser, server Supabase clients | every RLS-scoped read/write |
| `secret_key` | `src/lib/supabase/admin.ts` | the media service's signed-URL/variant-write step only; **server-only, never sent to the browser** |
| `OPENAI_API_KEY` (or legacy `OpenAI_key`) | `src/lib/ai/config.ts` | AI Command Center, screenshot/part-photo analysis, transcription |
| `OPENAI_MODEL` | `src/lib/ai/config.ts` | optional — defaults to `gpt-4.1-mini` |
| `OPENAI_TRANSCRIPTION_MODEL` | `src/lib/ai/config.ts` | optional — defaults to `whisper-1` |
| `connection_string` | `scripts/dev-tests/*.mjs` only (direct Postgres access for read-only checks and `apply-migration.mjs`) | **test/dev tooling only — never read by application code** |

**Also used, test/dev tooling only, never by application code, never committed:** `DEV_TEST_OWNER_PASSWORD` and the
generic per-role pattern `DEV_TEST_<ROLE_KEY_UPPERCASED>_PASSWORD` (e.g. `DEV_TEST_MANAGER_PASSWORD`,
`DEV_TEST_SCRAP_DRIVER_PASSWORD`) — read by `scripts/dev-tests/dev-credentials.mjs` as an override for the
password field of the matching role in the git-ignored `dev-test-credentials.json`, so a suite can run against a
seeded account's **real current password** without that password ever being written into any tracked or
git-ignored file. `BASE_URL` — overrides the dev-test default of `http://localhost:3100` for suites that make HTTP
requests to a running server.

### 11.2 Local setup (safe steps; no credentials included)

1. `npm install`.
2. Create `.env.local` (git-ignored) with the variables in §11.1 that your Supabase project and OpenAI account
   provide — ask whoever owns those accounts for the actual values; never request them in a way that would put them
   in chat/code/commit history.
3. Apply migrations to your Supabase project, in numeric order, 0001 through the highest-numbered file in
   `supabase/migrations/`. This repository's own tooling applies one migration at a time, in one transaction, via
   `scripts/dev-tests/apply-migration.mjs <path-to-one-migration-file>` — there is no "migrate all" command
   included; each file was applied individually as it was written, and that is the supported path going forward too
   (apply files in ascending numeric order if bootstrapping a fresh database).
4. `npm run dev` (starts on port 3000 by default; `next dev -p 3100` was used throughout this session's own test
   runs because `BASE_URL` in the test scripts defaults to port 3100).
5. For DEV-only manual QA logins, `dev-test-credentials.json` (git-ignored) holds seeded demo accounts; see
   §12 for how tests read passwords without ever persisting them to a tracked file.

### 11.3 Migrations

Additive only, one file per logical change, numbered sequentially, applied one at a time via
`scripts/dev-tests/apply-migration.mjs` (wraps the single file in one transaction). **Never edit an already-applied
migration file** — if a mistake is found after the fact, write a new migration that corrects it (this session did
exactly that twice: 0072 corrected a bug introduced in 0071's media guard; 0073 corrected a regression introduced
in 0071's `_available_quantity`).

---

## 12. Testing guide

**67 scripts in `scripts/dev-tests/`, no test framework** — plain Node scripts (Node 26, which supports native
TypeScript type-stripping for the few that import real `.ts` source directly) that either (a) call RPCs directly
with real signed-in Supabase sessions and assert on the response/database, (b) drive a headless Chrome
(`playwright-core`, pointed at a locally-installed Chrome) against a running `next dev` server and assert on the
rendered page, or (c) import a pure TypeScript function with no side effects and assert on its output. There is no
`npm test` script — each file is run directly with `node scripts/dev-tests/<name>.mjs`, passing any needed
`DEV_TEST_<ROLE>_PASSWORD` / `BASE_URL` environment variables.

### 12.1 Suite categories (by filename prefix, as actually present)

| Prefix | What it covers |
|---|---|
| `rpc-*.mjs` | Direct RPC calls with real sessions: one file per domain (vehicles, containers, scrap, warehouse, parts, sales, customers, payments, dismantling, team, AI, …), checking happy-path, validation, and role-denial behaviour |
| `ux-*.mjs` | Headless-browser flows through the real UI for a given module |
| `e2e-*.mjs` | End-to-end flows spanning more than one module (e.g. POS add-to-cart, sales payments) |
| (plain names) | `route-gate.mjs` (role × route HTTP checks), `rls-matrix.mjs`, `nav-role-access.mjs` (this session), `parse-intake.mjs` (this session), `receive-eligibility.mjs`, `inspect-db.mjs`, `bench-*.mjs` (performance), `apply-migration.mjs` (tooling, not a test), `dev-credentials.mjs` (shared credential loader, not a test), `_ts-alias-loader.mjs` (this session — a Node module-resolution hook so a test can `import` real `"@/..."` TypeScript source) |

### 12.2 How to run one

```bash
# Pure-function tests (no DB, no server):
node scripts/dev-tests/parse-intake.mjs
node scripts/dev-tests/nav-role-access.mjs

# DB-backed RPC tests (need Supabase env vars + role passwords):
DEV_TEST_OWNER_PASSWORD='...' DEV_TEST_MANAGER_PASSWORD='...' node scripts/dev-tests/rpc-vehicle-authority.mjs

# Browser/UI tests (need a running `next dev` server, default port 3100):
BASE_URL='http://localhost:3100' DEV_TEST_OWNER_PASSWORD='...' node scripts/dev-tests/route-gate.mjs
```
Every suite prints `PASS`/`FAIL` per check and a `TOTAL n | PASS n | FAIL n` line; a non-zero exit code means at
least one failure. Passwords are read from environment variables or `dev-test-credentials.json` (git-ignored) and
are never printed, logged, or written back to any file by these scripts.

### 12.3 Latest verified test status (this session, against live DEV)

| Suite | Result |
|---|---|
| `parse-intake.mjs` (new, this session) | **25/25** — exact client sample (4 blocks, correct VINs/stock/year/make/model/amounts), blank-line/whitespace/reorder/missing-field variants, malformed VIN, incomplete record, empty/heading-only input, a synthetic non-sample paste |
| Real-UI Bulk Paste of the exact client sample, 1440px and 390px, as the `auction` role | **12/12** (6 checks × 2 widths) — "4 vehicles detected", all 4 VINs shown, all 4 `READY`, zero placeholder rows, no console errors, **and confirmed no vehicle was created in the database** (Confirm was never clicked) |
| `rpc-intake-batch.mjs` (existing, regression) | **12/12** — duplicate/conflict/existing-vehicle/invalid rules on the server, unchanged by this session |
| `rpc-vehicle-authority.mjs` (existing, regression) | **36/36** |
| `nav-role-access.mjs` (new, this session) | **23/23** — owner sidebar entry removed, Vehicle Dismantling Processing still present, preview route not deleted, dismantling/engineer_admin/manager access all unchanged, every role has a non-empty nav + home |
| `route-gate.mjs` (existing, regression) | **34/34** — every role's allowed/refused routes, including a disabled account |
| Live browser: owner sidebar text + Vehicle Dismantling Processing opens + dismantling employee still lands on `/dismantling` | **5/5** |
| `rpc-warehouse.mjs` (this session's earlier Warehouse Employee App work, re-confirmed present) | 28/28 at the time it was written |
| `rpc-containers-planning.mjs` (this session's earlier Containers work) | 44/44 at the time it was written |
| `rpc-scrap-assign.mjs` (this session's earlier Scrap work) | 21/21 at the time it was written |
| `rpc-parts-sellability.mjs` (regression, caught this session's own 0071 bug, then confirmed the 0073 fix) | 14/14 after the fix (was 11/14 before it) |

**Not run this session** (out of scope for this task's three deliverables, per the explicit instruction to keep
changes focused): the Sales/Scrap/Containers/Warehouse browser suites beyond what's listed above, `rpc-money-stock.mjs`,
`rpc-sales-checkout.mjs`, and every other `rpc-*`/`ux-*`/`e2e-*` suite not named in the table.

### 12.4 Prerequisites for the full suite

A running Supabase project with every migration applied; a running `next dev` server for any browser-based suite;
real passwords for the seeded demo accounts (owner, manager, employee, auction, receiving, dismantling,
scrap_driver, container_loading, export_manager — `engineer_admin`'s current password was not established this
session, see §14); Chrome installed at the hardcoded path the scripts use
(`C:/Program Files/Google/Chrome/Application/chrome.exe` — **(assumption)** this is a Windows-specific path baked
into the scripts, confirmed by this session's own test runs on this machine, not confirmed portable to another OS
without editing it).

---

## 13. Deployment and environments

**Architecture (as configured, not aspirational):** GitHub repository → Vercel, connected via Vercel's native Git
integration, so a push to `main` triggers an automatic production deployment. Supabase is a separately-hosted
project (DEV at minimum; **(assumption)** whether a distinct PROD Supabase project exists separate from the DEV
project this session worked against was not confirmed this pass — treat the database this guide describes as the
**DEV** database unless told otherwise, and never assume write access here is safe against a production dataset).

**What this session actually did, for the record of what state the repo is in:**
- All DEV-database changes in this session (migrations 0074–0075, plus every migration from earlier sessions up to
  0075) were applied directly to the DEV Supabase project via `apply-migration.mjs`, one file at a time, each in
  its own transaction — this is a direct, live DEV change, not a staged/pending one.
- Code changes for Tasks 1–3 of this session were committed **locally only**, pending explicit review and push
  authorization (see the top-level session report for the exact commit hash) — not deployed.
- Earlier in this development history, other sessions' commits were pushed to `origin/main` with the user's
  explicit authorization at that time, which is what triggered Vercel's existing auto-deploy integration for those
  changes.

**Safety precautions observed throughout this session (and expected of any future change):** never force-push,
never `reset --hard` over remote history, always `git fetch origin` and compare before pushing, never push without
the user's explicit go-ahead for *that specific* set of commits, never commit `.env*`, `dev-test-credentials.json`,
or any password/token/secret (checked this session with an explicit secret scan of the staged diff before any
commit that was later pushed), run a migration against DEV one file at a time inside its own transaction rather
than batch-applying unreviewed SQL.

**Pending/unconfirmed for deployment specifically:** whether Vercel environment variables are already set to match
§11.1 (not independently checked this session — this guide does not have Vercel dashboard access); whether a
distinct production Supabase project/branch exists; whether there is a CI pipeline running `tsc`/`lint`/`build`
automatically on push (not observed in the repository — no `.github/workflows` directory was found as part of this
session's own work, though it was not explicitly searched for).

---

## 14. Known limitations and open issues (confirmed by the repository or this session's test results)

1. **`engineer_admin`'s current real password is unknown to the test tooling.** Every other seeded role's password
   was confirmed or reset to a known value in earlier work this session; `engineer_admin` was deliberately left
   unchanged (no password was supplied for it), so it cannot currently be used in an automated test run without
   first obtaining or resetting its password.
2. **Several intake fields are UI-only today, not persisted by `intake_commit_batch`.** `saleDate`, `pickupPin`,
   `pickupStatus`, `pickupDeadline`, `invoiceAmount`, `balanceDue`, `damageInfo`, `transportInfo`, `mileageStatus`
   are all parsed and shown in the review editor, and all have real matching columns on `vehicles`, but
   `match_or_create_vehicle`'s field-building `jsonb_build_object(...)` call does not currently include them — they
   never reach the database on commit. This was true before this session's parser fix and remains true; it was not
   in scope to change the commit RPC's field list this session (the task was explicitly to fix the parser, not
   widen what gets persisted). A future task should decide whether to extend `intake_commit_batch` to accept and
   store these, or to remove them from the review editor if they are intentionally display-only.
3. **The `"Due:"` payment-due-date has no matching schema column at all** (distinct from `pickup_deadline`). It is
   surfaced in the review card as a review note and never silently dropped, but nothing stores it. If the business
   needs it tracked, a new column (e.g. `vehicles.payment_due_date date`) would need a dedicated migration —
   deliberately not added this session per the explicit "never invent a field" instruction.
4. **The buyer name** (e.g. "Safdar Pooya") has no schema field anywhere in `vehicles`. Same treatment as #3.
5. **`location`/`pickupStatus` field assignment in the parser is a positional heuristic**, not a labeled match: it
   assumes the auction site's export always puts location, then sale status, then buyer name as three consecutive
   unlabeled lines between the VIN/stock lines and the dated fields — true for the client's current export format
   (and documented in code comments as a heuristic for that shape), but would need revisiting if the auction site's
   paste format changes its line order.
6. **Dev server port inconsistency.** Some of this session's own ad-hoc QA scripts defaulted to port 3000, others
   (matching the repository's own `rpc-*`/`route-gate.mjs` convention) to 3100; a dev server was found not running
   at the start of this session's work (a previous session's background process had ended) and was restarted on
   3100 to match the test suites' own default.
7. **Owner's `/preview/dismantling` route remains reachable by direct URL** even though its sidebar link was
   removed (by design, per the task — "remove from navigation, not the route" — see §7.2), which means an owner who
   bookmarks or is sent that URL can still open it. This is the intended behaviour per the task, documented here so
   a future reviewer does not mistake it for an oversight.
8. **This guide does not independently re-verify every RLS policy or RPC in modules this session did not touch**
   (Sales, Vehicles core, Team, Customers, Owner Dashboard) — those sections are grounded in the original schema
   blueprint (§16) and this session's route-level tests, not a fresh line-by-line audit. Treat any specific claim
   about those modules' row-level security as **(assumption)** unless this guide's §6–§9 explicitly says it was
   read directly.
9. **No CI pipeline was found** enforcing `tsc`/`lint`/`build` on push (§13) — these checks currently depend on
   whoever makes a change running them manually, which this session did for every change it made (§ final report),
   but that discipline is not automated.

---

## 15. Change-safety rules for future AI assistants

These are not aspirational — they are the rules this session (and, per `docs/backend/*`, prior sessions) actually
followed, stated explicitly so they are not re-derived by trial and error:

1. **One source of truth per entity.** Never create a second table or a duplicate record for a vehicle, a customer,
   a part, or a person. Every module that touches "a part" or "a vehicle" must reference the existing row by id —
   see `container_planned_items.part_id` referencing `parts.id` directly as the pattern to copy, never a snapshot.
2. **The database decides, the client asks.** Never move a validation, a permission check, a duplicate/conflict
   rule, or a money calculation into client-side code "for convenience." Client-side logic may *mirror* a server
   rule for responsive UX (as this session's parser does for required-field checks), but the server must still
   enforce it independently, and the client-side mirror must be clearly commented as non-authoritative.
3. **Never write arbitrary AI-generated SQL against the live database.** Every migration in this repository is a
   reviewed, additive, numbered file, applied one at a time via the repository's own tooling
   (`apply-migration.mjs`), in its own transaction, never edited after being applied. If a migration has a bug,
   write a new migration to fix it (this session did this twice — §7.4, §7.5) rather than editing the original file.
4. **Never leak secrets.** No password, API key, service-role key, or token value is ever written into source,
   tests, docs, commit messages, or chat output — only the *names* of the environment variables that hold them
   (§11.1). Before any commit, scan the staged diff and the commit range to be pushed for password-shaped literals
   and known secret patterns.
5. **Never alter production** without being told this specific change targets production, and never push or deploy
   without the user's explicit authorization for that specific set of commits — not a standing "you may push"
   permission from an earlier task.
6. **Never force-push, `reset --hard` over remote work, or rewrite published history.** Always `git fetch origin`
   and compare before pushing; if `origin/main` has commits local `main` lacks, stop and report the divergence
   instead of guessing how to reconcile it.
7. **Run the relevant regression tests before considering a change done**, not just the new focused test for the
   change itself — this session's own work caught two real regressions (§7.4, §7.5) exactly this way, by running
   an *existing* suite that had nothing to do with the feature being added.
8. **Keep changes scoped to what was asked.** This session repeatedly declined to "also fix" or "also improve"
   adjacent things it noticed while working (e.g. the UI-only intake fields in §14.2) — it documented them as known
   limitations instead of expanding scope without being asked.
9. **Prefer an additive migration over a destructive one.** Adding a column/table/function is always safer than
   altering or dropping one that existing code depends on; if a column is genuinely obsolete, that is a decision
   for the project owner, not something to infer and act on unilaterally.
10. **Document what was verified vs. assumed**, explicitly, the way this guide does — a future assistant (or
    person) relying on a claim needs to know whether it was read in the code/tested against DEV this session, or
    carried forward from an earlier document.

---

## 16. Glossary and recommended next steps

### 16.1 Glossary

- **RPC** — a Postgres function in `supabase/migrations/*.sql`, called from the browser via `supabase.rpc(name,
  args)`. The unit of business logic in this system.
- **`SECURITY DEFINER`** — a Postgres function attribute meaning it runs with the privileges of the function's
  *owner* (effectively, full database access), not the calling user's RLS-restricted privileges — which is exactly
  why every such function must do its own explicit role/state checks rather than relying on RLS to protect it.
- **Planned part / planned-parts hold** (Containers) — a `container_planned_items` row with `status = 'planned'`;
  counts against a part's `_available_quantity` the same way a Sales reservation does, until it is removed or
  finalized.
- **Finalize / Finish Loading** — the container loader's terminal action (`container_loader_finish`); exports the
  loaded quantity from stock once, releases the rest, and the container becomes `ready_for_invoice`.
- **Sellable vs. available** — sellable is a property of a part's *state* (`_part_is_sellable_state`); available
  additionally subtracts live stock holds (`_available_quantity`). A part can be sellable with zero availability.
- **Preview mode** — an owner viewing a route as another role would see it, read-only, for QA (`effective-user.ts`,
  `/preview/*` routes).
- **Idempotency key / client request id** — a UUID the client generates once per logical action and resends on
  retry; the matching RPC returns the same result instead of repeating the action.
- **Legacy container** (`parts_planning = false`) — a container opened before this session's planned-parts feature
  existed; has no structured loaded-parts list and is displayed as such rather than fabricated.

### 16.2 Relationship to `docs/backend/*` (pre-existing, tracked documentation)

Three files predate this guide and are **historical planning artifacts, not re-verified against the current
repository in full by this guide**:
- `docs/backend/DATABASE_SCHEMA_BLUEPRINT.md` — the **original design proposal**, explicitly marked in its own
  first line as "PROPOSED — NOT YET APPLIED TO ANY DATABASE" at the time it was written. The actual applied schema
  has since grown far beyond it (75 migrations vs. the blueprint's initial proposal) — use it for historical design
  *rationale* (it explains *why* certain decisions were made, e.g. the Draft/Reserve/Fulfill stock model, the
  payments-allocatable-across-sales model), not as a current column-by-column reference. This guide's §6 is the
  current reference.
- `docs/backend/IMPLEMENTATION_PROGRESS.md` and `docs/backend/AUTONOMOUS_WORK_QUEUE.md` — resume-point notes from
  earlier autonomous work sessions, last updated 2026-10-04/05 per their own headers, predating this session's
  Scrap-assignment, Containers-planned-parts, Warehouse-app, Auction-parser, and Nav-cleanup work. Useful as a
  narrative of *how* the dismantling v2 workflow and other earlier modules came to be, not as a status board for
  the current state — this guide's §4/§5/§14 are current.
- `docs/backend/LAL_MOTORS_AUTONOMOUS_IMPLEMENTATION_MASTER.txt` — the original autonomous-session operating
  contract (status legend, completion criteria). Process documentation, not a system reference.

**Recommendation:** keep these three files for historical context (they explain *why*, which this guide mostly
does not re-derive), but treat **this guide plus the actual code and migrations** as authoritative for *what is
true right now*. If a future session makes a substantial change, prefer updating this guide's relevant section over
creating a fourth progress-tracking document.

### 16.3 Recommended next steps

1. Decide whether to extend `intake_commit_batch` to persist the currently UI-only intake fields (§14.2), or
   remove them from the review editor — don't leave them silently half-wired.
2. Add the `vehicles.payment_due_date` column (or decide it's genuinely out of scope) so the auction "Due:" date
   has somewhere real to go (§14.3).
3. Confirm `engineer_admin`'s current password with whoever owns the DEV seed data, so the full test suite can run
   unattended (§14.1).
4. Add a CI workflow running `npx tsc --noEmit`, `npm run lint`, and `npm run build` on every push, since this is
   currently a manual discipline (§14.9).
5. Confirm with the project owner whether a distinct production Supabase project exists, and if so, document its
   connection details' *location* (a secrets manager, not this file) and the exact migration-promotion process from
   DEV to it — currently undocumented (§13).
6. When the client's auction export format changes, re-check the positional `location`/`pickupStatus` heuristic in
   `parse-intake.ts` (§14.5) against the new sample before assuming it still applies.
