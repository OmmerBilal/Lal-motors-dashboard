-- =====================================================================================
-- 0003 — Storage buckets (minimal, permission-boundary-based; NOT one bucket per screen).
--
-- ADDITIVE. Does not touch 0001 / 0002.
--
--   operational-media          Vehicle, part, dismantling, scrap, rim, container (number /
--                              loading / final list) and customer evidence. Staff who pass the
--                              domain gate in media_assets can reach it through the app.
--   confidential-export-media  Export invoices and export payment proof. Restricted to Owner,
--                              Engineer Admin and Export Manager by the same domain gate.
--
-- Access model:
--   * Both buckets are PRIVATE (public = false). No public URLs exist.
--   * storage.objects has NO policies for anon / authenticated, so a client cannot list,
--     read or write object bytes directly through the Storage API. Row-level RLS on
--     storage.objects is enabled by Supabase, so deny-by-default holds.
--   * Bytes move only through server code: the app creates a short-lived signed upload or
--     read URL AFTER the caller passes public.can_access_media() (checked through the
--     caller's own RLS session). The Storage service key never reaches the browser.
--
-- Object path convention (deterministic, collision-proof, idempotent on retry):
--   <owner_type>/<owner_id>/<client_request_id>/<variant>.<ext>
--   e.g. part/9f1c.../c3a2.../original.jpg, part/9f1c.../c3a2.../thumbnail.webp
--   media_assets.(bucket, storage_path) is unique, so a retried upload cannot create a duplicate.
--
-- Size and MIME are enforced by Storage itself as a first line of defence. The server still
-- re-checks magic bytes before generating variants.
-- =====================================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'operational-media',
    'operational-media',
    false,
    15728640, -- 15 MB per object (raw phone photos before server-side resizing)
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  ),
  (
    'confidential-export-media',
    'confidential-export-media',
    false,
    15728640,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
  )
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
