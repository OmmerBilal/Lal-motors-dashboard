-- ---------------------------------------------------------------------------------------
-- 0048 — AI Command Center (Module 16). ADDITIVE.
--
-- The model never writes. Every important write is a PROPOSAL row (ai_action_requests) that a person approves.
-- The approval step revalidates the current state, then the server calls the existing business RPC. The model
-- cannot reach any table directly: clients have read access to their own requests only, and no direct writes.
--
-- Also here: the analysis cache (SHA-256 of the compressed image, so identical unchanged images are not
-- analysed twice) and the audit trail for every AI step, written through write_audit_log.
-- ---------------------------------------------------------------------------------------

create table public.ai_action_requests (
  id                 uuid primary key default gen_random_uuid(),
  actor_id           uuid not null references public.profiles(id),
  tool               text not null,
  arguments          jsonb not null default '{}'::jsonb,
  target_summary     text not null default '',
  fingerprint        text not null,
  preview            jsonb not null default '{}'::jsonb,
  status             text not null default 'proposed'
                     check (status in ('proposed', 'approved', 'executed', 'failed', 'rejected', 'stale')),
  result             jsonb,
  error_category     text,
  client_request_id  uuid,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,
  executed_at        timestamptz
);
create unique index ai_action_requests_client_key on public.ai_action_requests (client_request_id) where client_request_id is not null;
create index ai_action_requests_actor_idx on public.ai_action_requests (actor_id, created_at desc);
alter table public.ai_action_requests enable row level security;
create policy ai_action_requests_own_read on public.ai_action_requests
  for select using (actor_id = auth.uid() or public.has_any_role('owner', 'engineer_admin'));

create table public.ai_analysis_cache (
  purpose     text not null,
  sha256      text not null,
  model       text not null,
  result      jsonb not null,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  primary key (purpose, sha256)
);
alter table public.ai_analysis_cache enable row level security;  -- RPC use only

-- Roles allowed to open the command center at all. Each tool narrows this further in the server registry.
create or replace function public._ai_require_command_role()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.has_any_role('owner', 'engineer_admin', 'manager', 'export_manager') then
    raise exception 'forbidden: the AI command center is for management roles' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._ai_require_command_role() from public, anon, authenticated;

create or replace function public.ai_caller_roles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(r.key order by r.key), '{}'::text[])
    from public.user_roles ur join public.roles r on r.id = ur.role_id
   where ur.user_id = auth.uid();
$$;

-- Proposal: records what the model/user asked for. No business change happens here.
create or replace function public.ai_propose_action(
  p_tool              text,
  p_arguments         jsonb,
  p_target_summary    text,
  p_fingerprint       text,
  p_preview           jsonb,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._ai_require_command_role();
  if p_client_request_id is null then
    raise exception 'a request id is required' using errcode = '22023';
  end if;
  select id into v_id from public.ai_action_requests where client_request_id = p_client_request_id;
  if v_id is null then
    insert into public.ai_action_requests (actor_id, tool, arguments, target_summary, fingerprint, preview, client_request_id)
    values (auth.uid(), p_tool, coalesce(p_arguments, '{}'::jsonb), coalesce(p_target_summary, ''), p_fingerprint,
            coalesce(p_preview, '{}'::jsonb), p_client_request_id)
    returning id into v_id;
    perform public.write_audit_log('ai.action.proposed', 'ai_action', v_id, 'AI proposed ' || p_tool,
      jsonb_build_object('tool', p_tool, 'target', p_target_summary), null, p_client_request_id);
  end if;
  return (select to_jsonb(r) from public.ai_action_requests r where r.id = v_id);
end;
$$;

-- Decision: only the person who proposed the action may approve or reject it. Approval moves it to 'approved';
-- execution (and its revalidation) happens in the server route, which then calls record_result.
create or replace function public.ai_decide_action(p_request uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ai_action_requests%rowtype;
begin
  perform public._ai_require_command_role();
  if p_decision not in ('approve', 'reject') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  select * into r from public.ai_action_requests where id = p_request for update;
  if not found or r.actor_id <> auth.uid() then
    raise exception 'request not found' using errcode = '22023';
  end if;
  if r.status <> 'proposed' then
    return to_jsonb(r);  -- already decided: replay, nothing changes
  end if;
  update public.ai_action_requests
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end, decided_at = now()
   where id = p_request
  returning * into r;
  perform public.write_audit_log('ai.action.' || p_decision || 'd', 'ai_action', p_request,
    'AI action ' || p_decision || 'd: ' || r.tool, jsonb_build_object('tool', r.tool), null, null);
  return to_jsonb(r);
end;
$$;

-- Result after the server executed (or refused) an approved action. Only from an approved row.
create or replace function public.ai_record_result(p_request uuid, p_status text, p_result jsonb, p_error_category text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ai_action_requests%rowtype;
begin
  perform public._ai_require_command_role();
  if p_status not in ('executed', 'failed', 'stale') then
    raise exception 'unknown result status' using errcode = '22023';
  end if;
  select * into r from public.ai_action_requests where id = p_request for update;
  if not found or r.actor_id <> auth.uid() then
    raise exception 'request not found' using errcode = '22023';
  end if;
  if r.status <> 'approved' then
    raise exception 'only an approved action has a result' using errcode = 'P0001';
  end if;
  update public.ai_action_requests
     set status = p_status, result = p_result, error_category = p_error_category,
         executed_at = case when p_status = 'executed' then now() else null end
   where id = p_request
  returning * into r;
  perform public.write_audit_log('ai.action.' || p_status, 'ai_action', p_request,
    'AI action ' || p_status || ': ' || r.tool, jsonb_build_object('tool', r.tool, 'error', p_error_category), null, null);
  return to_jsonb(r);
end;
$$;

create or replace function public.ai_list_my_requests(p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._ai_require_command_role();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select id, tool, target_summary, status, error_category, created_at, decided_at, executed_at
              from public.ai_action_requests where actor_id = auth.uid()
             order by created_at desc limit least(greatest(coalesce(p_limit, 25), 1), 50)) x
  ), '[]'::jsonb);
end;
$$;

-- Analysis cache: keyed by purpose and the SHA-256 of the compressed image. Identical unchanged images reuse it.
create or replace function public.ai_cache_get(p_purpose text, p_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._ai_require_command_role();
  return (select jsonb_build_object('result', c.result, 'model', c.model, 'created_at', c.created_at)
            from public.ai_analysis_cache c where c.purpose = p_purpose and c.sha256 = p_sha256);
end;
$$;

create or replace function public.ai_cache_put(p_purpose text, p_sha256 text, p_model text, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._ai_require_command_role();
  insert into public.ai_analysis_cache (purpose, sha256, model, result, created_by)
  values (p_purpose, p_sha256, p_model, p_result, auth.uid())
  on conflict (purpose, sha256) do nothing;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'ai_caller_roles()', 'ai_propose_action(text,jsonb,text,text,jsonb,uuid)', 'ai_decide_action(uuid,text)',
    'ai_record_result(uuid,text,jsonb,text)', 'ai_list_my_requests(int)', 'ai_cache_get(text,text)', 'ai_cache_put(text,text,text,jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
