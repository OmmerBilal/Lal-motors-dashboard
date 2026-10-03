-- =====================================================================================
-- LAL Motors — Minimal development seed data
-- =====================================================================================
-- Target: a database that has already had 0001_initial_schema.sql applied.
-- Purpose: just enough linked records to exercise each workflow once. NOT hundreds of
-- records, NOT production data, NOT real people/customers/vehicles.
--
-- IMPORTANT — auth.users / Supabase Auth:
-- This file deliberately does NOT insert into auth.users. Supabase Auth owns that table
-- (password hashing, confirmation tokens, session machinery) and hand-inserting rows into
-- it bypasses all of that — a well-known foot-gun that produces users who look real but
-- cannot actually authenticate. The correct way to create test users, once you have a real
-- Supabase project and this schema applied, is:
--
--   1. Use the Supabase CLI/Admin API to create each test auth user, e.g.:
--        supabase.auth.admin.createUser({ email, password, email_confirm: true })
--      or, from the dashboard: Authentication -> Users -> Add user.
--   2. The `handle_new_auth_user()` trigger (see 0001_initial_schema.sql, §2) fires
--      automatically on that insert and creates the matching public.profiles row for you.
--   3. THEN run the rest of this seed file, which assumes a fixed, known set of profile
--      ids. Either:
--        a) create your auth users first with fixed ids (the Admin API lets you pass a
--           uuid), matching the placeholder ids below, or
--        b) replace every placeholder profile id below with the real ids Supabase
--           generated for your test users before running this file.
--
-- The six placeholder profile ids used throughout this file (replace before running):
--   11111111-1111-1111-1111-111111111111  Owner            owner@seed.lalmotors.test
--   22222222-2222-2222-2222-222222222222  Front Desk Mgr   manager@seed.lalmotors.test
--   33333333-3333-3333-3333-333333333333  Dismantling Emp  dismantler@seed.lalmotors.test
--   44444444-4444-4444-4444-444444444444  Scrap Driver     driver@seed.lalmotors.test
--   55555555-5555-5555-5555-555555555555  Container Loader loader@seed.lalmotors.test
--   66666666-6666-6666-6666-666666666666  Export Manager   export@seed.lalmotors.test
--
-- If your project has RLS fully enforced and you're running this via the SQL editor or
-- `supabase db reset`, it executes as the `postgres` role, which bypasses RLS — no need
-- to disable RLS to run this file.
-- =====================================================================================

-- #######################################################################################
-- 1. ROLE / PERMISSION LOOKUP DATA
-- #######################################################################################

insert into public.roles (key, label, description) values
  ('owner',             'Owner / Admin',            'Full system access.'),
  ('engineer_admin',    'Engineer Admin',            'Operational admin access, not account-ownership actions.'),
  ('manager',           'Front Desk Manager',        'Customers, sales, vehicle operations.'),
  ('employee',          'Warehouse Employee',        'Parts inventory and operations.'),
  ('auction',           'Auction Vehicle Employee',  'Auction intake and vehicle inventory.'),
  ('receiving',         'Vehicle Receiving Employee','Vehicle receiving and arrival.'),
  ('dismantling',       'Dismantling Employee App',  'Dismantling workflow and Quick Part Capture.'),
  ('scrap_driver',      'Scrap Driver',              'Scrap load pickup and delivery.'),
  ('container_loading', 'Container Loading Employee','Loads containers; no export-financial access.'),
  ('export_manager',    'Export Manager',            'Export invoicing and shipping confidentiality.')
on conflict (key) do nothing;

insert into public.permissions (key, label, description) values
  ('containers.view_confidential', 'View confidential container/export data', 'Consignee, pricing, invoices, payments.'),
  ('parts.set_pricing',            'Set part pricing',                        'Price and core charge edits.')
on conflict (key) do nothing;

-- #######################################################################################
-- 2. PROFILES + ROLE ASSIGNMENTS
-- #######################################################################################
-- See the header comment above: these rows assume auth.users already has matching ids.
-- If handle_new_auth_user() already created these profiles for you, the inserts below are
-- redundant and `on conflict do nothing` makes them harmless; they're included so this
-- file is self-describing even if you choose path (a) from the header.

