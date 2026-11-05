-- Private storage buckets (§7, §9). Paths are namespaced
-- `{teacher_id}/{assignment_id}/...`; the first path segment must be the
-- caller's own user id. Downloads go through short-lived signed URLs
-- (≤ 10 minutes) generated server-side.

insert into storage.buckets (id, name, public)
values
  ('pages-original', 'pages-original', false),
  ('pages-redacted', 'pages-redacted', false),
  ('exports', 'exports', false)
on conflict (id) do update set public = false;

create policy "tinta: teachers read own objects"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('pages-original', 'pages-redacted', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "tinta: teachers upload own originals"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pages-original'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "tinta: teachers delete own objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('pages-original', 'pages-redacted', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
-- pages-redacted and exports are written only by the pipeline (service role).
