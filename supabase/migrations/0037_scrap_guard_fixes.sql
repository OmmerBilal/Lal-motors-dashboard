-- ---------------------------------------------------------------------------------------
-- 0037 — Scrap: two guards found in review of 0036. ADDITIVE: replaces two functions, adds nothing else.
--
--   1. scrap_manager_correct_financials is a CORRECTION. It applies only to approved or closed loads,
--      or to loads whose day is already closed. Before that, the measurement RPC is the way to record
--      values, so a correction cannot quietly replace a pending load's weight.
--   2. scrap_driver_create_load refuses a new load once today's business day is closed. A closed day
--      cannot gain loads (the close is a frozen snapshot).
-- ---------------------------------------------------------------------------------------

create or replace function public.scrap_manager_correct_financials(
  p_load_id         uuid,
  p_weight          numeric,
  p_rate            numeric,
  p_amount_override numeric default null,
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.scrap_loads%rowtype;
  f public.scrap_load_financials%rowtype;
  v_amount numeric(10,2);
begin
  perform public._scrap_require_office();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a correction needs a reason of at least 5 characters' using errcode = '22023';
  end if;
  select * into l from public.scrap_loads where id = p_load_id for update;
  if not found then
    raise exception 'load not found' using errcode = '22023';
  end if;
  if l.status not in ('approved', 'closed') and not public._scrap_day_closed(l.load_date) then
    raise exception 'record the measurement first; corrections apply to approved or closed loads' using errcode = 'P0001';
  end if;
  select * into f from public.scrap_load_financials where scrap_load_id = p_load_id for update;
  if f.payment_id is not null then
    raise exception 'this load is linked to a payment; correct the payment first' using errcode = 'P0001';
  end if;
  if p_weight is not null and p_rate is not null then
    if p_weight <= 0 or p_rate <= 0 then
      raise exception 'weight and rate must be greater than zero' using errcode = '22023';
    end if;
    v_amount := round(p_weight * p_rate, 2);
  elsif p_amount_override is not null and p_amount_override >= 0 then
    v_amount := round(p_amount_override, 2);
  else
    raise exception 'enter weight and rate, or an amount' using errcode = '22023';
  end if;

  update public.scrap_load_financials
     set weight = p_weight, rate = p_rate, amount = v_amount,
         amount_override_reason = case when p_weight is null or p_rate is null then btrim(p_reason) else null end,
         measured_by = auth.uid(), measured_at = now()
   where scrap_load_id = p_load_id;
  perform public._scrap_record_event(p_load_id, 'financials_corrected', l.status, l.status,
    jsonb_build_object('old_weight', f.weight, 'new_weight', p_weight, 'old_rate', f.rate, 'new_rate', p_rate,
                       'old_amount', f.amount, 'new_amount', v_amount),
    'Financial record corrected', btrim(p_reason));
  return public._scrap_manager_load_json(p_load_id);
end;
$$;

create or replace function public.scrap_driver_create_load(p_client_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_owner uuid;
begin
  perform public._scrap_require_driver();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;

  -- Replay: the same request returns the same load. Another driver's request id is refused.
  select id, driver_id into v_id, v_owner from public.scrap_loads where client_request_id = p_client_request_id;
  if v_id is not null then
    if v_owner <> auth.uid() then
      raise exception 'invalid request' using errcode = '22023';
    end if;
    return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = v_id);
  end if;

  if public._scrap_day_closed(public._scrap_business_date()) then
    raise exception 'today is closed; new loads start on the next business day' using errcode = 'P0001';
  end if;

  insert into public.scrap_loads (driver_id, load_date, status, client_request_id)
  values (auth.uid(), public._scrap_business_date(), 'new', p_client_request_id)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    -- A concurrent retry inserted it first.
    select id into v_id from public.scrap_loads where client_request_id = p_client_request_id;
    return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = v_id);
  end if;

  perform public._scrap_record_event(v_id, 'load_created', null, 'new', '{}'::jsonb, 'Scrap load created');
  return (select to_jsonb(v) from public.scrap_loads_driver_v v where v.id = v_id);
end;
$$;
