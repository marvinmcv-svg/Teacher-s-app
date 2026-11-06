-- Scope cut (DECISIONS D-039): Tinta marks papers and gives the teacher a zip of
-- marked images. No student share links, comment bank, style profiles, answer
-- grouping or calibration exemplars — their tables go.
drop trigger if exists releases_require_approved on public.releases;
drop function if exists public.releases_require_approved();
drop table if exists public.releases;
drop table if exists public.answer_cluster_members;
drop table if exists public.answer_clusters;
drop table if exists public.exemplars;
drop table if exists public.comment_bank;
drop table if exists public.style_profiles;
drop type if exists public.release_channel;
alter table public.assignments drop column if exists review_sample_pct;
