-- =====================================================================================
-- 0024 — Customers: normalized create/update with duplicate hints, lightweight keyset list,
--        and history on demand.
--
-- ADDITIVE. 0001–0023 are not edited.
--
-- Rules:
--   * Sales staff only (owner, engineer_admin, manager). Enforced inside each function.
--   * Phone is normalized in the DATABASE (digits only, a leading country 1 removed), so every
--     client stores the same value. Email is lower-cased.
--   * Obvious duplicates (same normalized phone, or same email) are REPORTED, not merged.
--     A create or update that would duplicate someone returns possible_duplicate with the
--     matches and writes nothing, until the caller confirms with confirm_new = true.
--   * The list DTO is small. It never includes sales, payments or balances.
--   * History and balance are loaded for one customer on demand.
-- =====================================================================================

alter table public.customers add column if not exists client_request_id uuid;
create unique index if not exists customers_client_request_key
  on public.customers (client_request_id) where client_request_id is not null;

-- ---------------------------------------------------------------------------------------
-- 1. Normalization helpers
-- ---------------------------------------------------------------------------------------
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when length(d) = 11 and left(d, 1) = '1' then substr(d, 2)
    else d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x;
$$;

create or replace function public._customer_name_text(p_first text, p_last text, p_company text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(concat_ws(' ', nullif(btrim(coalesce(p_first, '')), ''), nullif(btrim(coalesce(p_last, '')), '')) ||
         case when nullif(btrim(coalesce(p_company, '')), '') is not null then ' (' || btrim(p_company) || ')' else '' end);
$$;

-- ---------------------------------------------------------------------------------------
-- 2. Duplicate matches (read-only)
-- ---------------------------------------------------------------------------------------
create or replace function public._customer_matches(p_phone_norm text, p_email text, p_exclude uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'name', public._customer_name_text(c.first_name, c.last_name, c.company_name),
           'phone', c.phone_normalized,
           'email', c.email)), '[]'::jsonb)
    from public.customers c
   where (p_exclude is null or c.id <> p_exclude)
     and (
       (p_phone_norm <> '' and c.phone_normalized = p_phone_norm)
       or (nullif(lower(btrim(coalesce(p_email, ''))), '') is not null and lower(c.email) = lower(btrim(p_email)))
     );
$$;

-- ---------------------------------------------------------------------------------------
-- 3. create_customer
-- ---------------------------------------------------------------------------------------
create or replace function public.create_customer(p_data jsonb, p_client_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := btrim(coalesce(p_data->>'first_name', ''));
  v_last text := btrim(coalesce(p_data->>'last_name', ''));
  v_company text := btrim(coalesce(p_data->>'company_name', ''));
  v_phone text := btrim(coalesce(p_data->>'phone', ''));
  v_phone_norm text := public.normalize_phone(p_data->>'phone');
  v_email text := lower(btrim(coalesce(p_data->>'email', '')));
  v_type text := coalesce(nullif(p_data->>'customer_type', ''), 'retail');
  v_tax text := coalesce(nullif(p_data->>'tax_status', ''), 'taxable');
  v_existing public.customers%rowtype;
  v_row public.customers%rowtype;
  v_matches jsonb;
begin
  perform public._rpc_require_sales_staff();

  if p_client_request_id is not null then
    select * into v_existing from public.customers where client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('outcome', 'created', 'customer_id', v_existing.id, 'idempotent_replay', true);
    end if;
  end if;

  if v_first = '' and v_last = '' and v_company = '' then
    raise exception 'enter a first name, last name or company name' using errcode = '22023';
  end if;
  if v_phone_norm = '' or length(v_phone_norm) < 7 or length(v_phone_norm) > 15 then
    raise exception 'enter a valid phone number' using errcode = '22023';
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;
  if v_type not in ('retail', 'wholesale', 'business') then
    raise exception 'unknown customer type' using errcode = '22023';
  end if;
  if v_tax not in ('taxable', 'exempt') then
    raise exception 'unknown tax status' using errcode = '22023';
  end if;

  v_matches := public._customer_matches(v_phone_norm, v_email, null);
  if jsonb_array_length(v_matches) > 0 and coalesce((p_data->>'confirm_new')::boolean, false) = false then
    return jsonb_build_object('outcome', 'possible_duplicate', 'matches', v_matches);
  end if;

  insert into public.customers (first_name, last_name, company_name, phone, phone_normalized, email,
                                customer_type, tax_status, billing_address, shipping_address, notes,
                                created_by, updated_by, client_request_id)
  values (v_first, v_last, v_company, v_phone, v_phone_norm, v_email, v_type, v_tax,
          coalesce(p_data->>'billing_address', ''), coalesce(p_data->>'shipping_address', ''), coalesce(p_data->>'notes', ''),
          auth.uid(), auth.uid(), p_client_request_id)
  returning * into v_row;

  perform public.write_audit_log('customer.create', 'customer', v_row.id,
    'Customer created: ' || public._customer_name_text(v_row.first_name, v_row.last_name, v_row.company_name),
    jsonb_build_object('phone', v_phone_norm, 'confirmed_duplicate_check', jsonb_array_length(v_matches) > 0), null, p_client_request_id);

  return jsonb_build_object('outcome', 'created', 'customer_id', v_row.id, 'idempotent_replay', false);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 4. update_customer
-- ---------------------------------------------------------------------------------------
create or replace function public.update_customer(p_customer_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customers%rowtype;
  v_phone_norm text;
  v_email text;
  v_matches jsonb;
begin
  perform public._rpc_require_sales_staff();

  select * into v_row from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'customer not found' using errcode = '22023';
  end if;

  v_phone_norm := case when p_data ? 'phone' then public.normalize_phone(p_data->>'phone') else v_row.phone_normalized end;
  v_email := case when p_data ? 'email' then lower(btrim(coalesce(p_data->>'email', ''))) else v_row.email end;
  if v_phone_norm = '' or length(v_phone_norm) < 7 or length(v_phone_norm) > 15 then
    raise exception 'enter a valid phone number' using errcode = '22023';
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;

  v_matches := public._customer_matches(v_phone_norm, v_email, p_customer_id);
  if jsonb_array_length(v_matches) > 0 and coalesce((p_data->>'confirm_new')::boolean, false) = false then
    return jsonb_build_object('outcome', 'possible_duplicate', 'matches', v_matches);
  end if;

  update public.customers
     set first_name = case when p_data ? 'first_name' then btrim(p_data->>'first_name') else first_name end,
         last_name = case when p_data ? 'last_name' then btrim(p_data->>'last_name') else last_name end,
         company_name = case when p_data ? 'company_name' then btrim(p_data->>'company_name') else company_name end,
         phone = case when p_data ? 'phone' then btrim(p_data->>'phone') else phone end,
         phone_normalized = v_phone_norm,
         email = v_email,
         billing_address = case when p_data ? 'billing_address' then p_data->>'billing_address' else billing_address end,
         shipping_address = case when p_data ? 'shipping_address' then p_data->>'shipping_address' else shipping_address end,
         notes = case when p_data ? 'notes' then p_data->>'notes' else notes end,
         updated_by = auth.uid()
   where id = p_customer_id
   returning * into v_row;

  perform public.write_audit_log('customer.update', 'customer', p_customer_id,
    'Customer details updated', jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_data) k)), null, null);

  return jsonb_build_object('outcome', 'updated', 'customer_id', v_row.id);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. list_customers — keyset on (last name, first name, id). Lightweight DTO only.
