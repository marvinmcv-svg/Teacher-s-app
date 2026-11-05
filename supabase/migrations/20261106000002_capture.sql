-- Capture: idempotent submission creation from the offline queue (§3.2)
alter table public.submissions add column client_ref text;
create unique index submissions_client_ref_uniq on public.submissions (assignment_id, client_ref) where client_ref is not null;

-- Allow the uploader to see whether a page object already exists (resume) — select policy exists;
-- re-uploads use upsert=false and treat "already exists" as success.
