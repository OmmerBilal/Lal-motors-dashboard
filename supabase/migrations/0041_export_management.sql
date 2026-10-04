-- ---------------------------------------------------------------------------------------
-- 0041 — Container export management (Module 13). ADDITIVE and tightening only.
--
--   Access: every export table is readable by export-authorized roles only (owner, engineer admin,
--   export manager — is_export_authorized(), unchanged) and writable only through RPCs. The former
--   "for all" policies on consignees, shipping, invoices and line items are replaced by read-only ones.
--   Loaders have no path to any of these tables.
--
--   Invoices: Draft -> Review -> Finalized. Finalize assigns a server invoice number and snapshots the
--   consignee. A finalized invoice never changes; a correction is a new revision row (reason, actor,
--   time, new snapshot). The effective content is the latest revision, or the original when none.
--
--   Payments: multiple per invoice. Balance = total - sum of payments not reversed, calculated in NUMERIC
--   in the database. Overpayment is refused. A correction is a reversal row that references the original;
--   posted payment rows are never edited.
--
--   Shipping: loading -> ready_for_invoice (loader) -> on_the_way (requires finalized invoice) -> closed
--   (requires finalized invoice and zero balance). Each step is a server transition.
-- ---------------------------------------------------------------------------------------

-- 1. Columns and counters ---------------------------------------------------------------
alter table public.export_invoices add column client_request_id uuid;
create unique index export_invoices_client_request_key on public.export_invoices (client_request_id) where client_request_id is not null;
alter table public.export_invoices add column finalized_by uuid references public.profiles(id);

alter table public.export_invoice_revisions add column revision_number int;
alter table public.export_invoice_revisions add column client_request_id uuid;
create unique index export_invoice_revisions_client_request_key on public.export_invoice_revisions (client_request_id) where client_request_id is not null;
create unique index export_invoice_revisions_number_key on public.export_invoice_revisions (invoice_id, revision_number) where revision_number is not null;

alter table public.export_payments add column client_request_id uuid;
create unique index export_payments_client_request_key on public.export_payments (client_request_id) where client_request_id is not null;

alter table public.container_shipping_info add column shipping_reference text not null default '';
alter table public.container_shipping_info add column shipped_at timestamptz;

create table public.export_invoice_counters (
  year_yy  int primary key check (year_yy between 0 and 99),
  next_seq int not null check (next_seq >= 1)
);
alter table public.export_invoice_counters enable row level security;

-- 2. Access: read-only policies for clients; writes through RPCs --------------------------
drop policy if exists consignees_export_only on public.consignees;
create policy consignees_export_read on public.consignees for select using (public.is_export_authorized());

drop policy if exists container_shipping_info_export_only on public.container_shipping_info;
create policy container_shipping_info_export_read on public.container_shipping_info for select using (public.is_export_authorized());

drop policy if exists export_invoices_export_only on public.export_invoices;
create policy export_invoices_export_read on public.export_invoices for select using (public.is_export_authorized());

drop policy if exists export_invoice_line_items_export_only on public.export_invoice_line_items;
create policy export_invoice_line_items_export_read on public.export_invoice_line_items for select using (public.is_export_authorized());

drop policy if exists export_invoice_revisions_export_only_insert on public.export_invoice_revisions;

drop policy if exists export_payments_export_only_insert on public.export_payments;

-- Append-only history (revisions and payments): no UPDATE or DELETE from anyone.
create or replace function public._export_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only; record a correction or revision instead', tg_table_name using errcode = 'P0001';
end;
$$;
revoke execute on function public._export_append_only() from public, anon, authenticated;
create trigger export_invoice_revisions_append_only before update or delete on public.export_invoice_revisions
  for each row execute function public._export_append_only();
create trigger export_payments_append_only before update or delete on public.export_payments
  for each row execute function public._export_append_only();

-- 3. Helpers --------------------------------------------------------------------------------
create or replace function public._export_require()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_export_authorized() then
    raise exception 'forbidden: an export role is required' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._export_require() from public, anon, authenticated;