-- ---------------------------------------------------------------------------------------
create or replace function public.list_customers(
  p_search text default null,
  p_limit int default 25,
  p_cursor_last text default null,
  p_cursor_first text default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid, customer_number text, display_name text, phone text, email text,
  customer_type text, tax_status text, has_more boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_digits text := public.normalize_phone(p_search);
  v_q text := btrim(coalesce(p_search, ''));
begin
  perform public._rpc_require_sales_staff();
  return query
  with page as (
    select c.*
      from public.customers c
     where (v_q = '' or
            (v_digits <> '' and c.phone_normalized like v_digits || '%') or
            c.last_name ilike '%' || v_q || '%' or
            c.first_name ilike '%' || v_q || '%' or
            c.company_name ilike '%' || v_q || '%' or
            c.email ilike '%' || v_q || '%' or
            c.customer_number ilike '%' || v_q || '%')
       and (p_cursor_last is null or (c.last_name, c.first_name, c.id) > (p_cursor_last, p_cursor_first, p_cursor_id))
     order by c.last_name, c.first_name, c.id
     limit v_limit + 1
  ),
  numbered as (select page.*, row_number() over (order by page.last_name, page.first_name, page.id) as rn from page)
  select n.id, n.customer_number,
         public._customer_name_text(n.first_name, n.last_name, n.company_name),
         n.phone_normalized, n.email, n.customer_type, n.tax_status,
         exists (select 1 from numbered x where x.rn = v_limit + 1)
    from numbered n
   where n.rn <= v_limit
   order by n.last_name, n.first_name, n.id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 6. customer_history — detail only: sales, payments and the balance owed, for one customer.
-- ---------------------------------------------------------------------------------------
create or replace function public.customer_history(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales jsonb;
  v_payments jsonb;
  v_balance numeric;
begin
  perform public._rpc_require_sales_staff();
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer not found' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(s order by s.created_at desc), '[]'::jsonb) into v_sales
    from (select sa.id, sa.sale_number, sa.total, sa.amount_paid, sa.balance_due, sa.payment_status,
                 sa.status, sa.fulfillment_status, sa.created_at
            from public.sales sa where sa.customer_id = p_customer_id
           order by sa.created_at desc limit 50) s;

  select coalesce(jsonb_agg(p order by p.created_at desc), '[]'::jsonb) into v_payments
    from (select pm.id, pm.amount, pm.method, pm.status, pm.created_at, pm.posted_at
            from public.payments pm where pm.customer_id = p_customer_id
           order by pm.created_at desc limit 50) p;

  select coalesce(sum(sa.balance_due) filter (where sa.status <> 'CANCELLED'), 0) into v_balance
    from public.sales sa where sa.customer_id = p_customer_id;

  return jsonb_build_object('balance_due', v_balance, 'sales', v_sales, 'payments', v_payments);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------------------
revoke execute on function public._customer_matches(text, text, uuid) from public, anon, authenticated;
revoke execute on function public._customer_name_text(text, text, text) from public, anon;
grant execute on function public._customer_name_text(text, text, text) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.normalize_phone(text)',
    'public.create_customer(jsonb, uuid)',
    'public.update_customer(uuid, jsonb)',
    'public.list_customers(text, int, text, text, uuid)',
    'public.customer_history(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
