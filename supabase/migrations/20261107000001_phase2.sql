-- Phase 2 — trust & speed multipliers (DECISIONS D-039..)

-- New pipeline run kinds
alter type public.grading_run_kind add value if not exists 'mini_lesson';

-- ---------------------------------------------------------------------------
-- Grading mode: "now" (default) or "overnight" (Message Batches, ~50% cheaper)
-- ---------------------------------------------------------------------------
alter table public.assignments
  add column grading_mode text not null default 'now' check (grading_mode in ('now', 'overnight'));

alter table public.submissions drop constraint if exists submissions_processing_stage_check;
alter table public.submissions
  add constraint submissions_processing_stage_check
  check (processing_stage in ('queued', 'reading', 'scheduled', 'grading', 'checking', 'ready', 'failed'));

-- Review instrumentation (§11 Phase 2 acceptance: median review time for green items)
alter table public.submissions
  add column review_seconds int check (review_seconds >= 0),
  add column blind_check boolean not null default false;

-- Blind-check opt-in rate per teacher (0 = off), §3.4
alter table public.teachers
  add column blind_check_pct int not null default 0 check (blind_check_pct between 0 and 50);
grant update (blind_check_pct) on public.teachers to authenticated;

-- ---------------------------------------------------------------------------
-- Scanner PDF imports (§3.2): uploaded by the teacher, split by the pipeline
-- ---------------------------------------------------------------------------
create table public.pdf_imports (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  storage_path text not null,
  pages_per_student int not null default 1 check (pages_per_student between 1 and 20),
  status text not null default 'uploaded' check (status in ('uploaded', 'splitting', 'done', 'failed')),
  page_count int,
  submissions_created int,
  matched_by_qr int,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pdf_imports_assignment_idx on public.pdf_imports (assignment_id);
alter table public.pdf_imports enable row level security;
create policy pdf_imports_select on public.pdf_imports for select to authenticated
  using (public.can_access_assignment(assignment_id));
create policy pdf_imports_insert on public.pdf_imports for insert to authenticated
  with check (teacher_id = (select auth.uid()) and public.can_access_assignment(assignment_id)
              and storage_path like ((select auth.uid())::text || '/%'));
create trigger set_updated_at before update on public.pdf_imports
  for each row execute function public.set_updated_at();
grant select, insert on public.pdf_imports to authenticated;

-- ---------------------------------------------------------------------------
-- Blind checks (§3.4): teacher grades before seeing the AI; feeds "AI agreement"
-- ---------------------------------------------------------------------------
create table public.blind_checks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  items jsonb not null,            -- [{item_key, teacher, ai, max, exact, within}]
  n_items int not null,
  exact_rate numeric not null,
  within_rate numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index blind_checks_teacher_idx on public.blind_checks (teacher_id, created_at desc);
alter table public.blind_checks enable row level security;
create policy blind_checks_select on public.blind_checks for select to authenticated
  using (teacher_id = (select auth.uid()));
create policy blind_checks_insert on public.blind_checks for insert to authenticated
  with check (teacher_id = (select auth.uid()) and public.can_access_submission(submission_id));
create trigger set_updated_at before update on public.blind_checks
  for each row execute function public.set_updated_at();
grant select, insert on public.blind_checks to authenticated;

-- ---------------------------------------------------------------------------
-- Mini-lessons generated from misconception clusters (§3.6)
-- ---------------------------------------------------------------------------
create table public.mini_lessons (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  misconception_tag text not null,
  locale public.app_locale not null,
  lesson jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, misconception_tag, locale)
);
alter table public.mini_lessons enable row level security;
create policy mini_lessons_all on public.mini_lessons for all to authenticated
  using (public.can_access_assignment(assignment_id)) with check (public.can_access_assignment(assignment_id));
create trigger set_updated_at before update on public.mini_lessons
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on public.mini_lessons to authenticated;

-- ---------------------------------------------------------------------------
-- Overnight batches (service role only — no teacher policies)
-- ---------------------------------------------------------------------------
create table public.grading_batches (
  id uuid primary key default gen_random_uuid(),
  phase text not null check (phase in ('transcribe', 'grade', 'verify')),
  provider_batch_id text,
  submission_ids uuid[] not null,
  status text not null default 'created' check (status in ('created', 'submitted', 'ended', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.grading_batches enable row level security;
create trigger set_updated_at before update on public.grading_batches
  for each row execute function public.set_updated_at();
revoke all on public.grading_batches from authenticated;

-- ---------------------------------------------------------------------------
-- Comment bank: dedupe by normalised text, remember where a comment came from
-- ---------------------------------------------------------------------------
alter table public.comment_bank
  add column text_key text generated always as (lower(btrim(text))) stored,
  add column source text not null default 'teacher' check (source in ('teacher', 'ai_approved')),
  add column last_used_at timestamptz;
create unique index comment_bank_teacher_text_uniq on public.comment_bank (teacher_id, locale, text_key);

-- Exemplars: one per submission; clusters: one per normalised answer
create unique index exemplars_submission_uniq on public.exemplars (submission_id);
create unique index answer_clusters_answer_uniq on public.answer_clusters (assignment_id, question_id, normalised_answer);

-- Style profile: the teacher may read and reset (delete) their own profile; the pipeline writes it.
create policy style_profiles_delete on public.style_profiles for delete to authenticated
  using (teacher_id = (select auth.uid()));
grant delete on public.style_profiles to authenticated;
create index style_profiles_teacher_idx on public.style_profiles (teacher_id, version desc);