insert into public.profiles (id, email, name, account_status) values
  ('11111111-1111-1111-1111-111111111111', 'owner@seed.lalmotors.test',      'Seed Owner',             'active'),
  ('22222222-2222-2222-2222-222222222222', 'manager@seed.lalmotors.test',    'Seed Front Desk Manager','active'),
  ('33333333-3333-3333-3333-333333333333', 'dismantler@seed.lalmotors.test', 'Seed Dismantler',        'active'),
  ('44444444-4444-4444-4444-444444444444', 'driver@seed.lalmotors.test',     'Seed Scrap Driver',      'active'),
  ('55555555-5555-5555-5555-555555555555', 'loader@seed.lalmotors.test',    'Seed Container Loader',  'active'),
  ('66666666-6666-6666-6666-666666666666', 'export@seed.lalmotors.test',    'Seed Export Manager',    'active'),
  -- Four more, added for full 10-role RLS test coverage (Auth/RBAC implementation pass):
  ('77777777-7777-7777-7777-777777777777', 'engineer@seed.lalmotors.test',   'Seed Engineer Admin',    'active'),
  ('88888888-8888-8888-8888-888888888888', 'warehouse@seed.lalmotors.test',  'Seed Warehouse Employee','active'),
  ('99999999-9999-9999-9999-999999999999', 'auction@seed.lalmotors.test',    'Seed Auction Employee',  'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'receiving@seed.lalmotors.test',  'Seed Receiving Employee','active')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id)
select p.id, r.id from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'owner'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'manager'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'dismantling'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'scrap_driver'),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'container_loading'),
  ('66666666-6666-6666-6666-666666666666'::uuid, 'export_manager'),
  ('77777777-7777-7777-7777-777777777777'::uuid, 'engineer_admin'),
  ('88888888-8888-8888-8888-888888888888'::uuid, 'employee'),
  ('99999999-9999-9999-9999-999999999999'::uuid, 'auction'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'receiving')
) as x(profile_id, role_key)
join public.profiles p on p.id = x.profile_id
join public.roles r on r.key = x.role_key
on conflict do nothing;

-- #######################################################################################
-- 3. VEHICLES — a few states across the pipeline
-- #######################################################################################

