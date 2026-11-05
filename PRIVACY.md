# PRIVACY.md — how Tinta handles student data

Status: **Phase 0 draft**. It describes what is built today and what each later phase commits to.
Have a lawyer review it before selling to schools (§9).

## Principles

- Student work is minors' data. We collect the minimum, keep it private, and never use it to train models.
- Nothing reaches a student until a teacher approves it.
- Grading models never see student identities: names and headers are redacted before the transcribe, grade and verify calls. One narrow exception, allowed by the spec: when matching against the roster is unsure, **only the cropped header** of page 1 goes to the fast model so it can read the name. The roster itself is never sent; matching happens in our code.

## What we store (today)

| Data                                                           | Where                      | Notes                                             |
| -------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| Teacher account (email, name from Google if used, UI language) | Supabase Auth + `teachers` |                                                   |
| Class name, grade, subject                                     | `classes`                  |                                                   |
| Student display name, optional external ID                     | `students`                 | No birthdates, no photos of faces.                |
| QR token per student                                           | `students.qr_code_token`   | Random 128-bit; used for name stickers (Phase 2). |

| Page images | `pages-original` (normalised; EXIF/GPS stripped on device and again on the server) and `pages-redacted` (name area filled) | Private buckets. Paths are `{teacher}/{assignment}/{submission}/…` |
| OCR lines, transcriptions, scores, pins, feedback | Postgres | Name/header OCR lines are flagged `redacted` and never sent to an LLM |
| Model call log | `grading_runs` | Model, tokens, cost, latency and the model's JSON output (for audit and evals). No student names: the inputs are redacted |
| Teacher edits | `teacher_edits` | Before/after diffs, for this teacher's style learning only |
| Release tokens | `releases` | 256-bit, revocable, optional expiry, `viewed_at` |

Capture queue: photos wait in the teacher's browser (IndexedDB) until they upload, and are deleted from the device once stored. Phones are often shared, so teachers should sign out on shared devices; signing out also clears cached pages.

## Access control

- Row-level security on **every** table. A teacher reaches only rows of classes they own or co-teach. This is verified by `tests/db/rls.test.ts`, which runs in CI against both plain Postgres and real Supabase.
- Storage buckets are private. Object paths are `{teacher_id}/{assignment_id}/…` and storage policies only let users reach their own prefix. Downloads use signed URLs that expire in ≤ 10 minutes.
- The public student view (`/s/[token]`, Phase 1) reads through a server route that validates the release token. It never uses a client with broad RLS access. Tokens are ≥ 128-bit random, revocable, and can expire.

## Processors (sub-processors)

| Provider               | Purpose                              | Sees                                                                                                                             | Status                                                                                                                 |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Supabase               | Database, auth, storage              | Everything stored                                                                                                                | Active. Pick the project region close to the school (e.g. São Paulo for Bolivia/LatAm).                                |
| Vercel                 | Hosting                              | Requests in transit                                                                                                              | Active at deploy.                                                                                                      |
| Sentry                 | Error tracking                       | Scrubbed errors only: no bodies, cookies, headers, query strings, names, tokens or Session Replay (`lib/observability/scrub.ts`) | Optional                                                                                                               |
| Anthropic (Claude API) | Transcription, grading, verification | **Redacted** page images and redacted OCR lines only                                                                             | Phase 1. Commercial API terms: inputs/outputs are not used for training. Verify current retention terms before launch. |
| Google Cloud Vision    | OCR / anchoring                      | **Original** pages, including the name area (needed to find and redact it)                                                       | Phase 1. Disclose to schools. Set the data region and check data-use terms before launch.                              |
| Mathpix (optional)     | Math OCR                             | Original pages                                                                                                                   | Optional. Same checks.                                                                                                 |
| Inngest                | Background job orchestration         | Job events (IDs only, never images or names)                                                                                     | Phase 1                                                                                                                |
| PostHog                | Product analytics                    | PII-free events                                                                                                                  | Not wired yet (DECISIONS D-018)                                                                                        |

## Retention (commitments — automation not built yet)

- Deleting an assignment is a soft delete. Its images are hard-deleted after 30 days.
- Original images are auto-deleted at the end of the school year by default (configurable).
- An audit log records releases, exports, deletions and role changes.

## Safeguarding

The `wellbeing_review` flag is never auto-commented. It is shown privately to the teacher with a neutral note to follow the school's safeguarding procedures.

## Logging

Logs never contain student images, names or transcriptions. Server logs record error codes only (see `console.error(..., { code })` call sites).

## Legal landscape (to verify with counsel)

- Bolivia: no comprehensive data-protection law yet (constitutional Art. 130 + sectoral rules; the AGETIC draft is pending). Use a school data agreement from day one.
- Other LatAm markets: Brazil LGPD, Chile's updated law, Colombia Law 1581.
- US: FERPA and COPPA (amended rule in force since 22 Apr 2026).
- EU/UK: GDPR / UK GDPR.
