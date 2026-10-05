-- ---------------------------------------------------------------------------------------
-- 0045 — Invitation replay safety (Module 15). ADDITIVE: one nullable column and its unique index.
-- team_invite_member (0044) uses a client request id so a retried invitation returns the same record.
-- ---------------------------------------------------------------------------------------
alter table public.user_invites add column client_request_id uuid;
create unique index user_invites_client_request_key on public.user_invites (client_request_id) where client_request_id is not null;

