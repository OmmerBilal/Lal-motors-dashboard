-- =====================================================================================
-- LAL Motors — Initial production schema
-- =====================================================================================
-- Target: a NEW, EMPTY Supabase Postgres project.
-- Scope: schema + constraints + indexes + RLS + standard utility triggers ONLY.
-- Explicitly OUT of scope for this migration (deferred to later, module-by-module):
--   - business RPC / domain functions (finalize_sale, approve_dismantled_part, etc.)
--   - Storage bucket creation (done via the Supabase dashboard/CLI, not SQL)
--   - demo/seed data (see supabase/seed.sql)
--
-- Design is derived from the CURRENT approved new-production frontend (post Yard-removal,
-- post "Dismantling Employee App" + Quick Part Capture) and cross-checked against the
-- legacy Cloudflare D1 backend for business rules worth preserving. See
-- docs/backend/DATABASE_SCHEMA_BLUEPRINT.md for the full narrative, ER diagram, and the
-- reasoning behind every non-obvious decision referenced in comments below.
--
-- Do NOT run this against a database that already has data you care about.
-- =====================================================================================


-- #######################################################################################
-- 0. EXTENSIONS
-- #######################################################################################

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email matching
create extension if not exists pg_trgm;    -- fuzzy/ILIKE search indexes (customer, part, vehicle text search)


-- #######################################################################################
-- 1. SHARED HELPERS
-- #######################################################################################

-- Generic updated_at maintenance trigger, applied per-table below where the table has an
-- updated_at column. Kept intentionally dumb (schema infrastructure only, no business logic).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Standard BEFORE UPDATE trigger: stamps updated_at = now(). No business logic.';


-- #######################################################################################
-- 2. IDENTITY & ACCESS  (profiles / roles / permissions / invites)
-- #######################################################################################
-- Auth identity itself lives in Supabase's own auth.users (see §8 of the blueprint doc for
-- the Supabase Auth vs. legacy-auth comparison and recommendation). public.profiles is the
-- 1:1 business-profile row keyed by the SAME id as auth.users — never a separate identity.
--
-- Role model is deliberately NOT a single flat `role` text column on profiles (the frontend
-- UI still only needs one role per person today, but RBAC should not be locked into that):
-- roles/permissions/role_permissions/user_roles let one person hold more than one role,
-- and let a permission's role-mapping change without a code deploy.

create table public.roles (
  id          smallint generated always as identity primary key,
  key         text not null,
  label       text not null,
  description text not null default '',
  created_at  timestamptz not null default now()
);
comment on table public.roles is
  'Lookup of role keys. Seeded in seed.sql with the 10 roles the current frontend models '
  '(owner, engineer_admin, manager, employee, auction, receiving, dismantling, scrap_driver, '
  'container_loading, export_manager) — "yard" was removed from the product and is not seeded.';
create unique index roles_key_key on public.roles (key);

create table public.permissions (
  id          smallint generated always as identity primary key,
  key         text not null,
  label       text not null,
  description text not null default '',
  created_at  timestamptz not null default now()
);
comment on table public.permissions is
  'Fine-grained capability keys (e.g. containers.view_confidential, parts.set_pricing). '
  'Seeded minimally; the catalog is expected to grow as backend modules are built.';
create unique index permissions_key_key on public.permissions (key);

