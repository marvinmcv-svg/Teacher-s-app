-- Tinta — initial schema (master prompt §7).
-- Every table has RLS enabled. A teacher can only reach rows that belong to
-- classes they own or co-teach. The public student view never reads through
-- RLS: it goes through a server route that validates a release token (§7).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.assignment_status as enum ('draft', 'collecting', 'grading', 'reviewing', 'released');
create type public.question_type as enum ('numeric', 'short_answer', 'multiple_choice', 'math_steps', 'extended_writing', 'diagram', 'other');
create type public.question_source as enum ('typed', 'extracted', 'ai_proposed');
create type public.submission_status as enum ('uploading', 'queued', 'processing', 'ready', 'needs_attention', 'approved', 'released');
create type public.confidence_band as enum ('high', 'medium', 'low');
create type public.match_method as enum ('qr', 'name_ocr', 'manual');
create type public.answer_status as enum ('answered', 'no_answer', 'unclear');
create type public.grading_run_kind as enum ('name_read', 'key_extract', 'transcribe', 'grade', 'verify', 'regenerate', 'style_distill');
create type public.annotation_kind as enum ('correct', 'error', 'partial', 'unclear', 'praise', 'note');
create type public.annotation_author as enum ('ai', 'teacher');
create type public.release_channel as enum ('link', 'pdf', 'qr', 'print', 'lms');
create type public.class_teacher_role as enum ('owner', 'co_teacher');
create type public.app_locale as enum ('es', 'en');

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  country text,
  default_locale public.app_locale not null default 'es',
  grading_scale_default jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teachers (
  id uuid primary key references auth.users (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  display_name text,
  locale public.app_locale not null default 'es',
  subjects text[] not null default '{}',
  plan text not null default 'free',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  grade_level text,
  subject text,
  locale public.app_locale not null default 'es',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index classes_teacher_id_idx on public.classes (teacher_id);

create table public.class_teachers (
  class_id uuid not null references public.classes (id) on delete cascade,
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  role public.class_teacher_role not null default 'co_teacher',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (class_id, teacher_id)
);
create index class_teachers_teacher_id_idx on public.class_teachers (teacher_id);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  external_id text,
  feedback_locale public.app_locale,
  qr_code_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_class_id_idx on public.students (class_id);

create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  owner_teacher_id uuid references public.teachers (id) on delete cascade,
  title text not null,
  subject text,
  locale public.app_locale not null default 'es',
  is_template boolean not null default false,
  criteria jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- templates are global (no owner); everything else has an owner
  check (is_template or owner_teacher_id is not null)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  title text not null,
  subject text,
  grade_level text,
  scale jsonb not null,            -- {type, min, max, pass_mark, decimals, levels?}
  feedback_settings jsonb not null default '{}',
  rubric_id uuid references public.rubrics (id) on delete set null,
  status public.assignment_status not null default 'draft',
  due_at timestamptz,
  deleted_at timestamptz,          -- 30-day soft delete (§9)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignments_class_id_idx on public.assignments (class_id);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  position int not null,
  label text not null,
  prompt_text text,
  type public.question_type not null,
  max_points numeric not null check (max_points >= 0),
  correct_answers jsonb not null default '[]',
  equivalents jsonb not null default '[]',
  form_matters boolean not null default false,
  partial_credit_rules text,
  notes text,
  source public.question_source not null default 'typed',
  teacher_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, position)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid references public.students (id) on delete set null,
  status public.submission_status not null default 'uploading',
  confidence public.confidence_band,
  match_method public.match_method,
  flags text[] not null default '{}',
  approved_by uuid references public.teachers (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index submissions_assignment_student_uniq
  on public.submissions (assignment_id, student_id) where student_id is not null;
create index submissions_assignment_id_idx on public.submissions (assignment_id);

create table public.exemplars (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  teacher_scores jsonb not null,
  teacher_feedback jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  position int not null,
  storage_path text not null,
  redacted_storage_path text,
  width int,
  height int,
  quality jsonb,
  sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, position)
);

create table public.ocr_lines (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  line_key text not null check (line_key ~ '^p[0-9]+-l[0-9]+$'),
  text text not null,
  bbox jsonb not null,             -- normalised 0..1 {x,y,w,h}
  confidence numeric,
  words jsonb,
  redacted boolean not null default false, -- name/header lines never sent to an LLM
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, line_key)
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  status public.answer_status not null,
  text text,
  struck_text text,
  line_keys text[] not null default '{}',
  mapping_confidence numeric,
  has_diagram boolean not null default false,
  diagram_description text,
  illegible_spans int not null default 0,
  ocr_corrections jsonb not null default '[]',
  teacher_corrected_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create table public.grading_runs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.submissions (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete cascade,
  kind public.grading_run_kind not null,
  model text not null,
  prompt_version text not null,
  effort text,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cost_usd numeric,
  latency_ms int,
  raw_output jsonb,
  status text not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (submission_id is not null or assignment_id is not null)
);

create table public.criterion_scores (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  question_id uuid references public.questions (id) on delete cascade,
  criterion_key text,
  ai_score numeric,
  ai_max numeric,
  ai_level_label text,
  teacher_score numeric,
  teacher_level_label text,
  evidence_line_keys text[] not null default '{}',
  rationale text,
  self_confidence numeric,
  confidence numeric,
  confidence_band public.confidence_band,
  verifier_score numeric,
  disagreement boolean not null default false,
  error_type text,
  misconception_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((question_id is null) <> (criterion_key is null))
);

create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  kind public.annotation_kind not null,
  region jsonb,                    -- normalised bbox
  anchor_line_keys text[] not null default '{}',
  approximate boolean not null default false,
  text text not null,
  author public.annotation_author not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  locale public.app_locale not null,
  glows jsonb not null default '[]',
  grows jsonb not null default '[]',
  next_step text,
  practice_item text,
  summary_for_teacher text,
  ai_version jsonb,
  teacher_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teacher_edits (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete cascade,
  target_table text not null,
  target_id uuid not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.comment_bank (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  subject text,
  locale public.app_locale not null,
  text text not null,
  tags text[] not null default '{}',
  uses int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.style_profiles (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  profile jsonb not null,
  version int not null default 1,
  built_from_edit_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  -- ≥128-bit random token, generated server-side (§9)
  token text not null unique check (char_length(token) >= 32),
  channel public.release_channel not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.answer_clusters (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  normalised_answer text not null,
  teacher_score numeric,
  teacher_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.answer_cluster_members (
  cluster_id uuid not null references public.answer_clusters (id) on delete cascade,
  answer_id uuid not null references public.answers (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cluster_id, answer_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.teachers (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at triggers on every table
do $$
declare t text;
begin
  foreach t in array array[
    'schools','teachers','classes','class_teachers','students','rubrics','assignments',
    'questions','submissions','exemplars','pages','ocr_lines','answers','grading_runs',
    'criterion_scores','annotations','feedback','teacher_edits','comment_bank',
    'style_profiles','releases','answer_clusters','answer_cluster_members','audit_log'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- New auth user -> teacher row
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.teachers (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function public.can_access_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classes c
    where c.id = p_class_id and c.teacher_id = (select auth.uid())
  ) or exists (
    select 1 from public.class_teachers ct
    where ct.class_id = p_class_id and ct.teacher_id = (select auth.uid())
  );
$$;

create or replace function public.owns_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classes c
    where c.id = p_class_id and c.teacher_id = (select auth.uid())
  );
$$;

create or replace function public.can_access_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
    where a.id = p_assignment_id and public.can_access_class(a.class_id)
  );
$$;

create or replace function public.can_access_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    where s.id = p_submission_id and public.can_access_assignment(s.assignment_id)
  );
$$;

create or replace function public.can_access_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id and public.can_access_class(s.class_id)
  );
$$;

revoke execute on function public.can_access_class(uuid), public.owns_class(uuid),
  public.can_access_assignment(uuid), public.can_access_submission(uuid),
  public.can_access_student(uuid)
  from public, anon;
grant execute on function public.can_access_class(uuid), public.owns_class(uuid),
  public.can_access_assignment(uuid), public.can_access_submission(uuid),
  public.can_access_student(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.schools enable row level security;
alter table public.teachers enable row level security;
alter table public.classes enable row level security;
alter table public.class_teachers enable row level security;
alter table public.students enable row level security;
alter table public.rubrics enable row level security;
alter table public.assignments enable row level security;
alter table public.questions enable row level security;
alter table public.submissions enable row level security;
alter table public.exemplars enable row level security;
alter table public.pages enable row level security;
alter table public.ocr_lines enable row level security;
alter table public.answers enable row level security;
alter table public.grading_runs enable row level security;
alter table public.criterion_scores enable row level security;
alter table public.annotations enable row level security;
alter table public.feedback enable row level security;
alter table public.teacher_edits enable row level security;
alter table public.comment_bank enable row level security;
alter table public.style_profiles enable row level security;
alter table public.releases enable row level security;
alter table public.answer_clusters enable row level security;
alter table public.answer_cluster_members enable row level security;
alter table public.audit_log enable row level security;

-- schools: readable by members; writes are admin-only (Phase 3, service role)
create policy schools_select on public.schools for select to authenticated
  using (id in (select t.school_id from public.teachers t where t.id = (select auth.uid())));

-- teachers: own row only
create policy teachers_select on public.teachers for select to authenticated
  using (id = (select auth.uid()));
create policy teachers_update on public.teachers for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- classes: owner + co-teachers read; only owner creates/changes/deletes
-- owner check is inline (not only via the STABLE helper) so INSERT ... RETURNING
-- can see the row it just created
create policy classes_select on public.classes for select to authenticated
  using (teacher_id = (select auth.uid()) or public.can_access_class(id));
create policy classes_insert on public.classes for insert to authenticated
  with check (teacher_id = (select auth.uid()));
create policy classes_update on public.classes for update to authenticated
  using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy classes_delete on public.classes for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- class_teachers: members see the list; only the class owner manages it
create policy class_teachers_select on public.class_teachers for select to authenticated
  using (public.can_access_class(class_id));
create policy class_teachers_write on public.class_teachers for all to authenticated
  using (public.owns_class(class_id)) with check (public.owns_class(class_id));

-- rubrics: own + global templates (read); own only (write)
create policy rubrics_select on public.rubrics for select to authenticated
  using (is_template or owner_teacher_id = (select auth.uid()));
create policy rubrics_write on public.rubrics for all to authenticated
  using (owner_teacher_id = (select auth.uid()))
  with check (owner_teacher_id = (select auth.uid()) and not is_template);

-- class-scoped tables
create policy students_all on public.students for all to authenticated
  using (public.can_access_class(class_id)) with check (public.can_access_class(class_id));
create policy assignments_all on public.assignments for all to authenticated
  using (public.can_access_class(class_id)) with check (public.can_access_class(class_id));

-- assignment-scoped tables
create policy questions_all on public.questions for all to authenticated
  using (public.can_access_assignment(assignment_id)) with check (public.can_access_assignment(assignment_id));
create policy exemplars_all on public.exemplars for all to authenticated
  using (public.can_access_assignment(assignment_id)) with check (public.can_access_assignment(assignment_id));
create policy answer_clusters_all on public.answer_clusters for all to authenticated
  using (public.can_access_assignment(assignment_id)) with check (public.can_access_assignment(assignment_id));
create policy submissions_all on public.submissions for all to authenticated
  using (public.can_access_assignment(assignment_id))
  with check (
    public.can_access_assignment(assignment_id)
    and (student_id is null or public.can_access_student(student_id))
  );

-- submission-scoped tables
create policy pages_all on public.pages for all to authenticated
  using (public.can_access_submission(submission_id)) with check (public.can_access_submission(submission_id));
create policy ocr_lines_all on public.ocr_lines for all to authenticated
  using (public.can_access_submission(submission_id)) with check (public.can_access_submission(submission_id));
create policy answers_all on public.answers for all to authenticated
  using (public.can_access_submission(submission_id)) with check (public.can_access_submission(submission_id));
create policy criterion_scores_all on public.criterion_scores for all to authenticated
  using (public.can_access_submission(submission_id)) with check (public.can_access_submission(submission_id));
create policy annotations_all on public.annotations for all to authenticated
  using (public.can_access_submission(submission_id)) with check (public.can_access_submission(submission_id));
create policy feedback_all on public.feedback for all to authenticated
  using (public.can_access_submission(submission_id)) with check (public.can_access_submission(submission_id));
create policy releases_all on public.releases for all to authenticated
  using (public.can_access_submission(submission_id)) with check (public.can_access_submission(submission_id));
create policy answer_cluster_members_all on public.answer_cluster_members for all to authenticated
  using (exists (select 1 from public.answer_clusters c
                 where c.id = cluster_id and public.can_access_assignment(c.assignment_id)))
  with check (exists (select 1 from public.answer_clusters c
                      where c.id = cluster_id and public.can_access_assignment(c.assignment_id)));

-- grading_runs: read-only for teachers; written by the pipeline (service role)
create policy grading_runs_select on public.grading_runs for select to authenticated
  using (
    (submission_id is not null and public.can_access_submission(submission_id))
    or (assignment_id is not null and public.can_access_assignment(assignment_id))
  );

-- teacher-private tables
create policy teacher_edits_all on public.teacher_edits for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid())
              and (submission_id is null or public.can_access_submission(submission_id)));
create policy comment_bank_all on public.comment_bank for all to authenticated
  using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy style_profiles_select on public.style_profiles for select to authenticated
  using (teacher_id = (select auth.uid()));

-- audit_log: append-only for the actor; read own entries
create policy audit_log_select on public.audit_log for select to authenticated
  using (actor_id = (select auth.uid()));
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (actor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants (Supabase grants these by default; explicit here so the migration is
-- self-describing and works on a plain Postgres in tests). anon gets nothing.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- teachers rows are created by the auth trigger only
revoke insert, delete on public.teachers from authenticated;
-- pipeline-owned tables are read-only for clients
revoke insert, update, delete on public.grading_runs, public.style_profiles from authenticated;
revoke update, delete on public.audit_log from authenticated;
-- teachers may only edit their own profile fields — never plan or school
revoke update on public.teachers from authenticated;
grant update (display_name, locale, subjects, onboarded_at) on public.teachers to authenticated;
