-- Teacher-level model runs (nightly style profile, §3.7) have no submission or
-- assignment; they are attributed to the teacher so costs stay visible.
alter table public.grading_runs add column teacher_id uuid references public.teachers (id) on delete cascade;
alter table public.grading_runs drop constraint if exists grading_runs_check;
alter table public.grading_runs
  add constraint grading_runs_scope_check
  check (submission_id is not null or assignment_id is not null or teacher_id is not null);
create index grading_runs_teacher_idx on public.grading_runs (teacher_id) where teacher_id is not null;

drop policy if exists grading_runs_select on public.grading_runs;
create policy grading_runs_select on public.grading_runs for select to authenticated
  using (
    (submission_id is not null and public.can_access_submission(submission_id))
    or (assignment_id is not null and public.can_access_assignment(assignment_id))
    or (teacher_id = (select auth.uid()))
  );
