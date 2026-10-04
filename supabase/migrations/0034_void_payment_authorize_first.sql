-- ---------------------------------------------------------------------------------------
-- 0034 — void_payment: authorize BEFORE the idempotent-retry return.
--
-- Defect (found by the browser E2E security step): void_payment returned the payment row for an
-- already-voided payment before any role check. A caller with no sales role (receiving, dismantling,
-- scrap driver, container loader, warehouse employee) therefore received the payment's data and a
-- success response. No state changed, but the read was not authorized.
--
-- Fix: sales staff are required first, for every caller and every state. Posted payments still
-- require owner / engineer admin, as before. The retry return is unchanged for authorized callers.
-- ---------------------------------------------------------------------------------------

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_alloc record;
  v_sale public.sales%rowtype;
  v_new_paid numeric;
  v_summaries jsonb := '[]'::jsonb;
begin
  perform public._rpc_require_sales_staff();

  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a reason of at least 5 characters is required' using errcode = '22023';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if v_pay.status = 'void' then
    return public._payment_json(v_pay);  -- idempotent retry, after authorization
  end if;

  if v_pay.status = 'posted' then
    perform public._rpc_require_admin();
  end if;

  if v_pay.status = 'posted' then
    for v_alloc in
      select pa.sale_id, pa.amount from public.payment_allocations pa
       where pa.payment_id = p_payment_id order by pa.sale_id
    loop
      select * into v_sale from public.sales where id = v_alloc.sale_id for update;
      v_new_paid := v_sale.amount_paid - v_alloc.amount;
      if v_new_paid < 0 then
        raise exception 'reversal would make sale % paid amount negative; inconsistent ledger', v_sale.id using errcode = 'P0001';
      end if;
      update public.sales
         set amount_paid = v_new_paid,
             balance_due = v_sale.total - v_new_paid,
             payment_status = public._payment_status_for(v_sale.total, v_new_paid)
       where id = v_sale.id;
      v_summaries := v_summaries || jsonb_build_object('sale_id', v_sale.id, 'amount_paid', v_new_paid);
    end loop;
  end if;

  update public.payments
     set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_payment_id
   returning * into v_pay;

  perform public.write_audit_log(
    'payment.void', 'payment', p_payment_id, 'Payment voided',
    jsonb_build_object('previously_posted', v_summaries <> '[]'::jsonb, 'sales', v_summaries),
    btrim(p_reason), null);

  return public._payment_json(v_pay);
end;
$$;

revoke execute on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, text) to authenticated;