create table public.role_permissions (
  role_id       smallint not null references public.roles(id) on delete cascade,
  permission_id smallint not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         citext not null,
  name          text not null,
  phone         text,
  account_status text not null default 'active'
                check (account_status in ('active','disabled','removed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
comment on table public.profiles is
  'One business-profile row per auth.users row. Never create a second identity table — '
  'Dismantling Employee, Scrap Driver, Container Loading Employee, Export Manager, etc. are '
  'roles on this ONE profile via user_roles, never duplicate person records.';
create unique index profiles_email_key on public.profiles (email);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Standard Supabase infrastructure trigger: creates the 1:1 profiles row the moment Supabase
-- Auth creates an auth.users row (signup, or invite acceptance — see blueprint §8). Without
-- this, no profiles row could ever be created client-side (profiles has no insert RLS policy
-- by design — see §11). SECURITY DEFINER so it can write to public.profiles despite RLS.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$;
comment on function public.handle_new_auth_user() is
  'Populates public.profiles from auth.users on signup/invite-accept. No business logic.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create table public.user_roles (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role_id     smallint not null references public.roles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index user_roles_role_id_idx on public.user_roles (role_id);

create table public.user_invites (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null,
  name              text not null,
  role_id           smallint not null references public.roles(id),
  status            text not null default 'pending'
                    check (status in ('pending','accepted','cancelled')),
  invited_by        uuid not null references public.profiles(id),
  invited_at        timestamptz not null default now(),
  accepted_at       timestamptz,
  accepted_user_id  uuid references public.profiles(id)
);
comment on table public.user_invites is
  'Invite rows are created by the app; actual email delivery + token handling is Supabase '
  'Auth''s invite flow (auth.admin.inviteUserByEmail), not a custom token table — see '
  'blueprint §8. This table tracks who was invited to which role, not the token itself.';
-- Only one live pending invite per email at a time; a cancelled/accepted invite frees the email up.
create unique index user_invites_pending_email_key
  on public.user_invites (email) where status = 'pending';
create index user_invites_status_idx on public.user_invites (status);

-- --- RBAC helper functions -------------------------------------------------------------
-- SECURITY DEFINER + fixed search_path (Supabase best practice: prevents search-path
-- hijacking) + STABLE (safe to call repeatedly per-row inside an RLS policy).

create or replace function public.has_role(role_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.key = role_key
  );
$$;
comment on function public.has_role(text) is 'True if the current auth user holds the given role key.';

create or replace function public.has_any_role(variadic role_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.key = any(role_keys)
  );
$$;
comment on function public.has_any_role(text[]) is 'True if the current auth user holds any of the given role keys.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('owner', 'engineer_admin');
$$;
comment on function public.is_admin() is
  'Operational admin check (owner OR engineer_admin). NOT the same as "is owner" — account/role '
  'administration (removing the Owner role, disabling accounts) must use a stricter owner-only '
  'check at the service layer; engineer_admin inherits operational access only, per blueprint §7.';

create or replace function public.is_export_authorized()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('owner', 'engineer_admin', 'export_manager');
$$;
comment on function public.is_export_authorized() is
  'Container Export confidentiality gate. Front Desk Manager is deliberately NOT included — '
  'an ordinary manager must not receive Export access automatically (explicit client requirement).';

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('owner');
$$;
comment on function public.is_owner() is
  'STRICTER than is_admin(). Privileged role assignment, account disable/removal, invite '
  'management and role/permission administration must gate on this, not is_admin() — '
  'otherwise Engineer Admin could grant itself (or anyone) the Owner role, a privilege '
  'escalation. Engineer Admin keeps full OPERATIONAL access via is_admin(); it never '
  'automatically receives account-ownership authority.';

-- --- Domain-scoped staff helpers ---------------------------------------------------------
-- Replace blanket `auth.role() = ''authenticated''` business-table policies below. Derived
-- directly from src/lib/nav.ts role→screen mapping (confirmed against the current frozen
-- frontend): navigation hiding is not security, but the SET of roles each helper names is
-- exactly the set the product actually routes to that domain's screens — not a guess.

create or replace function public.is_vehicle_domain_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Vehicles / Auction / Receiving / Central Dispatch, PLUS the Dismantling Employee App,
  -- which must read/update vehicles (find/confirm, status changes) and write vehicle_events
  -- even though it has no separate /vehicles nav entry of its own.
  select public.has_any_role('owner', 'engineer_admin', 'manager', 'auction', 'receiving', 'dismantling');
$$;
comment on function public.is_vehicle_domain_staff() is
  'Vehicles, carriers, vehicle_events, vehicle_intake_*, vehicle_completions. Matches nav.ts: '
  'owner/engineer_admin/manager/auction/receiving all route to vehicle-workspace screens; '
  'dismantling is included because the Dismantling Employee App operates on vehicles directly.';

create or replace function public.is_dismantling_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('owner', 'engineer_admin', 'manager', 'dismantling');
$$;
comment on function public.is_dismantling_staff() is
  'dismantling_sessions specifically — tighter than is_vehicle_domain_staff(): auction/receiving '
  'have no business starting a dismantling session (nav.ts gives them no dismantling screen).';

create or replace function public.is_parts_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- employee = Warehouse Employee (Quick Part Capture at /parts in nav.ts); dismantling also
  -- creates parts directly via its own Quick Part Capture mode.
  select public.has_any_role('owner', 'engineer_admin', 'manager', 'employee', 'dismantling');
$$;
comment on function public.is_parts_staff() is
  'parts, part_operations. manager reviews/prices parts (nav.ts: "Pending Parts & Inventory"); '
  'employee and dismantling both create part rows from their respective capture flows.';

create or replace function public.is_sales_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('owner', 'engineer_admin', 'manager');
$$;
comment on function public.is_sales_staff() is
  'customers, quotes, sales, sale_items, payments, payment_allocations, invoices, returns, '
  'inventory_reservations, sales_settings. Matches nav.ts: only owner/engineer_admin/manager '
  'route to /sales — auction, receiving, dismantling, scrap_driver, container_loading and '
  'export_manager have no Customers & Sales screen at all.';

create or replace function public.is_scrap_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role('owner', 'engineer_admin', 'manager', 'auction');
$$;
comment on function public.is_scrap_office() is
  'Office-side scrap/tire-rim access (weight/rate/amount, payment reconciliation, daily close, '
  'rim obligations/returns). "auction" is included deliberately — nav.ts routes the Auction '
  'Vehicle Employee to Scrap Loads too, mirroring legacy''s own cross-cutting office-access rule. '
  'Scrap Driver gets a separate own-records-only policy, never this helper.';

create or replace function public.is_container_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Operational container access (container_jobs, container_events) — NOT the confidential
  -- extension tables, which stay gated by is_export_authorized() below. "manager" is
  -- deliberately excluded: nav.ts gives Front Desk Manager no Containers & Export screen.
  select public.has_any_role('owner', 'engineer_admin', 'export_manager', 'container_loading');
$$;
comment on function public.is_container_staff() is
  'container_jobs, container_events (operational/loader-safe layer). Matches nav.ts: owner, '
  'engineer_admin, export_manager and container_loading all route to a Containers screen; '
  'manager does not. Confidentiality within this domain is a SEPARATE gate — see is_export_authorized().';

create or replace function public.can_access_media(p_owner_type text, p_owner_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return case
    when p_owner_type in ('vehicle', 'vehicle_completion', 'vehicle_intake_batch')
      then public.is_vehicle_domain_staff()
    when p_owner_type = 'dismantling_session'
      then public.is_dismantling_staff()
    when p_owner_type = 'part'
      then public.is_parts_staff()
    when p_owner_type = 'customer'
      then public.is_sales_staff()
    when p_owner_type in ('rim_obligation', 'rim_return')
      then public.is_scrap_office() or public.has_role('scrap_driver')
    when p_owner_type = 'scrap_load'
      then public.is_scrap_office()
        or exists (select 1 from public.scrap_loads sl where sl.id = p_owner_id and sl.driver_id = auth.uid())
    when p_owner_type = 'scrap_payment'
      then public.is_scrap_office()
        or exists (select 1 from public.scrap_payments sp where sp.id = p_owner_id and sp.driver_id = auth.uid())
    when p_owner_type = 'driver_check'
      then public.is_scrap_office()
        or exists (select 1 from public.driver_check_submissions d where d.id = p_owner_id and d.driver_id = auth.uid())
    when p_owner_type = 'container'
      then public.is_container_staff()
    when p_owner_type in ('export_invoice', 'export_payment')
      then public.is_export_authorized()
    else false
  end;
end;
$$;
comment on function public.can_access_media(text, uuid) is
  'Single domain-authorization gate for media_assets reads AND writes, keyed by owner_type/ '
  'owner_id — replaces a blanket "any authenticated user" policy per the explicit requirement '
  'that media creation (and read) respect the same domain/ownership boundaries as the record '
  'it documents. A Scrap Driver only passes for their OWN scrap_load/scrap_payment/driver_check '
  'rows (checked via EXISTS against the real owner table); every other owner_type is gated by '
  'the matching domain-staff helper above. The media row''s own owner_type/owner_id are not '
  'hard-FKed (Section 6.2 of the blueprint explains why), so this function is what actually '
  'enforces the boundary instead. NOTE: this checks AUTHORIZATION only — whether the caller is '
  'allowed to touch that domain. It does NOT check that owner_id actually exists; that is '
  'media_owner_exists() below, and the insert policy requires BOTH.';

-- Existence check companion to can_access_media() above: a caller who legitimately passes
-- the domain-authorization gate could still supply a random/nonexistent owner_id (typo, stale
-- client state, or a deliberate probe) — without this, media_assets would happily accept a
-- row pointing at nothing. Checked against the REAL owner table per owner_type, not inferred.
create or replace function public.media_owner_exists(p_owner_type text, p_owner_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return case p_owner_type
    when 'vehicle' then exists (select 1 from public.vehicles where id = p_owner_id)
    when 'vehicle_completion' then exists (select 1 from public.vehicle_completions where id = p_owner_id)
    when 'vehicle_intake_batch' then exists (select 1 from public.vehicle_intake_batches where id = p_owner_id)
    when 'dismantling_session' then exists (select 1 from public.dismantling_sessions where id = p_owner_id)
    when 'part' then exists (select 1 from public.parts where id = p_owner_id)
    when 'customer' then exists (select 1 from public.customers where id = p_owner_id)
    when 'scrap_load' then exists (select 1 from public.scrap_loads where id = p_owner_id)
    when 'scrap_payment' then exists (select 1 from public.scrap_payments where id = p_owner_id)
    when 'driver_check' then exists (select 1 from public.driver_check_submissions where id = p_owner_id)
    when 'rim_obligation' then exists (select 1 from public.rim_obligations where id = p_owner_id)
    when 'rim_return' then exists (select 1 from public.rim_returns where id = p_owner_id)
    when 'container' then exists (select 1 from public.container_jobs where id = p_owner_id)
    when 'export_invoice' then exists (select 1 from public.export_invoices where id = p_owner_id)
    when 'export_payment' then exists (select 1 from public.export_payments where id = p_owner_id)
    else false
  end;
end;
$$;
comment on function public.media_owner_exists(text, uuid) is
  'Existence check for media_assets.owner_id against the REAL table for that owner_type — a '
  'random/nonexistent owner_id fails this (returns false) regardless of the caller''s domain '
  'authorization. LANGUAGE plpgsql so the forward references to tables created later in this '
  'file (vehicles, parts, scrap_loads, etc. — this function is defined in Section 2, before '
  'any of them exist yet) resolve at CALL time, not at CREATE FUNCTION time.';

-- p_actor_role is deliberately NOT a parameter — a caller-supplied role string cannot be
-- trusted (nothing stops a compromised/buggy caller from passing 'owner' regardless of their
-- real roles). actor_role is derived server-side from the CALLER'S ACTUAL rows in
-- public.user_roles, the same source of truth every RLS policy already trusts.
create or replace function public.write_audit_log(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_summary     text,
  p_changes     jsonb default '{}'::jsonb,
  p_reason      text default null,
  p_request_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id         uuid;
  v_actor_name text;
  v_actor_role text;
begin
  select name into v_actor_name from public.profiles where id = auth.uid();
  select string_agg(r.key, ',' order by r.key) into v_actor_role
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid();
  insert into public.audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, changes, reason, request_id)
  values (auth.uid(), coalesce(v_actor_name, 'unknown'), coalesce(v_actor_role, 'none'), p_action, p_entity_type, p_entity_id, p_summary, p_changes, p_reason, p_request_id)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.write_audit_log(text, text, uuid, text, jsonb, text, uuid) is
  'The ONLY path that should ever insert into audit_logs. Trusted internal helper, not a '
  'business RPC — it makes no AUTHORIZATION decision of its own (every domain RPC that calls '
  'it is responsible for having already checked the caller may perform the underlying action); '
  'it DOES, however, derive actor_role itself from public.user_roles rather than trusting a '
  'caller-supplied value — there is no p_actor_role parameter. EXECUTE is revoked from '
  'public/anon/authenticated below (see the SECURITY DEFINER PRIVILEGE AUDIT block) — a client '
  'cannot call this directly; only a SECURITY DEFINER domain RPC owned by the migration role '
  '(which inherits EXECUTE via ownership) or service_role can invoke it.';

-- #######################################################################################
-- 2b. SECURITY DEFINER PRIVILEGE AUDIT
-- #######################################################################################
-- Every SECURITY DEFINER function defined above, audited explicitly rather than left on
-- whatever Postgres/Supabase defaults to. Postgres grants EXECUTE on a new function to PUBLIC
-- by default, and Supabase additionally exposes every public-schema function as a
-- supabase.rpc() endpoint reachable by anon/authenticated unless revoked — so "I didn't grant
-- it" is NOT the same as "no one can call it." Two categories:
--
--   (1) RBAC PREDICATE HELPERS — MUST stay callable by `authenticated`, but NOT by `anon` or
--       the bare `PUBLIC` pseudo-role (which Postgres grants EXECUTE to by default on every
--       new function, and which `anon`/`authenticated` both inherit as members of PUBLIC
--       unless explicitly revoked). They run INSIDE RLS policy expressions evaluated for the
--       querying session itself, so EXECUTE for `authenticated` is required — but an
--       unauthenticated caller has no legitimate reason to invoke them directly, and
--       media_owner_exists(text, uuid) specifically would otherwise be an unauthenticated
--       EXISTENCE ORACLE (an anonymous caller could probe arbitrary uuids against vehicles/
--       parts/customers/etc. and learn which ones are real, with no login at all). Each one
--       below is REVOKEd from PUBLIC and anon FIRST, then explicitly (re-)GRANTed to
--       authenticated — a decision, not an oversight.
--
--   (2) TRUSTED INTERNAL PLUMBING — must NOT be directly callable by anon/authenticated at
--       all. Revoked below. A future SECURITY DEFINER domain RPC, owned by the same role that
--       ran this migration, still works: SECURITY DEFINER makes such an RPC execute with its
--       OWNER's privileges, and an object's owner always implicitly has EXECUTE on objects
--       they own — the REVOKE below only removes the grant that would otherwise let an
--       ordinary client call it directly via supabase.rpc('write_audit_log', ...).

revoke execute on function public.has_role(text) from public, anon;
revoke execute on function public.has_any_role(text[]) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_owner() from public, anon;
revoke execute on function public.is_export_authorized() from public, anon;
revoke execute on function public.is_vehicle_domain_staff() from public, anon;
revoke execute on function public.is_dismantling_staff() from public, anon;
revoke execute on function public.is_parts_staff() from public, anon;
revoke execute on function public.is_sales_staff() from public, anon;
revoke execute on function public.is_scrap_office() from public, anon;
revoke execute on function public.is_container_staff() from public, anon;
revoke execute on function public.can_access_media(text, uuid) from public, anon;
revoke execute on function public.media_owner_exists(text, uuid) from public, anon;

grant execute on function public.has_role(text) to authenticated;
grant execute on function public.has_any_role(text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_export_authorized() to authenticated;
grant execute on function public.is_vehicle_domain_staff() to authenticated;
grant execute on function public.is_dismantling_staff() to authenticated;
grant execute on function public.is_parts_staff() to authenticated;
grant execute on function public.is_sales_staff() to authenticated;
grant execute on function public.is_scrap_office() to authenticated;
grant execute on function public.is_container_staff() to authenticated;
grant execute on function public.can_access_media(text, uuid) to authenticated;
grant execute on function public.media_owner_exists(text, uuid) to authenticated;

-- write_audit_log: trusted plumbing only — never a direct client RPC. Kept exactly as-is.
revoke execute on function public.write_audit_log(text, text, uuid, text, jsonb, text, uuid) from public;
revoke execute on function public.write_audit_log(text, text, uuid, text, jsonb, text, uuid) from anon;
revoke execute on function public.write_audit_log(text, text, uuid, text, jsonb, text, uuid) from authenticated;
grant execute on function public.write_audit_log(text, text, uuid, text, jsonb, text, uuid) to service_role;

-- Trigger functions: invoked by the trigger mechanism itself (Postgres already refuses to
-- run a RETURNS TRIGGER function outside trigger context), never as a direct RPC call.
-- Revoked from client-facing roles as explicit defense in depth, not because a real exploit
-- path exists today.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- (Mutation-authorization and immutability trigger functions added later in this file —
-- check_parts_mutation_authorization, check_vehicles_mutation_authorization,
-- check_scrap_load_status_authorization, check_container_job_status_authorization,
-- check_reservation_integrity, check_export_invoice_immutability,
-- check_export_invoice_line_items_immutability — get the same revoke-from-client-roles
-- treatment at their own point of definition, for the same reason. They are ALSO marked
-- SECURITY DEFINER, unlike set_updated_at() above: several of them read a DIFFERENT table
-- than the one they're attached to (check_reservation_integrity reads sale_items;
-- check_export_invoice_line_items_immutability reads export_invoices) and must see the real
-- row regardless of the calling role's own RLS visibility into that other table.)


-- #######################################################################################
-- 3. MEDIA  (one polymorphic table for every photo/document in the system)
-- #######################################################################################

create table public.media_assets (
  id            uuid primary key default gen_random_uuid(),
  owner_type    text not null
                check (owner_type in (
                  'vehicle', 'vehicle_completion', 'vehicle_intake_batch', 'dismantling_session', 'part',
                  'customer', 'scrap_load', 'scrap_payment', 'driver_check',
                  'rim_obligation', 'rim_return', 'container', 'export_invoice', 'export_payment'
                )),
  owner_id      uuid not null,
  role          text,              -- e.g. 'capture'|'source'|'final' (parts), 'number_photo'|'loading_photo'|'final_list' (containers)
  variant       text not null default 'original'
                check (variant in ('original','medium','thumbnail')),
  variant_of    uuid references public.media_assets(id) on delete cascade,
  bucket        text not null,
  storage_path  text not null,
  mime_type     text not null,
  size_bytes    bigint,
  width         int,
  height        int,
  checksum      text,
  status        text not null default 'ready'
                check (status in ('processing','ready','failed')),
  uploaded_by   uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
comment on table public.media_assets is
  'Central file metadata table for every image/document in the system — vehicle, part, '
  'dismantling, scrap (load/ticket/check), rim pickup/return, container (number/loading/final '
  'list), export payment proof, customer documents. Bytes live in Supabase Storage, never here '
  '(no bytea/blob columns). owner_type/owner_id is a deliberate polymorphic reference instead '
  'of one join table per domain (part_photos, container_files, customer_documents, etc. would '
  'all be 100% redundant with this). variant_of self-references the original for thumbnail/ '
  'medium rows generated by the background image-variant job (blueprint §11, §18).';
create index media_assets_owner_idx on public.media_assets (owner_type, owner_id);
create unique index media_assets_bucket_path_key on public.media_assets (bucket, storage_path);
create index media_assets_variant_of_idx on public.media_assets (variant_of) where variant_of is not null;


-- #######################################################################################
-- 4. AUDIT  (one append-only table for the whole system)
-- #######################################################################################

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id),
  actor_name  text not null,
  actor_role  text not null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid not null,
  summary     text not null,
  changes     jsonb not null default '{}'::jsonb,
  reason      text,
  request_id  uuid,
  created_at  timestamptz not null default now()
);
comment on table public.audit_logs is
  'Single append-only audit sink for every domain (entity_type/entity_id is a generic pair, '
  'mirrors the legacy D1 audit_logs table which got this right). Never updated or deleted. '
  'actor_name/actor_role are denormalized snapshots so a later profile change never rewrites '
  'history. reason is populated for override-type actions (daily close override, container '
  'close-with-balance override, payment discrepancy override, invoice revision). request_id '
  'lets several audit rows from one user action be correlated (blueprint §19/§20).';
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
-- `id` tiebreaker for stable keyset pagination through the global audit feed — see
-- vehicles_created_at_idx comment for the general pattern.
create index audit_logs_created_idx on public.audit_logs (created_at desc, id desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
-- Not partitioned yet — current/near-term volume doesn't justify the operational complexity.
-- Revisit (monthly range partitioning on created_at) once the table is genuinely large; see
-- blueprint §19.


-- #######################################################################################
-- 5. VEHICLES  (the one master vehicle, shared by Auction / Receiving / Dispatch / Dismantling)
-- #######################################################################################

create table public.carriers (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  driver      text not null default '',
  phone       text not null default '',
  email       text not null default '',
  address     text not null default '',
  mc_dot      text not null default '',
  notes       text not null default '',
  active      boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.vehicles (
  id                    uuid primary key default gen_random_uuid(),

  -- Business identifiers (never the PK — see blueprint "ID Strategy")
  vin                   text,
  lot_number            text,
  stock_number          text,
  auction_item_number   text,

  year                  int not null,
  make                  text not null,
  model                 text not null,
  trim                  text not null default '',
  engine                text not null default '',
  mileage               int,
  mileage_status        text not null default 'Actual',
  title_status          text not null default 'Pending',
  auction_source        text not null default '',

  purchase_price        numeric(12,2) not null default 0,
  auction_fees          numeric(12,2) not null default 0,
  transportation_cost   numeric(12,2) not null default 0,
  total_landed_cost     numeric(12,2) generated always as
                        (purchase_price + auction_fees + transportation_cost) stored,
  invoice_amount        numeric(12,2),
  balance_due           numeric(12,2),

  pickup_status         text not null default '',
  purchase_date         date not null default current_date,
  pickup_pin            text not null default '',
  pickup_deadline       timestamptz,
  location              text not null default '',
  pickup_location_name  text not null default '',
  pickup_address        text not null default '',

  -- Main lifecycle status. One free-text/lookup column, NOT a Postgres enum (business
  -- statuses change too often for an enum type migration each time) — matches both legacy
  -- and the current frontend's open string set: Purchased, Awaiting Dispatch, Assigned,
  -- Awaiting Pickup, Picked Up, Awaiting Transport, In Transit, Arrived, Available at Yard,
  -- Processing, Ready for Processing, Dismantled, Completed, Scrapped / Closed.
  status                text not null default 'Purchased',
  notes                 text not null default '',
  damage_info           text not null default '',
  transport_info        text not null default '',
  unverified_fields     text[] not null default '{}',   -- drives the "Missing evidence" Owner Dashboard KPI
  arrival_date          timestamptz,
  completed_at          timestamptz,
  assigned_id           uuid references public.profiles(id),
  closed_reason         text check (closed_reason in ('Scrapped','Sold Complete','Exported','Other')),
  closed_note           text,

  -- Transport / Central Dispatch — kept as columns on the SAME row (not a separate
  -- dispatch_jobs/dispatch_items grouping). The current approved frontend's Central Dispatch
  -- UI already flattens dispatch this way (batch-assigns a carrier to N vehicles, but persists
  -- no shared "job" entity) — legacy's richer dispatch_jobs/dispatch_items model exists but is
  -- NOT what the approved UI does today, so it is intentionally deferred rather than revived;
  -- see blueprint §12/§28.
  transport_status      text not null default 'NEED_TRANSPORT'
                        check (transport_status in
                          ('NEED_TRANSPORT','READY_TO_POST','POSTED_TO_CD','ASSIGNED','IN_TRANSIT','ARRIVED','PROBLEM')),
  transport_price       numeric(10,2),
  carrier_id            uuid references public.carriers(id),
  transport_problem     text,

  -- Vehicle Receiving & Arrival
  receiving_status      text not null default 'not_received'
                        check (receiving_status in ('not_received','received')),
  received_by           uuid references public.profiles(id),
  received_at           timestamptz,

  -- Denormalized pointer straight at the THUMBNAIL-variant media_assets row (not the
  -- original) for the vehicle's primary photo. Performance-motivated: a paginated vehicle
  -- LIST query renders every row's thumbnail with exactly ONE JOIN —
  --   select v.id, v.vin, ..., m.storage_path, m.bucket
  --   from vehicles v left join media_assets m on m.id = v.thumbnail_asset_id
  --   where ... order by v.created_at, v.id ...
  -- — never a correlated "latest/primary photo for this vehicle" lookup run once per row
  -- (an N+1 risk at scale — see blueprint "Performance Architecture" §18.4/§18.5). Maintained
  -- by the deferred media-upload/variant-generation path, not a trigger (it's set once the
  -- background thumbnail job finishes, not synchronously with the upload).
  thumbnail_asset_id    uuid references public.media_assets(id),

  created_by            uuid references public.profiles(id),
  updated_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.vehicles is
  'THE single master vehicle record. Auction Vehicle Inventory, Vehicle Receiving & Arrival, '
  'Central Dispatch and Dismantling all read/write this ONE table — never a second '
  'auction_vehicles/receiving_vehicles/dispatch_vehicles/dismantling_vehicles dataset.';

-- A vehicle may legitimately lack a readable VIN/lot/stock at capture time, but once present
-- it must be unique. Plain UNIQUE on a nullable column in Postgres already allows multiple
-- NULLs, so these are effectively "unique where provided" without needing `where not null`.
create unique index vehicles_vin_key on public.vehicles (vin) where vin is not null;
create unique index vehicles_lot_number_key on public.vehicles (lot_number) where lot_number is not null;
create unique index vehicles_stock_number_key on public.vehicles (stock_number) where stock_number is not null;
alter table public.vehicles add constraint vehicles_vin_format_chk
  check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$');  -- excludes I/O/Q, matches legacy's validation

create index vehicles_status_idx on public.vehicles (status);
create index vehicles_make_model_idx on public.vehicles (make, model);
create index vehicles_year_idx on public.vehicles (year);
-- (created_at, id): the `id` tiebreaker makes this a stable keyset-pagination cursor even if
-- two rows share a timestamp (bulk import) — see blueprint "Performance Architecture" §cursor
-- pagination. Applied here and on vehicles_active_idx/parts/sales/audit_logs below, the five
-- tables most likely to be paginated through at real scale; not applied to every index.
create index vehicles_created_at_idx on public.vehicles (created_at, id);
create index vehicles_transport_status_idx on public.vehicles (transport_status);
-- Vehicle Receiving & Arrival's own worklist query: vehicles still waiting to be received,
-- ordered by created_at with the `id` keyset tiebreaker. Partial on the smaller, actionable
-- subset rather than indexing the whole (eventually mostly 'received') column.
create index vehicles_not_received_idx on public.vehicles (created_at, id)
  where receiving_status = 'not_received';
-- "Active pipeline" is the single most common list-screen query — partial index keeps it cheap
-- even once Completed/Scrapped rows vastly outnumber active ones. Deliberately leads with
-- (created_at, id), NOT (status, created_at, id): the active-pipeline list shows every active
-- status together, ordered by created_at — leading with `status` would force Postgres to
-- merge/sort across status groups to get a single created_at-ordered result, defeating the
-- index. vehicles_status_idx (above) stays the right index for "filter to one specific
-- status" queries; this one is purely for "all active vehicles, newest first, paginated."
create index vehicles_active_idx on public.vehicles (created_at, id)
  where status not in ('Completed', 'Scrapped / Closed');

create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

-- Authorization boundary RLS cannot express: reviewers (owner/engineer_admin/manager) may
-- change anything on a vehicle. Auction/Receiving/Dismantling are each a real, legitimate
-- vehicle-domain role with their own day-to-day data entry (auction intake fields, receiving
-- status, dismantling status/completion) — that routine workflow data stays open to them, per
-- "must only perform their own workflow mutations." What is blocked for them specifically is
-- CLOSING the vehicle record and reassigning its financial/ownership authority — a reviewer-
-- level decision, not a field role's own workflow: closed_reason, closed_note, assigned_id,
-- and transitioning status directly into a closed state.
-- CORRECTNESS FIX: this function must be SECURITY INVOKER (the default — no `security
-- definer` clause), not SECURITY DEFINER. It exists specifically to distinguish "a direct
-- authenticated client's own statement" from "a write happening inside a trusted SECURITY
-- DEFINER RPC" via `current_user`. If THIS function itself were SECURITY DEFINER,
-- current_user inside its own body would unconditionally become ITS owner (e.g. postgres)
-- regardless of who/what actually fired the triggering INSERT/UPDATE — making the bypass
-- fire every time and defeating the check entirely, even for an ordinary direct client. It
-- does not need SECURITY DEFINER for any other reason: it only calls has_any_role()/
-- has_role() (already SECURITY DEFINER themselves, so they bypass RLS internally on their
-- own) and reads NEW/OLD, never a raw cross-table SELECT.
create or replace function public.check_vehicles_mutation_authorization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- CORRECTNESS NOTE (do not reintroduce "auth.uid() is null" as a trust signal — an earlier
  -- version of this trigger did, and it was wrong): auth.uid() reads request.jwt.claims, a
  -- session-level GUC that PostgREST sets once per HTTP request and that SECURITY DEFINER
  -- does NOT change. A future SECURITY DEFINER domain RPC called BY an authenticated end
  -- user (e.g. finish_container_loading() called by a Container Loading Employee) still
  -- sees auth.uid() = that same employee throughout — it is never null just because the
  -- call happens to be routed through a SECURITY DEFINER function. Using "is null" as the
  -- trust signal would therefore have INCORRECTLY blocked that RPC's own legitimate internal
  -- write, since this trigger would have seen a non-null, non-privileged caller and rejected
  -- it, the exact bug this comment exists to prevent from being reintroduced.
  --
  -- What DOES reliably change under SECURITY DEFINER (and under a plain `SET ROLE`, which is
  -- how Supabase/PostgREST establishes `authenticated`/`anon` per request in the first
  -- place) is current_user: a direct client request runs as current_user = 'authenticated'
  -- (or 'anon', which fails every role-helper check anyway and is listed only for
  -- completeness). A SECURITY DEFINER function executes with current_user = the FUNCTION
  -- OWNER (typically `postgres`) for the duration of its body, including every write it
  -- performs internally — which is exactly the right, reliable signal for "this write is
  -- happening inside a trusted, already-authorized RPC transaction," independent of who the
  -- original caller was. service_role sessions and raw postgres connections (migrations,
  -- seed scripts) are current_user = 'service_role'/'postgres' respectively, also trusted.
  -- Applied identically in every trigger below.
  if current_user not in ('authenticated', 'anon') or public.has_any_role('owner', 'engineer_admin', 'manager') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.closed_reason is distinct from old.closed_reason
       or new.closed_note is distinct from old.closed_note
       or new.assigned_id is distinct from old.assigned_id
    then
      raise exception 'vehicles: closing a vehicle record or reassigning it requires a reviewer role (owner/engineer_admin/manager)';
    end if;
    if new.status is distinct from old.status and new.status in ('Completed', 'Scrapped / Closed') then
      raise exception 'vehicles: closing a vehicle (status -> %) requires a reviewer role (owner/engineer_admin/manager)', new.status;
    end if;
    -- Purchase/accounting fields: Receiving and Dismantling have no legitimate reason to
    -- touch these — only the Auction role's own intake workflow does (and reviewers,
    -- already returned true above).
    if not public.has_role('auction') then
      if new.purchase_price is distinct from old.purchase_price
         or new.auction_fees is distinct from old.auction_fees
         or new.transportation_cost is distinct from old.transportation_cost
         or new.invoice_amount is distinct from old.invoice_amount
         or new.balance_due is distinct from old.balance_due
      then
        raise exception 'vehicles: purchase/accounting fields require a reviewer role or the Auction role';
      end if;
      -- Dispatch/transport fields: Central Dispatch is the Auction role's own screen per
      -- nav.ts — Receiving and Dismantling have no business reassigning a carrier or
      -- transport pricing.
      if new.transport_status is distinct from old.transport_status
         or new.transport_price is distinct from old.transport_price
         or new.carrier_id is distinct from old.carrier_id
         or new.transport_problem is distinct from old.transport_problem
      then
        raise exception 'vehicles: dispatch/transport fields require a reviewer role or the Auction role';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_vehicles_mutation_authorization() from public, anon, authenticated;
create trigger vehicles_check_mutation_authorization
  before insert or update on public.vehicles
  for each row execute function public.check_vehicles_mutation_authorization();


-- Event-sourcing backbone: append-only, one row per meaningful thing that happened to a
-- vehicle (START, STATUS, ASSIGN, PART_REMOVED, PHOTO, DISPOSITION, ISSUE_FLAGGED, the
-- REVIEW_* family for dismantling manager review, etc.). `action` stays free text (not an
-- enum) — both legacy and the current frontend rely on an open-ended action vocabulary.
create table public.vehicle_events (
  id          uuid primary key default gen_random_uuid(),
  -- Deliberately NOT on delete cascade: vehicles are never hard-deleted in practice (see
  -- vehicles table comment), and this is the vehicle's audit/evidence trail — an accidental
  -- hard delete should fail loudly (default NO ACTION) rather than silently wipe history.
  vehicle_id  uuid not null references public.vehicles(id),
  action      text not null,

  -- part_ref is a CORRELATION id, not a hard FK: a PART_REMOVED event is written before any
  -- `parts` row necessarily exists (the part only materializes once it qualifies for Parts
  -- Inventory — see parts.source_vehicle_event_id below for the real, enforced FK direction).
  part_ref      uuid,
  part_type     text,
  high_value    boolean not null default false,
  disposition   text,
  location      text,
  note          text,
  status        text,

  actor_id    uuid references public.profiles(id),
  actor_name  text not null,
  created_at  timestamptz not null default now()
);
comment on table public.vehicle_events is
  'Append-only event trail for the whole vehicle lifecycle, including dismantling part '
  'removals. Never updated or deleted. Feeds: the Owner Dashboard "high-value parts/unmatched '
  'converters" KPIs, the Vehicle Dismantling Processing review queue, and Parts Inventory''s '
  'auto-derivation of approved parts (a PART_REMOVED event with disposition = ''IN INVENTORY'', '
  'or later resolved via a REVIEW_APPROVED/REVIEW_EDITED_APPROVED event, qualifies a part).';
create index vehicle_events_vehicle_idx on public.vehicle_events (vehicle_id, created_at);
create index vehicle_events_actor_idx on public.vehicle_events (actor_id, created_at);
create index vehicle_events_action_idx on public.vehicle_events (action);
-- Feeds the "unreconciled high-value parts" / "unmatched converters" dashboard query directly.
create index vehicle_events_unresolved_high_value_idx on public.vehicle_events (vehicle_id, created_at)
  where action = 'PART_REMOVED' and high_value and disposition is null;


-- Dismantling session: a first-class entity (not purely derived from events) so that
-- "is this vehicle already being dismantled by someone" is a single indexed existence check
-- instead of an event-log scan, and so Quick Part Capture has an explicit, stable id to link
-- every capture to (per the client's "captures must remain linked to... dismantling session"
-- requirement). One active session per vehicle, enforced below.
create table public.dismantling_sessions (
  id                      uuid primary key default gen_random_uuid(),
  -- No cascade — same reasoning as vehicle_events above: this is operational evidence, not
  -- disposable child data.
  vehicle_id              uuid not null references public.vehicles(id),
  employee_id             uuid not null references public.profiles(id),
  started_at              timestamptz not null default now(),
  ended_at                timestamptz,
  status                  text not null default 'active'
                          check (status in ('active','completed','abandoned')),
  vehicle_photo_asset_id  uuid references public.media_assets(id),
  part_photos_captured    int not null default 0,
  created_at              timestamptz not null default now()
);
comment on table public.dismantling_sessions is
  'One row per "Find Vehicle → Confirm → dismantle" session, covering BOTH the full Vehicle '
  'Dismantling flow and Quick Part Capture (they share the same session once a vehicle is '
  'active — switching between the two modes never starts a second session). The partial '
  'unique index below is the DB-level enforcement of the approved "Vehicle Already In Process" '
  'guard: a vehicle can have at most one active (ended_at is null) session at a time.';
create unique index dismantling_sessions_one_active_per_vehicle
  on public.dismantling_sessions (vehicle_id) where ended_at is null;
create index dismantling_sessions_employee_idx on public.dismantling_sessions (employee_id, started_at desc);

-- Link vehicle_events to the session they happened in (added post-creation to avoid a
-- forward reference in the vehicle_events DDL above).
alter table public.vehicle_events
  add column dismantling_session_id uuid references public.dismantling_sessions(id);
create index vehicle_events_session_idx on public.vehicle_events (dismantling_session_id)
  where dismantling_session_id is not null;


-- Auction Vehicle Inventory bulk/scan/manual intake staging area.
create table public.vehicle_intake_batches (
  id              uuid primary key default gen_random_uuid(),
  method          text not null check (method in ('bulk','single','scan','manual')),
  source_text     text not null default '',
  source_asset_id uuid references public.media_assets(id),
  status          text not null default 'review' check (status in ('review','confirmed')),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz
);
create index vehicle_intake_batches_creator_idx on public.vehicle_intake_batches (created_by, created_at);

create table public.vehicle_intake_items (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.vehicle_intake_batches(id) on delete cascade,
  source_excerpt      text not null default '',
  extracted           jsonb not null,
  review              jsonb not null default '{}'::jsonb,
  match_status        text not null check (match_status in ('new','existing','conflict')),
  matched_vehicle_id    uuid references public.vehicles(id) on delete set null,
  confirmed_vehicle_id  uuid references public.vehicles(id) on delete set null,
  confirmed_by        uuid references public.profiles(id),
  confirmed_at        timestamptz,
  created_at          timestamptz not null default now()
);
comment on table public.vehicle_intake_items is
  'match_status is the duplicate-detection triage (new/existing/conflict) — a VIN exact match, '
  'OR (lot_number + auction_source) combo, OR stock_number match is "existing"; a lot-number '
  'collision across different auction sources is "conflict" and must be flagged for a human, '
  'never silently merged or duplicated (legacy rule worth keeping — deferred RPC '
  '`match_or_create_vehicle()`, see blueprint §13/§20).';
create index vehicle_intake_items_batch_idx on public.vehicle_intake_items (batch_id, match_status);


-- Vehicle-operations completion review (Auction/Receiving side — NOT the dismantling
-- "Vehicle Completed" screen, which is a separate concept; see blueprint for the distinction).
-- Collapses what the frontend currently keeps as two separate arrays with overlapping data
-- (`completionQueue` and the legacy-named `yardCorrections`) into one table: a correction is
-- simply a completion whose decision is 'needs_correction'.
create table public.vehicle_completions (
  id                  uuid primary key default gen_random_uuid(),
  -- No cascade — same reasoning as vehicle_events/dismantling_sessions above.
  vehicle_id          uuid not null references public.vehicles(id),
  submitted_by        uuid references public.profiles(id),
  submitted_at        timestamptz not null default now(),
  part_count          int not null default 0,
  converter_count     int not null default 0,
  custody_exceptions  int not null default 0,
  note                text not null default '',
  decision            text not null default 'pending'
                      check (decision in ('pending','approved','needs_correction')),
  decision_reason     text,
  decided_by          uuid references public.profiles(id),
  decided_at          timestamptz
);
create index vehicle_completions_vehicle_idx on public.vehicle_completions (vehicle_id, submitted_at desc);
create index vehicle_completions_open_idx on public.vehicle_completions (decision)
  where decision in ('pending', 'needs_correction');


-- #######################################################################################
-- 6. PARTS  (Dismantling → Parts Inventory, one connected pipeline)
-- #######################################################################################

create table public.parts (
  id                      uuid primary key default gen_random_uuid(),

  vehicle_id              uuid references public.vehicles(id) on delete set null,
  -- The idempotency guard for "approve a dismantled part exactly once": a unique constraint
  -- on this column means re-approving (or retrying) the same dismantling event can never
  -- create a second part row.
  source_vehicle_event_id uuid references public.vehicle_events(id),
  dismantling_session_id  uuid references public.dismantling_sessions(id),

  -- Two INDEPENDENT status dimensions on one row — do not collapse into one enum:
  -- `status` is the legacy capture → AI-draft → manager-review pipeline (still used by the
  -- Warehouse Employee quick-capture flow); `stage` is the Parts Inventory processing
  -- pipeline (Needs Processing → In Processing → Ready for Sale, or Not Sellable), which a
  -- part enters once `status = 'approved'` regardless of which pipeline got it there.
  -- 'rejected'/'duplicate' are manager-review OUTCOMES (alongside 'approved' and staying in
  -- 'manager_review' itself for a keep-for-later/pending decision — no separate "pending"
  -- value needed, manager_review already means exactly that). A rejected/duplicate part is
  -- NOT a second parts dataset — it is this SAME row, terminally dispositioned, kept for
  -- history. The CHECK constraint below guarantees it can never become sellable.
  status                  text not null default 'captured'
                          check (status in ('captured','draft_ready','manager_review','approved','rejected','duplicate')),
  -- Set only when status = 'duplicate' — which approved part this capture duplicates.
  duplicate_of_part_id    uuid references public.parts(id),
  stage                   text
                          check (stage in ('needs_processing','in_processing','ready_for_sale','not_sellable')),

  source_vin              text,
  source_lot              text,
  part_name               text not null default '',
  category                text not null default '',
  part_number             text not null default '',
  side_location           text not null default '',
  condition               text not null default 'Used',
  fitment                 text not null default '',
  fitment_status          text not null default 'verification_required'
                          check (fitment_status in ('verification_required','verified')),
  title                   text not null default '',
  description             text not null default '',
  keywords                text not null default '',

  price                   numeric(10,2) not null default 0 check (price >= 0),
  core_charge             numeric(10,2) check (core_charge >= 0),
  has_core_charge         boolean not null default false,
  sale_channels           text[] not null default '{}',

  location                text not null default '',
  zone                    text not null default '',
  rack                    text not null default '',
  shelf                   text not null default '',
  bin                     text not null default '',

  stock_sku               text,
  operational_status      text not null default 'AVAILABLE'
                          check (operational_status in ('AVAILABLE','RESERVED','SOLD','DAMAGED','RETURNED','MISSING')),
  -- quantity = 0 is a valid, expected state (sold out) — it must NEVER trigger a delete or a
  -- hide-from-search of this row. The part stays searchable/listed as "Out of Stock"; only
  -- the deferred list-view query layer decides how to render quantity = 0, never the schema.
  quantity                int not null default 1 check (quantity >= 0),

  test_status              text check (test_status in ('Not Tested','Tested','Failed')),
  test_notes                text,
  part_notes                text,

  not_sellable_reason      text,
  not_sellable_notes       text,
  not_sellable_by          uuid references public.profiles(id),
  not_sellable_at          timestamptz,

  ai_draft                 jsonb,
  ai_model                 text,
  ai_processed_at          timestamptz,

  captured_by              uuid references public.profiles(id),
  approved_by              uuid references public.profiles(id),
  approved_at              timestamptz,

  -- Same performance-motivated denormalization as vehicles.thumbnail_asset_id above — Parts
  -- Inventory is a grid/list of potentially tens of thousands of rows; the list query obtains
  -- every row's thumbnail storage_path/metadata with ONE JOIN against media_assets (via this
  -- column), never one media query per part row — see blueprint §18.4/§18.5.
  thumbnail_asset_id       uuid references public.media_assets(id),

  created_at               timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint parts_not_sellable_consistency_chk check (
    (stage = 'not_sellable' and not_sellable_reason is not null)
    or (stage is distinct from 'not_sellable' and not_sellable_reason is null)
  ),
  -- A rejected/duplicate record is historical, never sellable inventory — enforced here,
  -- not left to application discipline. It can never be staged ready_for_sale nor marked
  -- AVAILABLE for sale.
  constraint parts_rejected_duplicate_not_sellable_chk check (
    status not in ('rejected', 'duplicate')
    or (stage is distinct from 'ready_for_sale' and operational_status <> 'AVAILABLE')
  )
);
comment on table public.parts is
  'ONE part identity from first evidence photo through sold/not-sellable — never a second '
  'table for "dismantling parts" vs "inventory parts". A dismantling-sourced part is '
  'idempotently derived from exactly one vehicle_events row via source_vehicle_event_id.';
create unique index parts_stock_sku_key on public.parts (stock_sku) where stock_sku is not null;
create unique index parts_source_event_key on public.parts (source_vehicle_event_id) where source_vehicle_event_id is not null;
create index parts_status_idx on public.parts (status);
create index parts_stage_idx on public.parts (stage);
create index parts_vehicle_idx on public.parts (vehicle_id);
create index parts_part_number_idx on public.parts (part_number);
create index parts_operational_status_idx on public.parts (operational_status);
create index parts_location_idx on public.parts (zone, rack, shelf, bin);
create index parts_category_idx on public.parts (category) where category <> '';
-- Default Parts Inventory list sort — see vehicles_created_at_idx comment for why `id` rides
-- along as the keyset-pagination tiebreaker.
create index parts_created_at_idx on public.parts (created_at, id);
create index parts_name_trgm_idx on public.parts using gin (part_name gin_trgm_ops);
create index parts_duplicate_of_idx on public.parts (duplicate_of_part_id) where duplicate_of_part_id is not null;
create trigger parts_set_updated_at before update on public.parts
  for each row execute function public.set_updated_at();

-- Authorization boundary RLS cannot express (row-level, not column-level): reviewers
-- (owner/engineer_admin/manager) may change anything on a part; a non-reviewer parts-domain
-- staff member (Warehouse Employee, Dismantling Employee — both capture-only per nav.ts,
-- neither has a Pending Parts & Inventory / Parts Operations screen) may INSERT a new
-- capture and may edit their own NOT-YET-APPROVED capture's basic fields, but may never touch
-- pricing, location/bin, SKU, operational sellability, processing stage, or the
-- approval/rejection/duplicate decision fields themselves — those are reviewer-only, direct
-- or through a future RPC.
-- SECURITY INVOKER — see check_vehicles_mutation_authorization's comment above for why.
create or replace function public.check_parts_mutation_authorization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- See check_vehicles_mutation_authorization's comment above re: current_user vs. auth.uid().
  if current_user not in ('authenticated', 'anon') or public.has_any_role('owner', 'engineer_admin', 'manager') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A non-reviewer (Warehouse Employee / Dismantling) may only create a capture-safe
    -- initial row — never one that arrives already approved/rejected/duplicate, staged
    -- ready_for_sale, priced, SKU/location-assigned, or reviewer-approved. This is the gap
    -- the UPDATE-only version of this trigger left open: nothing previously stopped a
    -- capture role from INSERTing a fully-processed row in one shot instead of actually
    -- being reviewed.
    if new.status <> 'captured' then
      raise exception 'parts: a non-reviewer capture must be inserted at status = captured, not %', new.status;
    end if;
    if new.stage is not null
       or new.price <> 0 or new.core_charge is not null or new.has_core_charge
       or new.stock_sku is not null
       or new.location <> '' or new.zone <> '' or new.rack <> '' or new.shelf <> '' or new.bin <> ''
       or new.approved_by is not null or new.approved_at is not null
    then
      raise exception 'parts: a non-reviewer capture may not arrive pre-staged/priced/SKU-or-location-assigned/approved — those require a reviewer role (owner/engineer_admin/manager)';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('approved', 'rejected', 'duplicate') then
      raise exception 'parts: only a reviewer (owner/engineer_admin/manager) may modify a part once approved/rejected/marked duplicate';
    end if;
    if new.status is distinct from old.status and new.status in ('approved', 'rejected', 'duplicate') then
      raise exception 'parts: only a reviewer (owner/engineer_admin/manager) may approve/reject/mark a part duplicate';
    end if;
    if new.price is distinct from old.price
       or new.core_charge is distinct from old.core_charge
       or new.has_core_charge is distinct from old.has_core_charge
       or new.sale_channels is distinct from old.sale_channels
       or new.stock_sku is distinct from old.stock_sku
       or new.location is distinct from old.location
       or new.zone is distinct from old.zone
       or new.rack is distinct from old.rack
       or new.shelf is distinct from old.shelf
       or new.bin is distinct from old.bin
       or new.operational_status is distinct from old.operational_status
       or new.stage is distinct from old.stage
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
    then
      raise exception 'parts: pricing/location/SKU/sellability/stage/approval fields require a reviewer role (owner/engineer_admin/manager)';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_parts_mutation_authorization() from public, anon, authenticated;
create trigger parts_check_mutation_authorization
  before insert or update on public.parts
  for each row execute function public.check_parts_mutation_authorization();

-- Append-only location/status/quantity change log — the Parts Operations audit trail.
-- No cascade: this is evidence about the part, not disposable child data (same reasoning
-- as vehicle_events/dismantling_sessions).
create table public.part_operations (
  id                 uuid primary key default gen_random_uuid(),
  part_id            uuid not null references public.parts(id),
  action_type        text not null,
  previous_location  text,
  new_location       text,
  previous_status    text,
  new_status         text,
  quantity_delta     int not null default 0,
  previous_quantity  int,
  new_quantity       int,
  note               text not null default '',
  actor_id           uuid references public.profiles(id),
  actor_name         text not null,
  actor_role         text not null,
  created_at         timestamptz not null default now()
);
create index part_operations_part_idx on public.part_operations (part_id, created_at);


-- #######################################################################################
-- 7. CUSTOMERS & SALES
-- #######################################################################################

create table public.customers (
  id                          uuid primary key default gen_random_uuid(),
  customer_number             text,
  first_name                  text not null default '',
  last_name                   text not null default '',
  company_name                text not null default '',
  phone                       text not null default '',
  phone_normalized            text not null default '',
  secondary_phone             text not null default '',
  secondary_phone_normalized  text not null default '',
  email                       citext,
  billing_address             text not null default '',
  shipping_address            text not null default '',
  notes                       text not null default '',
  customer_type               text not null default 'retail'
                              check (customer_type in ('retail','wholesale','business')),
  tax_status                  text not null default 'taxable'
                              check (tax_status in ('taxable','exempt')),
  tax_id                      text not null default '',
  resale_certificate_number   text not null default '',
  exemption_expires_at        date,
  created_by                  uuid references public.profiles(id),
  updated_by                  uuid references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
comment on table public.customers is
  'ONE customer master for ordinary Customers & Sales AND Tire Shop rim-obligation lookups — '
  'rim_obligations.customer_id references this table directly; there is no second tire-shop '
  'customer dataset. customer_type distinguishes retail/wholesale/business, no subtype table.';
create unique index customers_number_key on public.customers (customer_number) where customer_number is not null;
create index customers_phone_idx on public.customers (phone_normalized);
create index customers_email_idx on public.customers (email);
create index customers_name_idx on public.customers (last_name, first_name);
create index customers_company_trgm_idx on public.customers using gin (company_name gin_trgm_ops);
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

create table public.quotes (
  id                 uuid primary key default gen_random_uuid(),
  quote_number       text,
  customer_id        uuid not null references public.customers(id),
  salesperson_id     uuid references public.profiles(id),
  status             text not null default 'DRAFT'
                     check (status in ('DRAFT','SENT','APPROVED','DECLINED','EXPIRED','CONVERTED')),
  subtotal           numeric(12,2) not null default 0,
  discount           numeric(12,2) not null default 0,
  tax_rate           numeric(6,4) not null default 0,
  tax                numeric(12,2) not null default 0,
  total              numeric(12,2) not null default 0,
  notes              text not null default '',
  expires_at         timestamptz,
  converted_sale_id  uuid,   -- FK added after `sales` exists, below
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.quotes is
  'Universal sale entry point — even a "direct sale" is modeled as a quote that gets '
  'auto-approved and converted (legacy pattern worth keeping: every sale gets a draft/approval '
  'trail for free). A sale is never created directly without a quote.';
create unique index quotes_number_key on public.quotes (quote_number) where quote_number is not null;
create index quotes_customer_idx on public.quotes (customer_id, created_at);
create trigger quotes_set_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();

create table public.quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  part_id     uuid references public.parts(id),
  stock_sku   text not null default '',
  description text not null,
  quantity    int not null default 1 check (quantity > 0),
  unit_price  numeric(10,2) not null default 0 check (unit_price >= 0),
  discount    numeric(10,2) not null default 0,
  line_total  numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index quote_items_quote_idx on public.quote_items (quote_id);

create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  sale_number     text,
  quote_id        uuid references public.quotes(id),
  customer_id     uuid not null references public.customers(id),
  salesperson_id  uuid references public.profiles(id),
  subtotal        numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  tax_rate        numeric(6,4) not null default 0,
  tax             numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  -- amount_paid/balance_due/payment_status reflect POSTED payment allocations ONLY (see
  -- payments/payment_allocations below). A pending payment must never move these — they are
  -- written exclusively by the deferred post_payment()/void_payment() RPCs, never computed
  -- live and never touched by a direct client update (see sales RLS below).
  amount_paid     numeric(12,2) not null default 0,
  balance_due     numeric(12,2) not null default 0,
  payment_status  text not null default 'UNPAID'
                  check (payment_status in ('UNPAID','PARTIAL','PAID')),
  status          text not null default 'OPEN'
                  check (status in ('OPEN','COMPLETED','CANCELLED')),
  -- Stock-handling summary across this sale's lines — see sale_items.stock_action and
  -- inventory_reservations below for the per-line detail this is rolled up from. Maintained
  -- by the deferred reserve_stock()/fulfill_sales_order() RPCs, not a live-computed column
  -- (an aggregate over sale_items on every read would be more "live" but more expensive on
  -- every sale-list query; this is small, bounded, staff-written state, same tradeoff as
  -- payment_status above).
  fulfillment_status text not null default 'unfulfilled'
                  check (fulfillment_status in ('unfulfilled','partial','fulfilled')),
  notes           text not null default '',
  -- Nullable, no default — an OPEN sale has NOT been finalized. Set only when the sale
  -- actually reaches COMPLETED (by the deferred RPC that performs that transition), never
  -- automatically at row-creation time. The CHECK below makes "finalized_at is set" and
  -- "status = COMPLETED" the same fact, enforced by the database, not by convention.
  finalized_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sales_finalized_at_chk check ((status = 'COMPLETED') = (finalized_at is not null))
);
create unique index sales_number_key on public.sales (sale_number) where sale_number is not null;
create unique index sales_quote_key on public.sales (quote_id) where quote_id is not null;
create index sales_customer_idx on public.sales (customer_id, created_at);
create index sales_status_idx on public.sales (status, payment_status);
create index sales_fulfillment_status_idx on public.sales (fulfillment_status)
  where fulfillment_status <> 'fulfilled';
-- Global Sales Desk/orders list (not scoped to one customer) — same keyset-pagination
-- tiebreaker pattern as vehicles_created_at_idx/parts_created_at_idx.
create index sales_created_at_idx on public.sales (created_at, id);
create trigger sales_set_updated_at before update on public.sales
  for each row execute function public.set_updated_at();

alter table public.quotes
  add constraint quotes_converted_sale_fk foreign key (converted_sale_id) references public.sales(id);
create unique index quotes_converted_sale_key on public.quotes (converted_sale_id) where converted_sale_id is not null;

-- Line-item table that doubles as a lightweight inventory-change audit trail for sales
-- specifically (legacy pattern worth keeping — see blueprint §14 "finalize_sale" transaction).
create table public.sale_items (
  id                 uuid primary key default gen_random_uuid(),
  sale_id            uuid not null references public.sales(id) on delete cascade,
  part_id            uuid references public.parts(id),
  stock_sku          text not null default '',
  description        text not null,
  quantity           int not null default 1 check (quantity > 0),
  unit_price         numeric(10,2) not null default 0 check (unit_price >= 0),
  discount           numeric(10,2) not null default 0,
  line_total         numeric(12,2) not null default 0,
  previous_status    text,
  new_status         text,
  previous_quantity  int,
  new_quantity       int,
  -- Draft/Reserve/Fulfill stock handling (client requirement) — 'none' is a manual/service
  -- line with no inventory effect (e.g. shop labor); 'reserve' holds stock without consuming
  -- it (see inventory_reservations below); 'fulfill' consumes it immediately. A line moves
  -- reserve -> fulfill later via the deferred fulfill_sales_order() RPC, never a bare update
  -- of this column alone (that RPC also updates the part's quantity/operational_status and
  -- the matching inventory_reservations row atomically).
  stock_action       text not null default 'none' check (stock_action in ('none','reserve','fulfill')),
  created_at         timestamptz not null default now()
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_part_idx on public.sale_items (part_id) where part_id is not null;

-- Explicit reservation record — NOT just a status flag on parts.operational_status, because
-- (a) a reservation must be traceable to the specific sale_item that holds it (for release on
-- cancellation, and so "how much of this part is reserved right now" is a real query, not an
-- inference from a single enum value), and (b) parts.quantity can be > 1, so a reservation is
-- a quantity, not a boolean. "Available to sell" = parts.quantity - sum(active reservations)
-- for that part — a query the deferred reserve_stock()/fulfill_sales_order() RPCs must run
-- under row-level locking (`select ... for update` on the part) to prevent two concurrent
-- sales from overselling the same last unit; this migration only provides the table shape for
-- that, per the task's "document, do not implement" instruction.
create table public.inventory_reservations (
  id             uuid primary key default gen_random_uuid(),
  part_id        uuid not null references public.parts(id),
  sale_id        uuid not null references public.sales(id),
  sale_item_id   uuid not null references public.sale_items(id),
  quantity       int not null check (quantity > 0),
  status         text not null default 'active'
                 check (status in ('active','fulfilled','released','expired')),
  reserved_at    timestamptz not null default now(),
  expires_at     timestamptz,
  released_at    timestamptz,
  fulfilled_at   timestamptz,
  created_by     uuid references public.profiles(id)
);
comment on table public.inventory_reservations is
  'Backs the Draft/Reserve/Fulfill stock-handling workflow. One sale_item has at most one '
  'ACTIVE reservation at a time (partial unique index below); it may have further historical '
  'rows if released and re-reserved. Never deleted — a release/fulfillment is a status change, '
  'preserving the history of what was held and for how long.';
create unique index inventory_reservations_active_per_item
  on public.inventory_reservations (sale_item_id) where status = 'active';
create index inventory_reservations_part_active_idx
  on public.inventory_reservations (part_id) where status = 'active';
create index inventory_reservations_sale_idx on public.inventory_reservations (sale_id);

-- FKs alone cannot express "part_id/sale_id agree with what sale_item_id actually belongs
-- to" — three independent FKs happily accept any combination of valid-but-unrelated ids.
-- This closes that gap: a reservation can never reference a part/sale/sale_item combination
-- that doesn't genuinely agree with each other, enforced for every writer (including the
-- deferred RPCs, since triggers fire regardless of RLS/SECURITY DEFINER).
create or replace function public.check_reservation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part_id uuid;
  v_sale_id uuid;
begin
  select part_id, sale_id into v_part_id, v_sale_id
  from public.sale_items where id = new.sale_item_id;
  if v_part_id is null then
    raise exception 'inventory_reservations: sale_item_id % does not exist', new.sale_item_id;
  end if;
  if v_part_id is distinct from new.part_id then
    raise exception 'inventory_reservations: part_id does not match sale_items.part_id for sale_item_id %', new.sale_item_id;
  end if;
  if v_sale_id is distinct from new.sale_id then
    raise exception 'inventory_reservations: sale_id does not match sale_items.sale_id for sale_item_id %', new.sale_item_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_reservation_integrity() from public, anon, authenticated;
create trigger inventory_reservations_check_integrity
  before insert or update on public.inventory_reservations
  for each row execute function public.check_reservation_integrity();

-- Payments are intentionally NOT coupled 1:1 to a single sale — see payment_allocations
-- below. A payment is money received from a customer; how it applies to one or more sales
-- is a separate, explicit allocation. Lifecycle: pending -> posted, or pending -> void.
-- CRITICAL RULE: a pending payment must never affect sales.amount_paid/balance_due/
-- payment_status — only posting does (via the deferred post_payment() RPC, atomically, also
-- writing the payment_allocations rows' effect into each allocated sale). This table has NO
-- update/delete RLS policy at all (see §11) specifically so that rule cannot be bypassed by a
-- direct client update — posting and voiding are SECURITY DEFINER RPC responsibilities only.
create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  payment_number    text,
  customer_id       uuid not null references public.customers(id),
  amount            numeric(10,2) not null check (amount > 0),
  method            text not null check (method in ('CASH','CARD','CHECK','BANK_TRANSFER','QR_CODE','PAYMENT_LINK','OTHER')),
  reference         text not null default '',
  notes             text not null default '',
  status            text not null default 'pending' check (status in ('pending','posted','void')),
  received_by       uuid references public.profiles(id),
  posted_at         timestamptz,
  posted_by         uuid references public.profiles(id),
  voided_at         timestamptz,
  voided_by         uuid references public.profiles(id),
  void_reason       text,
  -- Idempotency: the POS client may retry "create payment" under bad connectivity.
  client_request_id uuid,
  created_at        timestamptz not null default now(),
  constraint payments_void_reason_chk check (status <> 'void' or void_reason is not null)
);
create unique index payments_number_key on public.payments (payment_number) where payment_number is not null;
create unique index payments_client_request_key on public.payments (client_request_id) where client_request_id is not null;
create index payments_customer_idx on public.payments (customer_id, created_at);
create index payments_status_idx on public.payments (status);

-- A direct INSERT must never be able to fabricate an already-posted or already-voided
-- payment — only post_payment()/void_payment() (deferred) may reach those states, via
-- UPDATE. This trigger fires BEFORE INSERT ONLY (not update), so it has no effect on the
-- RPCs' later legitimate transition — it purely guarantees every newly created row starts
-- clean: pending, with no posted/voided fields set, regardless of what a client's INSERT
-- statement tries to set them to.
-- SECURITY INVOKER — see check_vehicles_mutation_authorization's comment for why. This one
-- doesn't even call a role helper (pure column checks on NEW), so it never needed DEFINER.
create or replace function public.check_payment_insert_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- See check_vehicles_mutation_authorization's comment re: current_user vs. auth.uid(). A
  -- trusted non-client context (service_role, seed/migration scripts, current_user NOT IN
  -- authenticated/anon) may legitimately load a payment directly into an already-posted
  -- historical state (e.g. seed.sql's worked example); an ordinary authenticated client
  -- request may not. (A future create_payment() RPC doesn't actually need this bypass — it
  -- would insert as pending anyway, satisfying the check unconditionally — but the bypass is
  -- still correct to have here for the seed/service-role case, and for consistency with
  -- every other trigger in this file.)
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.status <> 'pending'
     or new.posted_at is not null or new.posted_by is not null
     or new.voided_at is not null or new.voided_by is not null or new.void_reason is not null
  then
    raise exception 'payments: a new payment must be created pending with no posted/voided fields set — only post_payment()/void_payment() may set these';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_payment_insert_integrity() from public, anon, authenticated;
create trigger payments_check_insert_integrity
  before insert on public.payments
  for each row execute function public.check_payment_insert_integrity();

-- How a payment's amount applies to one or more sales. Multiple rows per payment (split
-- across sales) and, in principle, multiple payments allocated to one sale (partial
-- payments over time) are both supported. Never edited/deleted once the parent payment is
-- posted — a correction is a new payment/allocation (e.g. a reversal) with its own audit
-- trail, never an edit of posted history (see blueprint §9 financial-correction section).
create table public.payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.payments(id),
  sale_id     uuid not null references public.sales(id),
  amount      numeric(10,2) not null check (amount > 0),
  created_at  timestamptz not null default now()
);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_sale_idx on public.payment_allocations (sale_id);

-- Immutable point-in-time snapshot — never recomputed live, never edited after creation.
create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text,
  sale_id         uuid not null references public.sales(id),
  snapshot        jsonb not null,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create unique index invoices_number_key on public.invoices (invoice_number) where invoice_number is not null;
create unique index invoices_sale_key on public.invoices (sale_id);

create table public.returns (
  id                uuid primary key default gen_random_uuid(),
  return_number     text,
  sale_id           uuid not null references public.sales(id),
  sale_item_id      uuid references public.sale_items(id),
  item_description  text not null,
  reason            text not null,
  disposition       text check (disposition in ('restock','damaged','hold')),
  refund_method     text,
  refund_amount     numeric(10,2) check (refund_amount >= 0),
  status            text not null default 'pending' check (status in ('pending','processed')),
  created_by        uuid references public.profiles(id),
  processed_by      uuid references public.profiles(id),
  processed_at      timestamptz,
  created_at        timestamptz not null default now()
);
comment on table public.returns is
  'No legacy precedent (legacy has no returns API) and the current frontend has the UI/type '
  'but no exercised seed data — genuinely under-specified. Included because the approved '
  'frontend models it; flagged as an open question in the blueprint, not a blocking one.';
create unique index returns_number_key on public.returns (return_number) where return_number is not null;
create index returns_sale_idx on public.returns (sale_id);

-- Single-row global config (fine for one location; see blueprint open questions if
-- multi-location/multi-jurisdiction tax is ever planned).
create table public.sales_settings (
  id               smallint primary key default 1 check (id = 1),
  tax_rate         numeric(6,4) not null default 0,
  tax_label        text not null default '',
  business_name    text not null default 'LAL Motors Inc.',
  business_address text not null default '',
  business_phone   text not null default '',
  updated_at       timestamptz not null default now()
);
create trigger sales_settings_set_updated_at before update on public.sales_settings
  for each row execute function public.set_updated_at();


-- #######################################################################################
-- 8. SCRAP OPERATIONS  (independent of the vehicle spine) + TIRE/RIM TRACKING
-- #######################################################################################
-- scrap_loads / scrap_load_financials split: the driver-safe operational columns live on
-- scrap_loads; weight/rate/amount/manager_notes (the exact fields the client spec says a
-- Scrap Driver must never see or enter) live on a separate 1:1 table. This makes the
-- confidentiality boundary a clean ROW-LEVEL-SECURITY-friendly table split instead of
-- needing column-level grants or a view — see blueprint §9/"confidentiality pattern".

create table public.scrap_loads (
  id                   uuid primary key default gen_random_uuid(),
  driver_id            uuid not null references public.profiles(id),
  load_date            date not null default current_date,
  status               text not null default 'new'
                       check (status in ('new','ready_for_review','approved','closed')),
  -- "ticket_missing" is a COMPUTED display state (status = 'new' and no ticket photo past the
  -- load_date), never stored — mirrors the approved frontend's effectiveLoadStatus() exactly.
  load_photo_asset_id    uuid references public.media_assets(id),
  ticket_photo_asset_id  uuid references public.media_assets(id),
  client_request_id      uuid,   -- idempotency key for "create load" retried under bad yard connectivity
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index scrap_loads_client_request_key on public.scrap_loads (client_request_id) where client_request_id is not null;
create index scrap_loads_driver_date_idx on public.scrap_loads (driver_id, load_date);
create index scrap_loads_status_idx on public.scrap_loads (status);
create trigger scrap_loads_set_updated_at before update on public.scrap_loads
  for each row execute function public.set_updated_at();

-- Authorization boundary RLS cannot express: a Scrap Driver's own-records policy (below)
-- already lets them INSERT/UPDATE their own load, but that must stay an EVIDENCE workflow
-- (new -> ready_for_review) — approving or closing a load is an office decision, per the
-- explicit requirement. is_scrap_office() bypasses this check entirely.
-- SECURITY INVOKER — see check_vehicles_mutation_authorization's comment above for why.
create or replace function public.check_scrap_load_status_authorization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- See check_vehicles_mutation_authorization's comment re: current_user vs. auth.uid().
  if current_user not in ('authenticated', 'anon') or public.is_scrap_office() then
    return new;
  end if;
  if new.status in ('approved', 'closed') then
    raise exception 'scrap_loads: only an office role (owner/engineer_admin/manager/auction) may set status to approved/closed';
  end if;
  if tg_op = 'UPDATE' and old.status in ('approved', 'closed') then
    raise exception 'scrap_loads: a driver cannot modify a load once it is approved/closed';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_scrap_load_status_authorization() from public, anon, authenticated;
create trigger scrap_loads_check_status_authorization
  before insert or update on public.scrap_loads
  for each row execute function public.check_scrap_load_status_authorization();

create table public.scrap_payments (
  id                        uuid primary key default gen_random_uuid(),
  driver_id                 uuid not null references public.profiles(id),
  payment_date              date not null default current_date,
  amount_received           numeric(10,2) not null check (amount_received >= 0),
  method                    text not null check (method in ('Check','ACH','Wire','Other')),
  reference_number          text not null default '',
  proof_asset_id            uuid references public.media_assets(id),
  notes                     text not null default '',
  entered_by                uuid references public.profiles(id),
  -- A mismatch between a payment and the sum of its linked loads must never be silently
  -- resolved by rewriting historical load amounts — only by an authorized, reasoned override,
  -- set at INSERT time if known then, or via a correction row (correction_of) if discovered
  -- later — never a direct UPDATE of a posted payment (see RLS below: no update policy).
  discrepancy_reason        text,
  discrepancy_approved_by   uuid references public.profiles(id),
  -- A correction/reversal is a NEW row referencing the original — mirrors export_payments'
  -- existing correction_of pattern, applied here for the same reason (item 8: "preserve
  -- immutable financial history").
  correction_of             uuid references public.scrap_payments(id),
  correction_reason         text,
  created_at                timestamptz not null default now(),
  constraint scrap_payments_correction_reason_chk check (correction_of is null or correction_reason is not null)
);
create index scrap_payments_driver_idx on public.scrap_payments (driver_id, payment_date);
create index scrap_payments_correction_of_idx on public.scrap_payments (correction_of) where correction_of is not null;

-- Manager-only financial extension of a scrap load (1:1).
create table public.scrap_load_financials (
  scrap_load_id  uuid primary key references public.scrap_loads(id) on delete cascade,
  weight         numeric(10,2) check (weight >= 0),
  rate           numeric(8,4) check (rate >= 0),
  amount         numeric(10,2) check (amount >= 0),
  manager_notes  text not null default '',
  payment_id     uuid references public.scrap_payments(id),
  measured_by    uuid references public.profiles(id),
  measured_at    timestamptz
);
create index scrap_load_financials_payment_idx on public.scrap_load_financials (payment_id) where payment_id is not null;

-- Explicit N-loads-to-1-payment join (supports relinking/correction with a real FK, instead
-- of an array column).
create table public.scrap_payment_loads (
  payment_id     uuid not null references public.scrap_payments(id) on delete cascade,
  scrap_load_id  uuid not null references public.scrap_loads(id) on delete cascade,
  primary key (payment_id, scrap_load_id)
);

-- A driver-photographed check, before a manager reconciles it into a real scrap_payments row.
create table public.driver_check_submissions (
  id                 uuid primary key default gen_random_uuid(),
  driver_id          uuid not null references public.profiles(id),
  photo_asset_id     uuid not null references public.media_assets(id),
  linked_payment_id  uuid references public.scrap_payments(id),
  created_at         timestamptz not null default now()
);
create index driver_check_submissions_driver_idx on public.driver_check_submissions (driver_id, created_at);

create table public.rim_obligations (
  id                     uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references public.customers(id),
  tires_qty              int not null check (tires_qty >= 0),
  aluminum_owed          int not null default 0 check (aluminum_owed >= 0),
  steel_owed             int not null default 0 check (steel_owed >= 0),
  pickup_photo_asset_id  uuid references public.media_assets(id),
  employee_id            uuid references public.profiles(id),
  notes                  text not null default '',
  created_at             timestamptz not null default now()
);
create index rim_obligations_customer_idx on public.rim_obligations (customer_id, created_at);

-- Append-only; never edited or deleted — balance is always DERIVED (owed - sum(returns)),
-- never a manually-decremented column, so history survives even once the balance reaches zero.
create table public.rim_returns (
  id                 uuid primary key default gen_random_uuid(),
  -- No cascade: append-only evidence, not disposable child data.
  obligation_id      uuid not null references public.rim_obligations(id),
  aluminum_returned  int not null default 0 check (aluminum_returned >= 0),
  steel_returned     int not null default 0 check (steel_returned >= 0),
  photo_asset_id     uuid references public.media_assets(id),
  notes              text not null default '',
  employee_id        uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);
comment on table public.rim_returns is
  'A CHECK that returned <= owed requires aggregating sibling rows, which a column-level '
  'CHECK constraint cannot express — enforced by the deferred record_rim_return() RPC instead '
  '(blueprint §13/§20), not at the schema level.';
create index rim_returns_obligation_idx on public.rim_returns (obligation_id, created_at);

create table public.daily_closes (
  id              uuid primary key default gen_random_uuid(),
  close_date      date not null,
  closed_by       uuid references public.profiles(id),
  closed_at       timestamptz not null default now(),
  override_reason text,
  totals          jsonb not null default '{}'::jsonb
);
comment on table public.daily_closes is
  'Frozen snapshot of the day''s totals at close time — a report, not a live-recomputed view, '
  'so a later correction to a load never silently rewrites a historical close.';
create unique index daily_closes_date_key on public.daily_closes (close_date);


-- #######################################################################################
-- 9. CONTAINERS / EXPORT
-- #######################################################################################
-- container_jobs / container_shipping_info split mirrors the EXACT confidential-field cut
-- already implemented in the approved frontend's toLoaderSafeContainer() selector: a
-- Container Loading Employee gets the full container_jobs row (operational only) and
-- media_assets for it, and NOTHING from container_shipping_info, consignees, export_invoices,
-- export_invoice_line_items, export_invoice_revisions, or export_payments — enforced by RLS
-- in §11 below, not just by hiding fields in the UI.

create table public.container_jobs (
  id                      uuid primary key default gen_random_uuid(),
  t_ref                   text not null,       -- e.g. "T26" — permanent, never silently reused
  container_number        text,                -- official container number, confirmed by the loading employee
  number_confirmed        boolean not null default false,
  status                  text not null default 'loading'
                          check (status in ('loading','ready_for_invoice','on_the_way','closed')),
  started_at              timestamptz,
  finished_at             timestamptz,
  loading_list_confirmed  boolean not null default false,
  created_by              uuid references public.profiles(id),
  last_update_at          timestamptz not null default now(),
  closed_at               timestamptz,
  closed_by               uuid references public.profiles(id),
  close_override_reason   text,
  created_at              timestamptz not null default now()
);
comment on table public.container_jobs is
  'THE one shared container record between Container Loading Employee and Export Management. '
  'Deliberately holds ONLY operational/loader-safe columns — see container_shipping_info.';
create unique index container_jobs_t_ref_key on public.container_jobs (t_ref);
create unique index container_jobs_number_key on public.container_jobs (container_number) where container_number is not null;
create index container_jobs_status_idx on public.container_jobs (status);

-- Authorization boundary RLS cannot express: a Container Loading Employee's workflow ends at
-- the trusted transition to ready_for_invoice — on_the_way/closed, and closed_by/
-- close_override_reason, are Export-authorized decisions (owner/engineer_admin/
-- export_manager). Deliberately checks is_export_authorized(), NOT is_container_staff() —
-- container_loading passes the latter (it needs operational access to this table) but must
-- fail this specific gate.
-- SECURITY INVOKER — see check_vehicles_mutation_authorization's comment above for why.
create or replace function public.check_container_job_status_authorization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- See check_vehicles_mutation_authorization's comment re: current_user vs. auth.uid(). This
  -- function is now a SECONDARY invariant backstop, not the primary defense — the primary
  -- defense is the column-level REVOKE/GRANT immediately below the table, which means an
  -- ordinary `authenticated` Container Loader cannot even SPECIFY status/closed_at/closed_by/
  -- close_override_reason in a direct INSERT/UPDATE statement in the first place (fails at
  -- the grant-check stage, before this trigger body ever runs). This trigger still exists to
  -- reject an impossible combination regardless of who/what is writing — including the
  -- future finish_container_loading()/close_container() RPCs themselves, which DO have
  -- column-level privilege (they run as the table owner) and so could otherwise write a
  -- malformed combination if they had a bug.
  if current_user not in ('authenticated', 'anon') or public.is_export_authorized() then
    return new;
  end if;
  -- ready_for_invoice is ALSO a trusted transition, not a loader self-service action — it
  -- must happen only through finish_container_loading() (deferred), which is where the
  -- required evidence/final-list checks become atomic with the status change. A direct
  -- client (including Container Loading Employee, who otherwise has ordinary operational
  -- access to this table via is_container_staff()) can no longer force this transition —
  -- now doubly so: the column-level grant below additionally prevents `status` from even
  -- appearing in a direct client's INSERT/UPDATE statement.
  if new.status in ('ready_for_invoice', 'on_the_way', 'closed') then
    raise exception 'container_jobs: only an export-authorized role (owner/engineer_admin/export_manager) may set status to ready_for_invoice/on_the_way/closed — loading -> ready_for_invoice requires finish_container_loading()';
  end if;
  if new.closed_by is not null or new.close_override_reason is not null then
    raise exception 'container_jobs: only an export-authorized role may set closed_by/close_override_reason';
  end if;
  if tg_op = 'UPDATE' and old.status in ('ready_for_invoice', 'on_the_way', 'closed') then
    raise exception 'container_jobs: a loading employee cannot modify a container once it is past the loading stage';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_container_job_status_authorization() from public, anon, authenticated;
create trigger container_jobs_check_status_authorization
  before insert or update on public.container_jobs
  for each row execute function public.check_container_job_status_authorization();

-- PRIMARY defense (per the correctness review): table/column privileges, not the trigger
-- above, are what actually stop a direct `authenticated` Container Loader from touching
-- status/closed_at/closed_by/close_override_reason — the same "revoke table-level grant,
-- re-grant only the safe columns" pattern used for sales/sale_items. Safe loader-editable
-- evidence/operational columns (container_number, number_confirmed, started_at, finished_at,
-- loading_list_confirmed, last_update_at) remain directly writable; status and every
-- closing/export field are excluded from BOTH lists below — loading -> ready_for_invoice
-- becomes finish_container_loading()'s job, and on_the_way/closed remain Export RPCs' job.
-- The table owner (the future RPCs) is unaffected by this REVOKE, as always.
revoke insert, update on public.container_jobs from authenticated;
grant insert (t_ref, container_number, number_confirmed, started_at, finished_at, loading_list_confirmed, created_by, last_update_at)
  on public.container_jobs to authenticated;
grant update (container_number, number_confirmed, started_at, finished_at, loading_list_confirmed, last_update_at)
  on public.container_jobs to authenticated;

create table public.consignees (
  id             uuid primary key default gen_random_uuid(),
  company        text not null,
  contact        text not null default '',
  address        text not null default '',
  city           text not null default '',
  state_province text not null default '',
  country        text not null default '',
  phone          text not null default '',
  email          text not null default '',
  created_at     timestamptz not null default now()
);
comment on table public.consignees is
  'Reusable consignee profiles, Export-side only. export_invoices.consignee_snapshot freezes '
  'the details actually used at finalization, so a later edit here never rewrites a finalized '
  'invoice.';

create table public.container_shipping_info (
  container_id         uuid primary key references public.container_jobs(id) on delete cascade,
  destination_country  text not null default '',
  destination_port     text not null default '',
  trucking_company     text not null default '',
  consignee_id         uuid references public.consignees(id),
  ship_date            date,
  eta                  date,
  shipping_note        text not null default '',
  notes                text not null default ''
);
comment on table public.container_shipping_info is
  'Confidential 1:1 extension of container_jobs — destination, trucking and consignee '
  'assignment, exactly the fields the approved Container Loading UI never receives.';

-- No cascade: this is the container's activity log/evidence, not disposable child data.
create table public.container_events (
  id          uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.container_jobs(id),
  actor_id    uuid references public.profiles(id),
  actor_name  text not null,
  action      text not null,
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create index container_events_container_idx on public.container_events (container_id, created_at);

create table public.export_invoices (
  id                 uuid primary key default gen_random_uuid(),
  container_id       uuid not null references public.container_jobs(id),
  t_ref              text not null,
  invoice_number     text,
  status             text not null default 'Draft' check (status in ('Draft','Review','Finalized')),
  consignee_id       uuid references public.consignees(id),
  consignee_snapshot jsonb,
  destination        text not null default '',
  currency           text not null default 'USD',
  notes              text not null default '',
  needs_review       text[] not null default '{}',
  finalized_at       timestamptz,
  created_at         timestamptz not null default now()
);
comment on table public.export_invoices is
  'status progresses Draft → Review → Finalized. Once Finalized the invoice and its line '
  'items are immutable — a correction creates an export_invoice_revisions row, never an '
  'in-place edit (legacy only had Draft/Final with no revision mechanism at all; this is a '
  'deliberate improvement, see blueprint §27).';
create unique index export_invoices_container_key on public.export_invoices (container_id);
create unique index export_invoices_number_key on public.export_invoices (invoice_number) where invoice_number is not null;

create table public.export_invoice_line_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.export_invoices(id) on delete cascade,
  description text not null,
  quantity    int not null check (quantity > 0),
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  category    text,
  condition   text,
  line_total  numeric(12,2) generated always as (quantity * unit_price) stored,
  created_at  timestamptz not null default now()
);
create index export_invoice_line_items_invoice_idx on public.export_invoice_line_items (invoice_id);

-- The table comment above claims Finalized invoices are immutable — this is what actually
-- enforces that claim (previously aspirational prose only, not enforced). Draft/Review stay
-- freely editable by any export-authorized user; once status = 'Finalized', no further
-- update to the invoice row itself is allowed. revise_export_invoice() (deferred) is the only
-- path to a post-Finalized change, and it works by inserting an export_invoice_revisions row,
-- not by editing this one.
create or replace function public.check_export_invoice_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- old.status is available on both UPDATE and DELETE (OLD is defined for both; NEW is only
  -- defined for UPDATE) — this blocks BOTH operations once Finalized. Draft/Review rows are
  -- unaffected either way (old.status is not 'Finalized', so execution falls through to the
  -- return below, permitting the update/delete to proceed).
  if old.status = 'Finalized' then
    raise exception 'export_invoices: a Finalized invoice is immutable (no update or delete) — use revise_export_invoice() / export_invoice_revisions instead';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.check_export_invoice_immutability() from public, anon, authenticated;
create trigger export_invoices_check_immutability
  before update or delete on public.export_invoices
  for each row execute function public.check_export_invoice_immutability();

-- Same immutability guarantee, extended to the line items themselves: once the PARENT
-- invoice is Finalized, its line items cannot be inserted, updated, or deleted either.
create or replace function public.check_export_invoice_line_items_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.export_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status = 'Finalized' then
    raise exception 'export_invoice_line_items: parent invoice is Finalized — line items are immutable';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.check_export_invoice_line_items_immutability() from public, anon, authenticated;
create trigger export_invoice_line_items_check_immutability
  before insert or update or delete on public.export_invoice_line_items
  for each row execute function public.check_export_invoice_line_items_immutability();

-- No cascade: immutable revision history, not disposable child data.
create table public.export_invoice_revisions (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.export_invoices(id),
  saved_by           uuid references public.profiles(id),
  saved_at           timestamptz not null default now(),
  reason             text not null,
  items_snapshot     jsonb not null,
  consignee_snapshot jsonb
);
create index export_invoice_revisions_invoice_idx on public.export_invoice_revisions (invoice_id, saved_at desc);

create table public.export_payments (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.export_invoices(id),
  payment_date       date not null default current_date,
  amount             numeric(12,2) not null check (amount > 0),
  type               text not null check (type in ('Deposit','Additional Deposit','Final Payment','Adjustment')),
  method             text not null check (method in ('Wire','ACH','Check','Cash','Other')),
  reference_number   text not null default '',
  notes              text not null default '',
  proof_asset_id     uuid references public.media_assets(id),
  entered_by         uuid references public.profiles(id),
  -- A correction inserts a NEW row referencing the original rather than editing it —
  -- "never silently delete/edit finalized payment history" is an explicit client requirement.
  correction_of      uuid references public.export_payments(id),
  correction_reason  text,
  created_at         timestamptz not null default now()
);
create index export_payments_invoice_idx on public.export_payments (invoice_id);


-- #######################################################################################
-- 10. IDEMPOTENCY KEYS (cross-cutting, general-purpose)
-- #######################################################################################
-- Dedicated per-table client_request_id columns already cover the highest-risk mobile/yard
-- flows (scrap_loads above). A general-purpose table catches any other "retry under bad
-- connectivity" case a future RPC needs without a schema change:

create table public.idempotency_keys (
  key          uuid primary key,
  scope        text not null,         -- e.g. 'receive_vehicle', 'finish_container_loading'
  entity_id    uuid,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  result       jsonb
);
comment on table public.idempotency_keys is
  'General-purpose idempotency ledger for future RPCs (vehicle receiving, dismantling '
  'completion, approved-part creation, container-loading-finish, payment recording, invoice '
  'finalization, etc. — see blueprint §20). A client sends the same key on retry; the RPC '
  'checks this table first and returns the stored result instead of repeating the write.';
create index idempotency_keys_scope_idx on public.idempotency_keys (scope, created_at);


-- #######################################################################################
-- 11. ROW LEVEL SECURITY
-- #######################################################################################
-- Defense in depth under service-layer authorization (deferred RPCs), not the only gate.
-- Deliberately NOT one hyper-specific policy per table — operational tables share a common
-- "authenticated staff" read/write policy; the few tables with a real confidentiality or
-- own-records-only requirement get a specific policy instead. Write access for most
-- transactional tables is expected to ultimately go through SECURITY DEFINER RPCs (deferred,
-- §13 of the blueprint) which bypass RLS deliberately — these policies are what protects
-- any interim or supplementary direct-table access via the client SDK.

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_invites enable row level security;
alter table public.media_assets enable row level security;
alter table public.audit_logs enable row level security;
alter table public.carriers enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_events enable row level security;
alter table public.dismantling_sessions enable row level security;
alter table public.vehicle_intake_batches enable row level security;
alter table public.vehicle_intake_items enable row level security;
alter table public.vehicle_completions enable row level security;
alter table public.parts enable row level security;
alter table public.part_operations enable row level security;
alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.invoices enable row level security;
alter table public.returns enable row level security;
alter table public.sales_settings enable row level security;
alter table public.scrap_loads enable row level security;
alter table public.scrap_load_financials enable row level security;
alter table public.scrap_payments enable row level security;
alter table public.scrap_payment_loads enable row level security;
alter table public.driver_check_submissions enable row level security;
alter table public.rim_obligations enable row level security;
alter table public.rim_returns enable row level security;
alter table public.daily_closes enable row level security;
alter table public.container_jobs enable row level security;
alter table public.consignees enable row level security;
alter table public.container_shipping_info enable row level security;
alter table public.container_events enable row level security;
alter table public.export_invoices enable row level security;
alter table public.export_invoice_line_items enable row level security;
alter table public.export_invoice_revisions enable row level security;
alter table public.export_payments enable row level security;
alter table public.idempotency_keys enable row level security;

-- --- Identity & access ------------------------------------------------------------------

-- Read access stays is_admin() (owner OR engineer_admin — viewing the team/activity screens
-- is not a privilege-escalation risk). WRITE access to profiles/roles/invites is is_owner()
-- ONLY — see is_owner() comment above: Engineer Admin must not be able to disable/remove an
-- account, change anyone's role, or manage invites, all of which nav.ts confirms (only Owner
-- has a "Users & Activity" / Team nav entry; Engineer Admin does not).
create policy profiles_self_or_admin_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_owner_write on public.profiles
  for update using (public.is_owner());

create policy roles_read_all on public.roles for select using (auth.role() = 'authenticated');
create policy permissions_read_all on public.permissions for select using (auth.role() = 'authenticated');
create policy role_permissions_read_all on public.role_permissions for select using (auth.role() = 'authenticated');

create policy user_roles_self_or_admin_select on public.user_roles
  for select using (user_id = auth.uid() or public.is_admin());
create policy user_roles_owner_write on public.user_roles
  for all using (public.is_owner()) with check (public.is_owner());

create policy user_invites_owner_all on public.user_invites
  for all using (public.is_owner()) with check (public.is_owner());

-- --- Media: domain-authorization gate via can_access_media(), not a blanket authenticated
--     policy — see can_access_media() comment above. Applies identically to reads and writes;
--     a Scrap Driver, Container Loading Employee, etc. cannot attach OR read media outside
--     their own permitted domain/ownership. INSERT additionally requires media_owner_exists()
--     — a random/nonexistent owner_id fails even if the caller's domain access is otherwise
--     legitimate. No update/delete policy — status transitions (processing -> ready/failed)
--     remain a service-role background-worker responsibility. ---------------------------------

create policy media_assets_domain_read on public.media_assets
  for select using (public.can_access_media(owner_type, owner_id));
create policy media_assets_domain_insert on public.media_assets
  for insert with check (
    public.can_access_media(owner_type, owner_id)
    and public.media_owner_exists(owner_type, owner_id)
  );

-- --- Audit: trusted system history. owner/engineer_admin read all; NO client-facing insert
--     policy at all — every row must come from write_audit_log(), a SECURITY DEFINER helper
--     that bypasses RLS, called from inside a deferred domain RPC (see blueprint §3/§13).
--     A normal authenticated session (including via the Supabase client SDK directly) cannot
--     fabricate audit history: there is no policy that would permit the insert. -------------

create policy audit_logs_admin_read on public.audit_logs
  for select using (public.is_admin());

-- --- Vehicles / Auction / Receiving / Dispatch / Dismantling: domain-scoped via
--     is_vehicle_domain_staff() / is_dismantling_staff() — NOT a blanket authenticated check.
--     A Scrap Driver, Container Loading Employee or Export Manager fails both helpers and
--     gets no access here at all, matching nav.ts exactly (neither has a vehicles screen). --

create policy carriers_domain_read on public.carriers for select using (public.is_vehicle_domain_staff());
create policy carriers_domain_write on public.carriers for all
  using (public.is_vehicle_domain_staff()) with check (public.is_vehicle_domain_staff());

-- NOT a single "for all" grant — split so the closing/reassignment guard in
-- check_vehicles_mutation_authorization (above) is the thing narrowing write access for
-- non-reviewer vehicle-domain roles, not an RLS clause (which can't see individual columns).
create policy vehicles_domain_read on public.vehicles for select using (public.is_vehicle_domain_staff());
create policy vehicles_domain_insert on public.vehicles for insert with check (public.is_vehicle_domain_staff());
create policy vehicles_domain_update on public.vehicles for update
  using (public.is_vehicle_domain_staff()) with check (public.is_vehicle_domain_staff());

create policy vehicle_events_domain_read on public.vehicle_events for select using (public.is_vehicle_domain_staff());
create policy vehicle_events_domain_insert on public.vehicle_events for insert with check (public.is_vehicle_domain_staff());

create policy dismantling_sessions_domain_read on public.dismantling_sessions for select using (public.is_dismantling_staff());
create policy dismantling_sessions_domain_write on public.dismantling_sessions for all
  using (public.is_dismantling_staff()) with check (public.is_dismantling_staff());

create policy vehicle_intake_batches_domain on public.vehicle_intake_batches for all
  using (public.is_vehicle_domain_staff()) with check (public.is_vehicle_domain_staff());
create policy vehicle_intake_items_domain on public.vehicle_intake_items for all
  using (public.is_vehicle_domain_staff()) with check (public.is_vehicle_domain_staff());
create policy vehicle_completions_domain on public.vehicle_completions for all
  using (public.is_vehicle_domain_staff()) with check (public.is_vehicle_domain_staff());

-- --- Parts: domain-scoped via is_parts_staff() for row visibility/basic capture — NOT a
--     single "for all" grant. Column-sensitive authorization (pricing, location, SKU,
--     sellability, stage, approval/reject/duplicate decisions) is enforced by the
--     check_parts_mutation_authorization trigger above, since RLS cannot express
--     "any parts-staff member except these specific columns." -------------------------------

create policy parts_domain_read on public.parts for select using (public.is_parts_staff());
create policy parts_domain_insert on public.parts for insert with check (public.is_parts_staff());
create policy parts_domain_update on public.parts for update
  using (public.is_parts_staff()) with check (public.is_parts_staff());
-- part_operations is an append-only change log — select + insert only, no update/delete.
create policy part_operations_domain_read on public.part_operations for select using (public.is_parts_staff());
create policy part_operations_domain_insert on public.part_operations for insert with check (public.is_parts_staff());

-- --- Customers & Sales: domain-scoped via is_sales_staff() (owner/engineer_admin/manager
--     only — matches nav.ts: no other role has a /sales screen). No customer-facing portal
--     exists yet. -----------------------------------------------------------------------------

create policy customers_domain on public.customers for all
  using (public.is_sales_staff()) with check (public.is_sales_staff());
create policy quotes_domain on public.quotes for all
  using (public.is_sales_staff()) with check (public.is_sales_staff());
create policy quote_items_domain on public.quote_items for all
  using (public.is_sales_staff()) with check (public.is_sales_staff());
-- sales: NOT a single "for all" policy — split into explicit select/insert/update. Direct
-- clients may create/edit a sale's ordinary fields (customer, notes, line-adjacent totals
-- entered at order time); amount_paid/balance_due/payment_status/fulfillment_status/
-- finalized_at are RPC-only (post_payment()/void_payment()/fulfill_sales_order(), deferred).
create policy sales_domain_read on public.sales for select using (public.is_sales_staff());
create policy sales_domain_insert on public.sales for insert with check (public.is_sales_staff());
create policy sales_domain_update on public.sales for update
  using (public.is_sales_staff()) with check (public.is_sales_staff());
-- Column-level privilege, not RLS (RLS is row-level and cannot express "this column is
-- off-limits") — and a WHITELIST, not a blacklist: revoke table-level INSERT/UPDATE from
-- authenticated entirely first, then explicitly re-grant only the columns a direct client
-- legitimately creates/edits. amount_paid/balance_due/payment_status/fulfillment_status/
-- finalized_at are never in that grant list, on EITHER insert or update — a direct INSERT
-- that tries to fabricate e.g. payment_status = 'PAID' now fails at the grant-check stage
-- (an omitted column simply takes its safe default), and the same four states plus
-- finalized_at can never be touched by a direct UPDATE either. Only the deferred
-- post_payment()/void_payment()/fulfill_sales_order() RPCs (running as the table owner,
-- which bypasses column grants the same way it bypasses RLS) can set them.
revoke insert, update on public.sales from authenticated;
grant insert (sale_number, quote_id, customer_id, salesperson_id, subtotal, discount, tax_rate, tax, total, notes)
  on public.sales to authenticated;
grant update (sale_number, quote_id, customer_id, salesperson_id, subtotal, discount, tax_rate, tax, total, notes, status)
  on public.sales to authenticated;

create policy sale_items_domain on public.sale_items for all
  using (public.is_sales_staff()) with check (public.is_sales_staff());
-- stock_action is the Draft/Reserve/Fulfill switch (Section 7) — setting it to 'reserve' or
-- 'fulfill' must go through reserve_stock()/fulfill_sales_order() (deferred), which also
-- atomically writes the matching inventory_reservations row; a bare direct update of this
-- column alone would desynchronize the two.
--
-- CORRECTNESS FIX: a column-level REVOKE alone does NOT narrow an existing TABLE-level
-- grant — Postgres checks table-level and column-level privileges independently, and
-- Supabase's own platform defaults grant blanket table-level INSERT/UPDATE on every new
-- table to `authenticated`. A bare `revoke insert (stock_action) ... from authenticated`
-- (the previous version of this statement) left that table-level grant fully intact, so
-- `authenticated` could still set stock_action via the table-level privilege regardless —
-- the column-level revoke was a no-op. Fixed the same way `sales` already does it: revoke
-- the table-level grant FIRST, then explicitly re-grant only the safe columns. stock_action,
-- sale_id, and part_id are deliberately absent from both lists — sale_id/part_id establish
-- the line's identity (changing them post-creation could desynchronize a reservation that
-- already matched against them; see check_reservation_integrity) and stock_action is
-- RPC-only. A direct client can therefore never specify or change stock_action at all; the
-- RPC (table owner) is unaffected by this REVOKE, the same mechanism `sales` already relies on.
revoke insert, update on public.sale_items from authenticated;
grant insert (sale_id, part_id, stock_sku, description, quantity, unit_price, discount, line_total)
  on public.sale_items to authenticated;
grant update (stock_sku, description, quantity, unit_price, discount, line_total)
  on public.sale_items to authenticated;
-- payments: select + insert only, no update/delete — a payment's status (pending/posted/void)
-- may ONLY change via the deferred post_payment()/void_payment() SECURITY DEFINER RPCs, never
-- a direct client update. See the payments table comment and blueprint §6/§9.
create policy payments_domain_read on public.payments for select using (public.is_sales_staff());
create policy payments_domain_insert on public.payments for insert with check (public.is_sales_staff());
-- payment_allocations: NO insert policy at all for direct clients. Creating an allocation is
-- part of the allocate_payment()/post_payment() transaction (which must validate: allocation
-- total <= payment amount, the sale belongs to the SAME customer as the payment, and the sale
-- is not over-allocated — none of which RLS or a CHECK constraint can express, since it
-- requires aggregating sibling rows and cross-referencing two other tables). Only SELECT is
-- a direct-client policy; insert happens exclusively through that deferred, SECURITY DEFINER
-- RPC, which bypasses RLS.
create policy payment_allocations_domain_read on public.payment_allocations for select using (public.is_sales_staff());
-- invoices are an immutable point-in-time snapshot (see table comment) — select + insert
-- only, deliberately no update/delete policy.
create policy invoices_domain_read on public.invoices for select using (public.is_sales_staff());
create policy invoices_domain_insert on public.invoices for insert with check (public.is_sales_staff());
create policy returns_domain on public.returns for all
  using (public.is_sales_staff()) with check (public.is_sales_staff());
create policy sales_settings_read_all on public.sales_settings for select using (auth.role() = 'authenticated');
create policy sales_settings_admin_write on public.sales_settings for update using (public.is_admin());
-- inventory_reservations: NO insert/update/delete policy for direct clients — reserve/
-- fulfill/release are exclusively reserve_stock()/fulfill_sales_order()/release_reservation()
-- (deferred, SECURITY DEFINER) responsibilities, per the explicit requirement that this not
-- be direct-client-writable CRUD. Only SELECT remains a direct-client policy. The
-- check_reservation_integrity trigger below (fires regardless of who/what writes the row,
-- RLS-bypassing RPC included) additionally guarantees a reservation can never reference a
-- part/sale/sale_item combination that doesn't actually agree with each other.
create policy inventory_reservations_domain_read on public.inventory_reservations
  for select using (public.is_sales_staff() or public.is_parts_staff());

-- --- Scrap: driver sees/creates only their OWN operational load rows (no weight/rate/amount
--     — those live in scrap_load_financials, which drivers get no access to at all); office
--     roles (is_scrap_office() — owner/engineer_admin/manager/auction, legacy's own cross-
--     cutting rule) see everything. ----------------------------------------------------------

create policy scrap_loads_driver_own on public.scrap_loads
  for select using (driver_id = auth.uid() or public.is_scrap_office());
create policy scrap_loads_driver_insert_own on public.scrap_loads
  for insert with check (driver_id = auth.uid() or public.is_scrap_office());
create policy scrap_loads_driver_update_own on public.scrap_loads
  for update using (driver_id = auth.uid() or public.is_scrap_office());

create policy scrap_load_financials_office_only on public.scrap_load_financials
  for all
  using (public.is_scrap_office())
  with check (public.is_scrap_office());

-- select + insert only — NO update policy. Immutable financial history: a correction is a
-- new row via correction_of/correction_reason (added above), never an edit of the original.
create policy scrap_payments_office_read on public.scrap_payments
  for select using (driver_id = auth.uid() or public.is_scrap_office());
create policy scrap_payments_office_write on public.scrap_payments
  for insert with check (public.is_scrap_office());

create policy scrap_payment_loads_office on public.scrap_payment_loads
  for all
  using (public.is_scrap_office())
  with check (public.is_scrap_office());

create policy driver_check_submissions_driver_own on public.driver_check_submissions
  for select using (driver_id = auth.uid() or public.is_scrap_office());
create policy driver_check_submissions_driver_insert on public.driver_check_submissions
  for insert with check (driver_id = auth.uid() or public.is_scrap_office());
create policy driver_check_submissions_office_update on public.driver_check_submissions
  for update using (public.is_scrap_office());

-- rim_obligations/rim_returns: office-side tire/rim tracking (is_scrap_office()) OR the
-- Scrap Driver who actually picked up/returned the rims for their own rows — mirrors the
-- scrap_loads own-records pattern rather than a blanket authenticated policy.
create policy rim_obligations_domain on public.rim_obligations for all
  using (public.is_scrap_office() or (employee_id = auth.uid() and public.has_role('scrap_driver')))
  with check (public.is_scrap_office() or (employee_id = auth.uid() and public.has_role('scrap_driver')));
-- rim_returns is append-only (see table comment) — select + insert only, no update/delete.
create policy rim_returns_domain_read on public.rim_returns
  for select using (public.is_scrap_office() or (employee_id = auth.uid() and public.has_role('scrap_driver')));
create policy rim_returns_domain_insert on public.rim_returns
  for insert with check (public.is_scrap_office() or (employee_id = auth.uid() and public.has_role('scrap_driver')));
-- daily_closes is a frozen snapshot (see table comment) — select + insert only, no update/delete.
create policy daily_closes_office_read on public.daily_closes
  for select using (public.is_scrap_office());
create policy daily_closes_office_insert on public.daily_closes
  for insert with check (public.is_scrap_office());

-- --- Containers / Export: the critical confidentiality boundary. is_container_staff() is
--     the operational layer (Loading Employee gets container_jobs + its media only); every
--     other table here is export-authorized only. Front Desk Manager fails BOTH gates. -----

create policy container_jobs_domain_read on public.container_jobs for select using (public.is_container_staff());
create policy container_jobs_domain_write on public.container_jobs for all
  using (public.is_container_staff()) with check (public.is_container_staff());

-- container_events logs BOTH loader-side actions (STARTED_LOADING, NUMBER_CONFIRMED,
-- FINISHED_LOADING) and export-side actions on the same container_jobs row — it mirrors
-- container_jobs' own operational access, not the export-only tables below. A loading
-- employee must be able to read/write their own loading history here; confidential detail
-- never belongs in this generic log (it lives in container_shipping_info/export_invoices
-- instead). Append-only — select + insert only, no update/delete.
create policy container_events_domain_read on public.container_events
  for select using (public.is_container_staff());
create policy container_events_domain_insert on public.container_events
  for insert with check (public.is_container_staff());

create policy consignees_export_only on public.consignees
  for all using (public.is_export_authorized()) with check (public.is_export_authorized());

create policy container_shipping_info_export_only on public.container_shipping_info
  for all using (public.is_export_authorized()) with check (public.is_export_authorized());

create policy export_invoices_export_only on public.export_invoices
  for all using (public.is_export_authorized()) with check (public.is_export_authorized());

create policy export_invoice_line_items_export_only on public.export_invoice_line_items
  for all using (public.is_export_authorized()) with check (public.is_export_authorized());

-- export_invoice_revisions is an immutable snapshot history (see table comment) — select +
-- insert only, no update/delete.
create policy export_invoice_revisions_export_only_read on public.export_invoice_revisions
  for select using (public.is_export_authorized());
create policy export_invoice_revisions_export_only_insert on public.export_invoice_revisions
  for insert with check (public.is_export_authorized());

-- export_payments is never edited/deleted in place — a correction inserts a new row via
-- correction_of (see table comment) — select + insert only, no update/delete.
create policy export_payments_export_only_read on public.export_payments
  for select using (public.is_export_authorized());
create policy export_payments_export_only_insert on public.export_payments
  for insert with check (public.is_export_authorized());

-- --- Idempotency ledger: service-role / RPC use only, no direct client access. --------------
-- (No policy created = default-deny for all non-bypassing roles; RPCs run as SECURITY DEFINER
-- and therefore bypass RLS entirely for this table, which is the intended access path.)


-- =====================================================================================
-- End of 0001_initial_schema.sql
-- Next migration (deferred, NOT part of this file): domain RPC functions, per blueprint §13.
-- =====================================================================================
