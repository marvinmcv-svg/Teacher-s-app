-- Phase 1 additions (DECISIONS D-020..D-026)

-- Assignments: snapshot of rubric criteria (grading uses a frozen copy so a
-- template edit can't change an in-flight batch) + feedback language.
alter table public.assignments
  add column criteria jsonb not null default '[]',
  add column feedback_locale public.app_locale not null default 'es',
  add column review_sample_pct int not null default 10 check (review_sample_pct between 0 and 100);

-- Submissions: honest progress (queued → reading → grading → checking → ready),
-- name-reading suggestion (teacher confirms), review interaction.
alter table public.submissions
  add column processing_stage text check (processing_stage in ('queued','reading','grading','checking','ready','failed')),
  add column error_code text,
  add column suggested_student_id uuid references public.students (id) on delete set null,
  add column name_match_confidence numeric,
  add column total_score numeric,
  add column total_max numeric,
  add column opened_at timestamptz,
  add column graded_at timestamptz;

create index submissions_review_idx on public.submissions (assignment_id, status, confidence);

alter table public.pages
  add column quality_override boolean not null default false;

-- Items are addressed as "q3" / criterion key across AI output, scores and pins.
alter table public.criterion_scores
  add column item_key text,
  add column acknowledged_at timestamptz,   -- teacher interacted with a red/orange item (§3.4)
  add column teacher_rationale text;
create unique index criterion_scores_submission_item_uniq on public.criterion_scores (submission_id, item_key);

alter table public.annotations
  add column item_key text,
  add column position int;                 -- reading order number on the pin

-- One feedback row per submission
create unique index feedback_submission_uniq on public.feedback (submission_id);

-- Releases are created only for approved submissions
create or replace function public.releases_require_approved()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.submissions s
    where s.id = new.submission_id and s.status in ('approved', 'released')
  ) then
    raise exception 'submission must be approved before release' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger releases_require_approved before insert on public.releases
  for each row execute function public.releases_require_approved();