create or replace function public._export_next_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yy int := (extract(year from public._scrap_business_date())::int) % 100;
  v_seq int;
begin
  insert into public.export_invoice_counters (year_yy, next_seq)
  values (v_yy, coalesce((
            select max(substring(invoice_number from '^INV-' || lpad(v_yy::text, 2, '0') || '-([0-9]{4})$')::int)
              from public.export_invoices
             where invoice_number ~ ('^INV-' || lpad(v_yy::text, 2, '0') || '-[0-9]{4}$')), 0) + 1)
  on conflict (year_yy) do nothing;
  select next_seq into v_seq from public.export_invoice_counters where year_yy = v_yy for update;
  update public.export_invoice_counters set next_seq = next_seq + 1 where year_yy = v_yy;
  return 'INV-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');
end;
$$;
revoke execute on function public._export_next_invoice_number() from public, anon, authenticated;

-- Lines arrive as JSON. They are validated here before anything is written.
create or replace function public._export_check_lines(p_lines jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_bad int;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'add at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'an invoice can have at most 200 lines' using errcode = '22023';
  end if;
  select count(*) into v_bad
    from jsonb_to_recordset(p_lines) as r(description text, quantity int, unit_price numeric)
   where char_length(btrim(coalesce(r.description, ''))) = 0
      or coalesce(r.quantity, 0) <= 0
      or coalesce(r.unit_price, -1) < 0
      or r.unit_price > 999999.99;
  if v_bad > 0 then
    raise exception 'every line needs a description, a quantity above zero and a price of zero or more' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public._export_check_lines(jsonb) from public, anon, authenticated;

-- The consignee as it must be frozen on a finalized invoice.
create or replace function public._export_consignee_snapshot(p_consignee_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', c.id, 'company', c.company, 'contact', c.contact, 'address', c.address, 'city', c.city,
                            'state_province', c.state_province, 'country', c.country, 'phone', c.phone, 'email', c.email)
    from public.consignees c where c.id = p_consignee_id;
$$;
revoke execute on function public._export_consignee_snapshot(uuid) from public, anon, authenticated;

-- Effective lines and totals: the latest revision when one exists, otherwise the original lines.
create or replace function public._export_invoice_view(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  inv public.export_invoices%rowtype;
  v_rev public.export_invoice_revisions%rowtype;
  v_items jsonb;
  v_snapshot jsonb;
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_revisions int;
begin
  select * into inv from public.export_invoices where id = p_invoice_id;
  if not found then
    return null;
  end if;
  select count(*)::int into v_revisions from public.export_invoice_revisions where invoice_id = p_invoice_id;
  select * into v_rev from public.export_invoice_revisions where invoice_id = p_invoice_id order by revision_number desc nulls last, saved_at desc limit 1;
  if found then
    v_items := v_rev.items_snapshot;
    v_snapshot := v_rev.consignee_snapshot;
  else
    v_items := coalesce((select jsonb_agg(jsonb_build_object('description', li.description, 'quantity', li.quantity,
                          'unit_price', li.unit_price, 'category', li.category, 'condition', li.condition,
                          'line_total', li.line_total) order by li.created_at, li.id)
                        from public.export_invoice_line_items li where li.invoice_id = p_invoice_id), '[]'::jsonb);
    v_snapshot := inv.consignee_snapshot;
  end if;
  select coalesce(sum(round((e->>'quantity')::numeric * (e->>'unit_price')::numeric, 2)), 0)::numeric(14,2)
    into v_total from jsonb_array_elements(v_items) e;
  select coalesce(sum(p.amount), 0)::numeric(14,2) into v_paid
    from public.export_payments p
   where p.invoice_id = p_invoice_id and p.correction_of is null
     and not exists (select 1 from public.export_payments r where r.correction_of = p.id);
  return jsonb_build_object(
    'id', inv.id, 'container_id', inv.container_id, 't_ref', inv.t_ref, 'invoice_number', inv.invoice_number,
    'status', inv.status, 'finalized_at', inv.finalized_at, 'notes', inv.notes, 'currency', inv.currency,
    'consignee_id', inv.consignee_id, 'consignee', v_snapshot, 'items', v_items,
    'revision_count', v_revisions, 'total', v_total, 'paid', v_paid, 'balance', v_total - v_paid);
end;
$$;
revoke execute on function public._export_invoice_view(uuid) from public, anon, authenticated;

create or replace function public._export_container_balance(p_container_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.export_invoices where container_id = p_container_id;
  if v_id is null then
    return null;
  end if;
  return public._export_invoice_view(v_id);
end;
$$;
revoke execute on function public._export_container_balance(uuid) from public, anon, authenticated;

-- 4. Consignees (reusable master) ---------------------------------------------------------
create or replace function public.export_consignee_save(
  p_id       uuid,
  p_company  text,
  p_contact  text default '',
  p_address  text default '',
  p_city     text default '',
  p_state_province text default '',
  p_country  text default '',
  p_phone    text default '',
  p_email    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.consignees%rowtype;
begin
  perform public._export_require();
  if char_length(btrim(coalesce(p_company, ''))) < 2 then
    raise exception 'the consignee company name is required' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.consignees (company, contact, address, city, state_province, country, phone, email)
    values (btrim(p_company), btrim(coalesce(p_contact, '')), btrim(coalesce(p_address, '')), btrim(coalesce(p_city, '')),
            btrim(coalesce(p_state_province, '')), btrim(coalesce(p_country, '')), btrim(coalesce(p_phone, '')), btrim(coalesce(p_email, '')))
    returning * into v_row;
  else
    update public.consignees
       set company = btrim(p_company), contact = btrim(coalesce(p_contact, '')), address = btrim(coalesce(p_address, '')),
           city = btrim(coalesce(p_city, '')), state_province = btrim(coalesce(p_state_province, '')),
           country = btrim(coalesce(p_country, '')), phone = btrim(coalesce(p_phone, '')), email = btrim(coalesce(p_email, ''))
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'consignee not found' using errcode = '22023';
    end if;
  end if;
  perform public.write_audit_log('export.consignee.saved', 'consignee', v_row.id, 'Consignee saved: ' || v_row.company, '{}'::jsonb, null, null);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.export_consignee_list(p_search text default null, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._export_require();
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c.company)
      from (select * from public.consignees
             where p_search is null or btrim(p_search) = ''
                or company ilike '%' || btrim(p_search) || '%' or contact ilike '%' || btrim(p_search) || '%'
             order by company limit least(greatest(coalesce(p_limit, 50), 1), 100)) c
  ), '[]'::jsonb);
end;
$$;

-- 5. Shipping details for a container (1:1, export only) ---------------------------------
create or replace function public.export_container_set_shipping(
  p_container_id       uuid,
  p_consignee_id       uuid,
  p_destination_country text default '',
  p_destination_port   text default '',
  p_trucking_company   text default '',
  p_ship_date          date default null,
  p_eta                date default null,
  p_shipping_note      text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.container_jobs%rowtype;
begin
  perform public._export_require();
  select * into c from public.container_jobs where id = p_container_id for update;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  if c.status = 'closed' then
    raise exception 'this container is closed; its shipping details are final' using errcode = 'P0001';
  end if;
  if p_consignee_id is not null and not exists (select 1 from public.consignees where id = p_consignee_id) then
    raise exception 'consignee not found' using errcode = '22023';
  end if;
  insert into public.container_shipping_info (container_id, destination_country, destination_port, trucking_company,
                                              consignee_id, ship_date, eta, shipping_note)
  values (p_container_id, coalesce(p_destination_country, ''), coalesce(p_destination_port, ''), coalesce(p_trucking_company, ''),
          p_consignee_id, p_ship_date, p_eta, coalesce(p_shipping_note, ''))
  on conflict (container_id) do update
     set destination_country = excluded.destination_country, destination_port = excluded.destination_port,
         trucking_company = excluded.trucking_company, consignee_id = excluded.consignee_id,
         ship_date = excluded.ship_date, eta = excluded.eta, shipping_note = excluded.shipping_note;
  perform public._container_event(p_container_id, 'shipping_updated', 'Shipping details updated');
  return (select to_jsonb(s) from public.container_shipping_info s where s.container_id = p_container_id);
end;
$$;

-- 6. Invoices -------------------------------------------------------------------------------
create or replace function public.export_create_invoice(p_container_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.container_jobs%rowtype;
  v_id uuid;
begin
  perform public._export_require();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  select id into v_id from public.export_invoices where client_request_id = p_client_request_id;
  if v_id is not null then
    return public._export_invoice_view(v_id);  -- replay
  end if;
  select * into c from public.container_jobs where id = p_container_id for update;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  select id into v_id from public.export_invoices where container_id = p_container_id;
  if v_id is not null then
    return public._export_invoice_view(v_id);  -- one invoice per container: return the existing one
  end if;
  if c.status not in ('ready_for_invoice', 'on_the_way') then
    raise exception 'the container must finish loading before an invoice is created' using errcode = 'P0001';
  end if;
  insert into public.export_invoices (container_id, t_ref, status, client_request_id)
  values (p_container_id, c.t_ref, 'Draft', p_client_request_id)
  returning id into v_id;
  perform public._container_event(p_container_id, 'invoice_created', 'Invoice draft created');
  return public._export_invoice_view(v_id);
end;
$$;

-- Draft or Review only. Replaces the line set and the consignee in one transaction.
create or replace function public.export_save_invoice_draft(
  p_invoice_id  uuid,
  p_consignee_id uuid,
  p_notes       text,
  p_lines       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.export_invoices%rowtype;
begin
  perform public._export_require();
  select * into inv from public.export_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found' using errcode = '22023';
  end if;
  if inv.status = 'Finalized' then
    raise exception 'a finalized invoice cannot be edited; create a revision with a reason' using errcode = 'P0001';
  end if;
  if p_consignee_id is null or not exists (select 1 from public.consignees where id = p_consignee_id) then
    raise exception 'choose a consignee' using errcode = '22023';
  end if;
  perform public._export_check_lines(p_lines);
  delete from public.export_invoice_line_items where invoice_id = p_invoice_id;
  insert into public.export_invoice_line_items (invoice_id, description, quantity, unit_price, category, condition)
  select p_invoice_id, btrim(r.description), r.quantity, round(r.unit_price, 2), nullif(btrim(coalesce(r.category, '')), ''),
         nullif(btrim(coalesce(r.condition, '')), '')
    from jsonb_to_recordset(p_lines) as r(description text, quantity int, unit_price numeric, category text, condition text);
  update public.export_invoices set consignee_id = p_consignee_id, notes = coalesce(p_notes, '') where id = p_invoice_id;
  return public._export_invoice_view(p_invoice_id);
end;
$$;

create or replace function public.export_mark_invoice_review(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.export_invoices%rowtype;
begin
  perform public._export_require();
  select * into inv from public.export_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found' using errcode = '22023';
  end if;
  if inv.status = 'Review' then
    return public._export_invoice_view(p_invoice_id);  -- replay
  end if;
  if inv.status <> 'Draft' then
    raise exception 'only a draft can be sent to review' using errcode = 'P0001';
  end if;
  if inv.consignee_id is null or not exists (select 1 from public.export_invoice_line_items where invoice_id = p_invoice_id) then
    raise exception 'the invoice needs a consignee and at least one line before review' using errcode = 'P0001';
  end if;
  update public.export_invoices set status = 'Review' where id = p_invoice_id;
  return public._export_invoice_view(p_invoice_id);
end;
$$;

-- Finalize: server invoice number, consignee frozen as a snapshot. Double finalize is a replay.
create or replace function public.export_finalize_invoice(p_invoice_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.export_invoices%rowtype;
  v_snapshot jsonb;
  v_number text;
begin
  perform public._export_require();
  select * into inv from public.export_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found' using errcode = '22023';
  end if;
  if inv.status = 'Finalized' then
    return public._export_invoice_view(p_invoice_id);  -- replay
  end if;
  if inv.consignee_id is null then
    raise exception 'choose a consignee before finalizing' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.export_invoice_line_items where invoice_id = p_invoice_id) then
    raise exception 'add at least one line before finalizing' using errcode = 'P0001';
  end if;
  v_snapshot := public._export_consignee_snapshot(inv.consignee_id);
  v_number := public._export_next_invoice_number();
  update public.export_invoices
     set status = 'Finalized', invoice_number = v_number, consignee_snapshot = v_snapshot,
         finalized_at = now(), finalized_by = auth.uid()
   where id = p_invoice_id;
  perform public._container_event(inv.container_id, 'invoice_finalized', 'Invoice ' || v_number || ' finalized');
  perform public.write_audit_log('export.invoice.finalized', 'export_invoice', p_invoice_id, 'Invoice ' || v_number || ' finalized',
    jsonb_build_object('invoice_number', v_number), null, p_client_request_id);
  return public._export_invoice_view(p_invoice_id);
end;
$$;

-- A correction to a finalized invoice: a NEW revision with a reason. The original stays as it was.
create or replace function public.export_revise_invoice(
  p_invoice_id   uuid,
  p_reason       text,
  p_consignee_id uuid,
  p_lines        jsonb,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.export_invoices%rowtype;
  v_next int;
  v_items jsonb;
  v_snapshot jsonb;
  v_rev_id uuid;
begin
  perform public._export_require();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.export_invoice_revisions where client_request_id = p_client_request_id) then
    return public._export_invoice_view((select invoice_id from public.export_invoice_revisions where client_request_id = p_client_request_id));
  end if;
  select * into inv from public.export_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found' using errcode = '22023';
  end if;
  if inv.status <> 'Finalized' then
    raise exception 'only a finalized invoice gets revisions; edit the draft instead' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a revision needs a reason of at least 5 characters' using errcode = '22023';
  end if;
  if p_consignee_id is null or not exists (select 1 from public.consignees where id = p_consignee_id) then
    raise exception 'choose a consignee' using errcode = '22023';
  end if;
  perform public._export_check_lines(p_lines);
  v_items := (select jsonb_agg(jsonb_build_object(
                 'description', btrim(e->>'description'),
                 'quantity', (e->>'quantity')::int,
                 'unit_price', round((e->>'unit_price')::numeric, 2),
                 'category', nullif(btrim(coalesce(e->>'category', '')), ''),
                 'condition', nullif(btrim(coalesce(e->>'condition', '')), ''),
                 'line_total', round(((e->>'quantity')::int) * round((e->>'unit_price')::numeric, 2), 2)) order by o)
                from jsonb_array_elements(p_lines) with ordinality as t(e, o));
  v_snapshot := public._export_consignee_snapshot(p_consignee_id);
  select coalesce(max(revision_number), 0) + 1 into v_next from public.export_invoice_revisions where invoice_id = p_invoice_id;
  insert into public.export_invoice_revisions (invoice_id, saved_by, reason, items_snapshot, consignee_snapshot, revision_number, client_request_id)
  values (p_invoice_id, auth.uid(), btrim(p_reason), v_items, v_snapshot, v_next, p_client_request_id)
  returning id into v_rev_id;
  perform public.write_audit_log('export.invoice.revised', 'export_invoice', p_invoice_id,
    'Invoice ' || inv.invoice_number || ' revision ' || v_next, jsonb_build_object('revision', v_next), btrim(p_reason), p_client_request_id);
  return public._export_invoice_view(p_invoice_id);
end;
$$;

-- 7. Payments -------------------------------------------------------------------------------
create or replace function public.export_record_payment(
  p_invoice_id        uuid,
  p_amount            numeric,
  p_type              text,
  p_method            text,
  p_payment_date      date default null,
  p_reference         text default '',
  p_notes             text default '',
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.export_invoices%rowtype;
  v_view jsonb;
  v_balance numeric(14,2);
  v_row public.export_payments%rowtype;
  v_name text;
begin
  perform public._export_require();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.export_payments where client_request_id = p_client_request_id) then
    select * into v_row from public.export_payments where client_request_id = p_client_request_id;
    return to_jsonb(v_row);  -- replay
  end if;
  select * into inv from public.export_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found' using errcode = '22023';
  end if;
  if inv.status <> 'Finalized' then
    raise exception 'payments are recorded against a finalized invoice' using errcode = 'P0001';
  end if;
  if p_type not in ('Deposit', 'Additional Deposit', 'Final Payment', 'Adjustment') then
    raise exception 'unknown payment type' using errcode = '22023';
  end if;
  if p_method not in ('Wire', 'ACH', 'Check', 'Cash', 'Other') then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'the amount must be above zero, with at most two decimals' using errcode = '22023';
  end if;
  v_view := public._export_invoice_view(p_invoice_id);
  v_balance := (v_view->>'balance')::numeric;
  if p_amount > v_balance then
    raise exception 'overpayment is not allowed: the balance is %', v_balance using errcode = 'P0001';
  end if;
  select name into v_name from public.profiles where id = auth.uid();
  insert into public.export_payments (invoice_id, payment_date, amount, type, method, reference_number, notes, entered_by, client_request_id)
  values (p_invoice_id, coalesce(p_payment_date, public._scrap_business_date()), p_amount, p_type, p_method,
          coalesce(p_reference, ''), coalesce(p_notes, ''), auth.uid(), p_client_request_id)
  returning * into v_row;
  perform public._container_event(inv.container_id, 'payment_recorded', 'Payment of ' || p_amount::text || ' recorded');
  perform public.write_audit_log('export.payment.recorded', 'export_payment', v_row.id, 'Export payment recorded',
    jsonb_build_object('amount', p_amount, 'type', p_type, 'method', p_method), null, p_client_request_id);
  return to_jsonb(v_row) || jsonb_build_object('balance', (public._export_invoice_view(p_invoice_id)->>'balance'));
end;
$$;

-- Reversal: a new row that references the original. The original is never edited.
create or replace function public.export_reverse_payment(p_payment_id uuid, p_reason text, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.export_payments%rowtype;
  v_row public.export_payments%rowtype;
  v_container uuid;
begin
  perform public._export_require();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.export_payments where client_request_id = p_client_request_id) then
    select * into v_row from public.export_payments where client_request_id = p_client_request_id;
    return to_jsonb(v_row);  -- replay
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a reversal needs a reason of at least 5 characters' using errcode = '22023';
  end if;
  select * into p from public.export_payments where id = p_payment_id;
  if not found then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if p.correction_of is not null then
    raise exception 'a reversal cannot be reversed' using errcode = 'P0001';
  end if;
  -- lock the invoice so two reversals cannot both pass the check
  perform 1 from public.export_invoices where id = p.invoice_id for update;
  if exists (select 1 from public.export_payments where correction_of = p_payment_id) then
    raise exception 'this payment was already reversed' using errcode = 'P0001';
  end if;
  insert into public.export_payments (invoice_id, payment_date, amount, type, method, reference_number, notes,
                                      entered_by, correction_of, correction_reason, client_request_id)
  values (p.invoice_id, public._scrap_business_date(), p.amount, 'Adjustment', p.method, p.reference_number,
          'Reversal of a recorded payment', auth.uid(), p_payment_id, btrim(p_reason), p_client_request_id)
  returning * into v_row;
  select container_id into v_container from public.export_invoices where id = p.invoice_id;
  perform public._container_event(v_container, 'payment_reversed', 'Payment reversed');
  perform public.write_audit_log('export.payment.reversed', 'export_payment', p_payment_id, 'Export payment reversed',
    jsonb_build_object('reversal_id', v_row.id), btrim(p_reason), p_client_request_id);
  return to_jsonb(v_row) || jsonb_build_object('balance', (public._export_invoice_view(p.invoice_id)->>'balance'));
end;
$$;

-- 8. Shipping transitions and close ------------------------------------------------------
create or replace function public.export_mark_on_the_way(p_container_id uuid, p_shipping_reference text, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.container_jobs%rowtype;
  v_inv_status text;
begin
  perform public._export_require();
  select * into c from public.container_jobs where id = p_container_id for update;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  if c.status = 'on_the_way' then
    return (select to_jsonb(s) from public.container_shipping_info s where s.container_id = p_container_id);  -- replay
  end if;
  if c.status <> 'ready_for_invoice' then
    raise exception 'only a container that finished loading can go on the way' using errcode = 'P0001';
  end if;
  select status into v_inv_status from public.export_invoices where container_id = p_container_id;
  if v_inv_status is distinct from 'Finalized' then
    raise exception 'finalize the invoice before the container goes on the way' using errcode = 'P0001';
  end if;
  update public.container_jobs set status = 'on_the_way', last_update_at = now() where id = p_container_id;
  update public.container_shipping_info
     set shipping_reference = coalesce(p_shipping_reference, shipping_reference), shipped_at = now()
   where container_id = p_container_id;
  perform public._container_event(p_container_id, 'on_the_way', 'Container on the way');
  perform public.write_audit_log('export.container.on_the_way', 'container', p_container_id, 'Container on the way', '{}'::jsonb, null, p_client_request_id);
  return (select to_jsonb(s) from public.container_shipping_info s where s.container_id = p_container_id);
end;
$$;

-- Closing requires a finalized invoice and a zero balance. No override in this version.
create or replace function public.export_close_container(p_container_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.container_jobs%rowtype;
  v_view jsonb;
  v_name text;
begin
  perform public._export_require();
  select * into c from public.container_jobs where id = p_container_id for update;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  if c.status = 'closed' then
    return jsonb_build_object('id', c.id, 'status', c.status, 'closed_at', c.closed_at);  -- replay
  end if;
  if c.status <> 'on_the_way' then
    raise exception 'only a container on the way can be closed' using errcode = 'P0001';
  end if;
  v_view := public._export_container_balance(p_container_id);
  if v_view is null or v_view->>'status' <> 'Finalized' then
    raise exception 'the invoice must be finalized before closing' using errcode = 'P0001';
  end if;
  if (v_view->>'balance')::numeric <> 0 then
    raise exception 'the container cannot close with an open balance of %', v_view->>'balance' using errcode = 'P0001';
  end if;
  select name into v_name from public.profiles where id = auth.uid();
  update public.container_jobs
     set status = 'closed', closed_at = now(), closed_by = auth.uid(), last_update_at = now()
   where id = p_container_id;
  perform public._container_event(p_container_id, 'closed', 'Container closed');
  perform public.write_audit_log('export.container.closed', 'container', p_container_id, 'Container closed', '{}'::jsonb, null, p_client_request_id);
  return jsonb_build_object('id', p_container_id, 'status', 'closed', 'closed_at', now());
end;
$$;

-- 9. Management read models (export-authorized) ---------------------------------------------
create or replace function public.export_container_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._export_require();
  return jsonb_build_object(
    'all', (select count(*)::int from public.container_jobs),
    'loading', (select count(*)::int from public.container_jobs where status = 'loading'),
    'ready_for_invoice', (select count(*)::int from public.container_jobs where status = 'ready_for_invoice'),
    'on_the_way', (select count(*)::int from public.container_jobs where status = 'on_the_way'),
    'closed', (select count(*)::int from public.container_jobs where status = 'closed'));
end;
$$;

create or replace function public.export_list_containers(
  p_bucket         text default 'all',
  p_limit          int default 25,
  p_before_created timestamptz default null,
  p_before_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_rows jsonb;
  v_more boolean;
begin
  perform public._export_require();
  if p_bucket not in ('all', 'loading', 'ready_for_invoice', 'on_the_way', 'closed') then
    raise exception 'unknown list' using errcode = '22023';
  end if;
  with page as (
    select c.* from public.container_jobs c
     where (p_bucket = 'all' or c.status = p_bucket)
       and (p_before_created is null or (c.created_at, c.id) < (p_before_created, p_before_id))
     order by c.created_at desc, c.id desc
     limit v_limit + 1
  ), rows_out as (
    select p.id, p.t_ref, p.container_number, p.status, p.loading_list_confirmed, p.finished_at, p.created_at,
           s.company as consignee_company,
           i.status as invoice_status, i.invoice_number,
           v.j->>'total' as invoice_total, v.j->>'balance' as balance, v.j->>'paid' as paid,
           si.ship_date, si.shipping_reference
      from page p
      left join public.export_invoices i on i.container_id = p.id
      left join lateral (select case when i.id is null then null else public._export_invoice_view(i.id) end as j) v on true
      left join public.container_shipping_info si on si.container_id = p.id
      left join public.consignees s on s.id = si.consignee_id
  ), numbered as (
    select r.*, row_number() over (order by r.created_at desc, r.id desc) as rn from rows_out r
  )
  select coalesce(jsonb_agg((to_jsonb(n) - 'rn') order by n.created_at desc, n.id desc) filter (where n.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(n.rn > v_limit), false)
    into v_rows, v_more
    from numbered n;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more);
end;
$$;

create or replace function public.export_get_container(p_container_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.container_jobs%rowtype;
begin
  perform public._export_require();
  select * into c from public.container_jobs where id = p_container_id;
  if not found then
    raise exception 'container not found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'container', jsonb_build_object('id', c.id, 't_ref', c.t_ref, 'container_number', c.container_number, 'status', c.status,
                  'number_confirmed', c.number_confirmed, 'started_at', c.started_at, 'finished_at', c.finished_at,
                  'loading_list_confirmed', c.loading_list_confirmed, 'closed_at', c.closed_at, 'closed_by', c.closed_by,
                  'close_override_reason', c.close_override_reason, 'created_at', c.created_at),
    'shipping', (select to_jsonb(s) from public.container_shipping_info s where s.container_id = p_container_id),
    'consignee', (select to_jsonb(x) from public.consignees x join public.container_shipping_info s on s.consignee_id = x.id where s.container_id = p_container_id),
    'invoice', (select public._export_invoice_view(i.id) from public.export_invoices i where i.container_id = p_container_id),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('revision_number', r.revision_number, 'reason', r.reason,
                             'saved_at', r.saved_at, 'saved_by', r.saved_by) order by r.revision_number)
                             from public.export_invoice_revisions r join public.export_invoices i on i.id = r.invoice_id
                            where i.container_id = p_container_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'payment_date', p.payment_date, 'amount', p.amount,
                             'type', p.type, 'method', p.method, 'reference_number', p.reference_number,
                             'correction_of', p.correction_of, 'correction_reason', p.correction_reason,
                             'reversed', exists (select 1 from public.export_payments r where r.correction_of = p.id),
                             'created_at', p.created_at) order by p.created_at)
                            from public.export_payments p join public.export_invoices i on i.id = p.invoice_id
                           where i.container_id = p_container_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor_name', e.actor_name, 'note', e.note, 'created_at', e.created_at) order by e.created_at desc)
                          from (select * from public.container_events where container_id = p_container_id order by created_at desc limit 100) e), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'created_at', m.created_at) order by m.created_at)
                          from public.media_assets m where m.owner_type = 'container' and m.owner_id = p_container_id
                           and m.variant = 'original' and m.status = 'ready'), '[]'::jsonb)
  );
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'export_consignee_save(uuid,text,text,text,text,text,text,text,text)', 'export_consignee_list(text,int)',
    'export_container_set_shipping(uuid,uuid,text,text,text,date,date,text)',
    'export_create_invoice(uuid,uuid)', 'export_save_invoice_draft(uuid,uuid,text,jsonb)',
    'export_mark_invoice_review(uuid)', 'export_finalize_invoice(uuid,uuid)',
    'export_revise_invoice(uuid,text,uuid,jsonb,uuid)', 'export_record_payment(uuid,numeric,text,text,date,text,text,uuid)',
    'export_reverse_payment(uuid,text,uuid)', 'export_mark_on_the_way(uuid,text,uuid)', 'export_close_container(uuid,uuid)',
    'export_container_counts()', 'export_list_containers(text,int,timestamptz,uuid)', 'export_get_container(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