insert into public.vehicles (id, vin, lot_number, stock_number, year, make, model, trim, status, purchase_price, auction_fees, transportation_cost, created_by) values
  ('a0000000-0000-0000-0000-000000000001', '1HGCM82633A004352', 'LOT-1001', null,        2015, 'Honda',  'Accord',  'EX-L', 'Purchased',          3200.00, 150.00,   0.00, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000002', '1FTFW1EF1EFA12345', 'LOT-1002', 'STK-2002',  2016, 'Ford',   'F-150',   'XLT',  'Available at Yard',  5400.00, 180.00, 220.00, '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000003', '3VWFE21C04M000321', 'LOT-1003', 'STK-2003',  2012, 'Volkswagen','Jetta','SE',   'Processing',         1800.00, 120.00, 190.00, '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

update public.vehicles set receiving_status = 'received', received_by = '22222222-2222-2222-2222-222222222222', received_at = now()
where id in ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003');

-- #######################################################################################
-- 4. DISMANTLING — one session with a captured + approved part
-- #######################################################################################

insert into public.dismantling_sessions (id, vehicle_id, employee_id, started_at, ended_at, status, part_photos_captured) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', now() - interval '2 hours', now() - interval '1 hour', 'completed', 1)
on conflict (id) do nothing;

insert into public.vehicle_events (id, vehicle_id, action, part_ref, part_type, disposition, actor_id, actor_name, dismantling_session_id) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'PART_REMOVED', 'c0000000-0000-0000-0000-000000000001', 'Alternator', 'IN INVENTORY', '33333333-3333-3333-3333-333333333333', 'Seed Dismantler', 'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.parts (id, vehicle_id, source_vehicle_event_id, dismantling_session_id, status, stage, source_vin, part_name, category, price, captured_by, approved_by, approved_at) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'approved', 'needs_processing', '3VWFE21C04M000321', 'Alternator', 'Electrical', 95.00, '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', now())
on conflict (id) do nothing;

-- A second, standalone approved part (no donor vehicle/dismantling link) — exercises
-- parts.vehicle_id being nullable, and gives the Reserve-stock example below something to
-- reserve against.
insert into public.parts (id, status, stage, part_name, category, price, quantity, operational_status, captured_by, approved_by, approved_at) values
  ('d0000000-0000-0000-0000-000000000002', 'approved', 'ready_for_sale', 'Battery', 'Electrical', 120.00, 1, 'AVAILABLE', '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', now())
on conflict (id) do nothing;

-- #######################################################################################
-- 5. CUSTOMER + SALES ORDERS (one fulfilled/paid, one reserved/pending-payment)
-- #######################################################################################

insert into public.customers (id, customer_number, first_name, last_name, phone, phone_normalized, email, customer_type) values
  ('e0000000-0000-0000-0000-000000000001', 'CUST-0001', 'Jordan', 'Vega', '555-0100', '5550100', 'jordan.vega@seed.lalmotors.test', 'retail')
on conflict (id) do nothing;

insert into public.quotes (id, quote_number, customer_id, salesperson_id, status, subtotal, total) values
  ('f0000000-0000-0000-0000-000000000001', 'Q-0001', 'e0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'CONVERTED', 95.00, 95.00)
on conflict (id) do nothing;

-- Sale 1: fully fulfilled and posted-paid — the "normal" completed-sale example.
-- finalized_at MUST be set together with status = 'COMPLETED' (sales_finalized_at_chk).
insert into public.sales (id, sale_number, quote_id, customer_id, salesperson_id, subtotal, total, amount_paid, balance_due, payment_status, status, fulfillment_status, finalized_at) values
  ('10000000-0000-0000-0000-000000000001', 'S-0001', 'f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 95.00, 95.00, 95.00, 0.00, 'PAID', 'COMPLETED', 'fulfilled', now())
on conflict (id) do nothing;

update public.quotes set converted_sale_id = '10000000-0000-0000-0000-000000000001' where id = 'f0000000-0000-0000-0000-000000000001';

-- Sale 2: a battery placed on hold for the customer — Reserve stock action only, nothing
-- fulfilled yet, so fulfillment_status is 'unfulfilled' (NOT 'partial' — partial would imply
-- some line has actually been consumed; a reservation alone has not consumed anything). No
-- payment posted yet either. status stays 'OPEN', so finalized_at stays null.
insert into public.sales (id, sale_number, customer_id, salesperson_id, subtotal, total, amount_paid, balance_due, payment_status, status, fulfillment_status) values
  ('10000000-0000-0000-0000-000000000002', 'S-0002', 'e0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 120.00, 120.00, 0.00, 120.00, 'UNPAID', 'OPEN', 'unfulfilled')
on conflict (id) do nothing;

insert into public.sale_items (id, sale_id, part_id, description, quantity, unit_price, line_total, stock_action) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Alternator — 2012 Volkswagen Jetta', 1, 95.00, 95.00, 'fulfill'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Battery — held for customer pickup', 1, 120.00, 120.00, 'reserve')
on conflict (id) do nothing;

-- Reservation backing the Alternator line's 'fulfill' stock_action: immediately fulfilled
-- (quantity actually consumed), not left active — Sale 1 is the fully-completed example.
-- part_id/sale_id here MUST agree with sale_items row 11...0001 above (enforced by the
-- check_reservation_integrity trigger — this row would be rejected otherwise).
insert into public.inventory_reservations (id, part_id, sale_id, sale_item_id, quantity, status, fulfilled_at, created_by) values
  ('1c000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 1, 'fulfilled', now(), '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- The Alternator is actually consumed by Sale 1: quantity decremented to 0 and marked SOLD —
-- NOT deleted or hidden (item 8 of the hardening pass: zero-quantity stays visible as "Out of
-- Stock"; here it additionally shows as SOLD, which is the correct terminal state for a
-- unique salvage part, not a restockable SKU).
update public.parts set operational_status = 'SOLD', quantity = 0 where id = 'd0000000-0000-0000-0000-000000000001';
insert into public.part_operations (id, part_id, action_type, previous_status, new_status, previous_quantity, new_quantity, note, actor_id, actor_name, actor_role) values
  ('1e000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'SOLD', 'AVAILABLE', 'SOLD', 1, 0, 'Consumed by sale S-0001', '22222222-2222-2222-2222-222222222222', 'Seed Front Desk Manager', 'manager')
on conflict (id) do nothing;

-- Reservation backing the Battery line's 'reserve' stock_action: stock exists, not yet
-- consumed — stays 'active', unlike the Alternator's row above.
insert into public.inventory_reservations (id, part_id, sale_id, sale_item_id, quantity, status, created_by) values
  ('1c000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 1, 'active', '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;
update public.parts set operational_status = 'RESERVED' where id = 'd0000000-0000-0000-0000-000000000002';

-- Payment 1: already POSTED and allocated in full against Sale 1 — this is why Sale 1's
-- amount_paid/balance_due above already reflect it (posting is what would set those columns;
-- this seed just inserts the already-posted end-state rather than simulating the RPC call).
insert into public.payments (id, payment_number, customer_id, amount, method, status, received_by, posted_at, posted_by) values
  ('12000000-0000-0000-0000-000000000001', 'P-0001', 'e0000000-0000-0000-0000-000000000001', 95.00, 'CARD', 'posted', '22222222-2222-2222-2222-222222222222', now(), '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;
insert into public.payment_allocations (id, payment_id, sale_id, amount) values
  ('1d000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 95.00)
on conflict (id) do nothing;

-- Payment 2: a deposit the customer handed over for Sale 2, created and allocated but still
-- PENDING — the critical rule this demonstrates: Sale 2's amount_paid above stays 0.00 and
-- balance_due stays 120.00 even though this payment+allocation already exist. Only
-- post_payment() (deferred, not implemented) would flip status to 'posted' and update Sale 2.
insert into public.payments (id, payment_number, customer_id, amount, method, status, received_by) values
  ('12000000-0000-0000-0000-000000000002', 'P-0002', 'e0000000-0000-0000-0000-000000000001', 20.00, 'CASH', 'pending', '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;
insert into public.payment_allocations (id, payment_id, sale_id, amount) values
  ('1d000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 20.00)
on conflict (id) do nothing;

insert into public.invoices (id, invoice_number, sale_id, snapshot, created_by) values
  ('13000000-0000-0000-0000-000000000001', 'INV-0001', '10000000-0000-0000-0000-000000000001',
   '{"sale_number":"S-0001","customer":"Jordan Vega","items":[{"description":"Alternator — 2012 Volkswagen Jetta","quantity":1,"unit_price":95.00,"line_total":95.00}],"total":95.00,"amount_paid":95.00}'::jsonb,
   '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- #######################################################################################
-- 6. SCRAP — driver load + rim obligation
-- #######################################################################################

insert into public.scrap_loads (id, driver_id, load_date, status) values
  ('14000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', current_date, 'ready_for_review')
on conflict (id) do nothing;

insert into public.scrap_load_financials (scrap_load_id, weight, rate, amount, measured_by, measured_at) values
  ('14000000-0000-0000-0000-000000000001', 2200.00, 0.18, 396.00, '22222222-2222-2222-2222-222222222222', now())
on conflict (scrap_load_id) do nothing;

insert into public.rim_obligations (id, customer_id, tires_qty, aluminum_owed, steel_owed, employee_id) values
  ('15000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 4, 2, 2, '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into public.rim_returns (id, obligation_id, aluminum_returned, steel_returned, employee_id) values
  ('16000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 1, 0, '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- #######################################################################################
-- 7. CONTAINER / EXPORT — one container with a draft invoice and a payment
-- #######################################################################################

insert into public.container_jobs (id, t_ref, container_number, number_confirmed, status, started_at, created_by) values
  ('17000000-0000-0000-0000-000000000001', 'T26', 'MSCU1234567', true, 'ready_for_invoice', now() - interval '1 day', '55555555-5555-5555-5555-555555555555')
on conflict (id) do nothing;

insert into public.consignees (id, company, contact, country) values
  ('18000000-0000-0000-0000-000000000001', 'Seed Overseas Imports Ltd.', 'A. Rossi', 'Italy')
on conflict (id) do nothing;

insert into public.container_shipping_info (container_id, destination_country, destination_port, consignee_id) values
  ('17000000-0000-0000-0000-000000000001', 'Italy', 'Port of Genoa', '18000000-0000-0000-0000-000000000001')
on conflict (container_id) do nothing;

insert into public.export_invoices (id, container_id, t_ref, invoice_number, status, consignee_id, consignee_snapshot, destination) values
  ('19000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'T26', 'EINV-0001', 'Draft', '18000000-0000-0000-0000-000000000001',
   '{"company":"Seed Overseas Imports Ltd.","contact":"A. Rossi","country":"Italy"}'::jsonb, 'Italy')
on conflict (id) do nothing;

insert into public.export_invoice_line_items (id, invoice_id, description, quantity, unit_price, category, condition) values
  ('1a000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Mixed used auto parts, 1x40ft container', 1, 4800.00, 'Mixed', 'Used')
on conflict (id) do nothing;

insert into public.export_payments (id, invoice_id, amount, type, method, entered_by) values
  ('1b000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 1500.00, 'Deposit', 'Wire', '66666666-6666-6666-6666-666666666666')
on conflict (id) do nothing;

-- #######################################################################################
-- 8. A FEW AUDIT LOG ROWS
-- #######################################################################################
-- NOTE: in production these rows would be written exclusively by public.write_audit_log()
-- (called from inside a domain RPC) — 0001_initial_schema.sql deliberately gives audit_logs
-- no direct client INSERT policy at all (see blueprint §3/§11). This seed file is exempt
-- because it runs as the `postgres` role (via the SQL editor or `supabase db reset`), which
-- bypasses RLS entirely — that is not a loophole available to an application client.

insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary) values
  ('33333333-3333-3333-3333-333333333333', 'Seed Dismantler', 'dismantling', 'PART_APPROVED', 'part', 'd0000000-0000-0000-0000-000000000001', 'Alternator approved into Parts Inventory'),
  ('22222222-2222-2222-2222-222222222222', 'Seed Front Desk Manager', 'manager', 'SALE_FINALIZED', 'sale', '10000000-0000-0000-0000-000000000001', 'Sale S-0001 finalized and paid in full'),
  ('22222222-2222-2222-2222-222222222222', 'Seed Front Desk Manager', 'manager', 'PAYMENT_POSTED', 'payment', '12000000-0000-0000-0000-000000000001', 'Payment P-0001 posted and allocated to S-0001'),
  ('55555555-5555-5555-5555-555555555555', 'Seed Container Loader', 'container_loading', 'CONTAINER_NUMBER_CONFIRMED', 'container', '17000000-0000-0000-0000-000000000001', 'Container number MSCU1234567 confirmed for T26');

-- #######################################################################################
-- 9. SUPPLIERS / PURCHASE ORDERS — intentionally NOT seeded
-- #######################################################################################
-- No supplier/vendor/purchase-order/PO concept exists anywhere in the current frontend
-- (src/), legacy reference backend, or git history — confirmed by repository-wide search
-- before writing this migration. Per the explicit "do not invent functionality that is not
-- present" instruction, no suppliers/purchase_orders/supplier_payments tables were added to
-- 0001_initial_schema.sql, so there is nothing to seed here. The closest existing concept —
-- a vehicle's own auction purchase invoice/balance — is already covered by
-- vehicles.invoice_amount/balance_due on the seeded vehicles above; see
-- docs/backend/DATABASE_SCHEMA_BLUEPRINT.md §5 for the full finding.

-- =====================================================================================
-- End of seed.sql — intentionally small. Add more rows only as specific later workflows
-- (e.g. a second in-progress dismantling session, a daily close example, a posted
-- reservation->fulfillment transition) need exercising.
-- =====================================================================================
