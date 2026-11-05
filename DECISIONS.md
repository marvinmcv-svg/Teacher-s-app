# DECISIONS.md

Running log of non-obvious choices (master prompt §0.8). Newest at the bottom of each section.

---

## A. Verification of master prompt §6.1 / §6.2 (5 Nov 2026)

Checked against the current Anthropic docs (vision page fetched live; the rest from the
current Claude API reference bundled with the tooling, cached 2026-10-06). **Re-check
again at the start of Phase 1 before writing `lib/ai/*`.**

### §6.1 Claude API — confirmed

| Claim in spec                                                                       | Status                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model IDs `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`                | ✅ exist. List prices per MTok in/out: Haiku 5.5 $0.10/$0.50 (≤100K-token prompts), Sonnet 5.5 $2/$10, Opus 5.5 $4/$20. These go in config, never code (§8.6).                                       |
| No `temperature`/`top_p`/`top_k`                                                    | ✅ Non-default values → 400 on Sonnet 5/5.5 and Haiku 5.5. **Stricter than the spec:** on API version `2026-10-21` _any_ value of any of the three is a 400 on _every_ model. Rule: never send them. |
| Adaptive thinking + `output_config.effort`                                          | ✅ `thinking: {type:"adaptive"}`; `budget_tokens` → 400. Levels are `low`/`medium`/`high`/`xhigh`/`max`.                                                                                             |
| Structured outputs GA (`strict: true` tools, or `output_config.format` json_schema) | ✅ (`output_format` is deprecated; use `output_config.format`). Keep Zod post-validation.                                                                                                            |
| No assistant prefill                                                                | ✅ 400 on all 4.6+ models, including all three we use.                                                                                                                                               |
| Images before text                                                                  | ✅ ("Claude works best when images come before text").                                                                                                                                               |
| Max 8000×8000 px, ~10 MB per base64 image                                           | ✅                                                                                                                                                                                                   |
| Stricter per-image limit above 20 images                                            | ✅ Keep each image ≤ 3000 px on both sides, or ≤ 20 image blocks per request.                                                                                                                        |
| Prompt caching min 512 tokens on Sonnet 5.5                                         | ✅ 512 on all three 5.5 models.                                                                                                                                                                      |
| Files API, upload once and reference by `file_id`                                   | ✅ It's **GA now**: `client.files.*`, no beta header (the old `client.beta.files` + `files-api-2025-04-14` is outdated).                                                                             |
| Message Batches for "grade overnight"                                               | ✅ 50% cost. Results come back in any order, so key them by `custom_id`.                                                                                                                             |

### §6.1 — differences that change the implementation

1. **All three models are in the high-resolution tier.** The docs list the high-res tier as
   "Claude 4.7 and later models": 2,576 px long edge, up to 4,784 visual tokens. That includes
   Haiku 5.5 and Sonnet 5.5, not only Opus as §6.1 says. Consequences:
   - Pre-resize every page to fit 2576 px / 4784 tokens (≈ 2576×1449 for 16:9; for an A4/Letter
     portrait page about 1792×2532 → check against the token cap with the reference resize helper).
   - Coordinates are 1:1 with the pre-resized image, so normalising to 0–1 still works as in §6.1.
   - Cost: a high-res page uses up to ~3× the tokens of a standard-tier page. The eval harness
     should also test a smaller size (e.g. 1568 px) because legibility vs. cost is something we
     measure, not assume (§8.6).
2. **Forced tool choice returns 400** on Opus 5.5 and Sonnet 5.5 (`tool_choice` `any` or
   `{type:"tool"}`). The spec's "Respond only by calling the tool `submit_*`" pattern must
   **not** use forced `tool_choice`. **Decision (D-010):** every pipeline call uses
   **JSON outputs** (`output_config.format: {type:"json_schema", …}`), with the schema generated
   from the Zod schema. The prompt wording changes from "call the tool" to "respond with the
   JSON object". If we ever need tools, use `tool_choice: auto` + `strict: true`.
3. **Thinking can't be turned off** on Opus 5.5 or Sonnet 5.5. `{type:"disabled"}` returns 400;
   lower `effort` instead.
4. **The default effort differs by model.** It is `medium` on Opus 5.5 and Haiku 5.5 and `high`
   on Sonnet 5.5. **Always set `effort` explicitly** and log it in `grading_runs.effort`.
   Starting points stay as in §6.1: name reading `low`, transcribe/grade `medium`, verifier
   `medium`. The evals decide the final values.
5. **Request size limit is 128 MB** on the first-party API, not 32 MB. This doesn't matter much,
   because we use the Files API.
6. **Refusals.** A response can have `stop_reason: "refusal"` (HTTP 200). Every call must check
   `stop_reason` before parsing. Opus 5.5 and Sonnet 5.5 support server-side `fallbacks`
   (beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`); Haiku 5.5 has no
   server-side fallback. **Decision (D-011):** turn fallbacks on for the grader and verifier,
   and record the model that actually served each call in `grading_runs.model`. A refusal on
   student work → `needs_attention`, never a fabricated grade.
7. **Tokenizer.** The 5.x tokenizer counts ~1.0–1.35× more tokens than 4.5-era models for the
   same text. Use `messages.count_tokens` for budgets; don't reuse old estimates. (This is
   roughly in line with the spec's "~30%".)

### §6.2 Google Cloud Vision — NOT re-verified

`cloud.google.com` / `docs.cloud.google.com` can't be reached from this build environment
(network policy). The §6.2 notes match my understanding of the API:

- There is no line object: the hierarchy is Page → Block → Paragraph → Word → Symbol.
- Build lines from `detectedBreak` `EOL_SURE_SPACE` / `LINE_BREAK`.
- `imageContext.languageHints` is supported.
- Confidence is given per word/symbol.

**Action:** re-check against the live docs before building the `OcrProvider` in Phase 1, and
pin the API version in the adapter.

---

## B. Phase 0 engineering decisions

- **D-001 — Next.js 16.4 + React 19.3, scaffolded with `create-next-app`.** Next 16 renamed
  `middleware` to **`proxy.ts`**. The bundled docs in `node_modules/next/dist/docs` are the
  source of truth; see AGENTS.md.
- **D-002 — TypeScript 5.9, not 7.0.** TS 7 (the native port) is out, but Next 16.4 scaffolds
  5.x and the ecosystem (eslint-config-next, vitest) targets 5.x. Revisit later.
- **D-003 — Tailwind v4 (CSS-first config).** The §5 tokens live as CSS variables in
  `app/globals.css` and are mapped into Tailwind with `@theme inline`. Dark mode follows the
  system and can be overridden with `data-theme` (the theme toggle, stored in localStorage).
- **D-004 — `cacheComponents: false`.** Almost every teacher screen shows per-user,
  per-request data behind auth, so Cache Components would mean wrapping almost everything in
  Suspense for little gain. Revisit for the public student view (`/s/[token]`), which can use
  `use cache`. Next says these flags become default in the next major.
- **D-005 — shadcn/ui-style components written by hand** (cva + `radix-ui` + tailwind-merge)
  instead of the shadcn CLI. Same patterns and file shapes, so the CLI can take over later.
- **D-006 — i18n without locale-prefixed URLs.** next-intl in "without i18n routing" mode. The
  UI locale comes from the `TINTA_LOCALE` cookie, then `Accept-Language`, then **Spanish**. The
  language switcher also saves it to `teachers.locale`. Student pages will use the student's
  feedback locale, not the viewer's.
- **D-007 — Supabase new-style keys.** The app uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (`sb_publishable_…`) for the browser/SSR client. `SUPABASE_SECRET_KEY` is reserved for the
  pipeline (Phase 1, server-only). Auth uses `@supabase/ssr` cookies with PKCE. Pages and
  actions check `getUser()`, never `getSession()`. The proxy only refreshes the session and
  makes an optimistic redirect; **RLS is the real boundary.**
- **D-008 — Full §7 schema migrated in Phase 0** (not just classes/students), so RLS covers
  every table from day one and the isolation suite tests them. Notes on the schema:
  - `ocr_lines` gets `submission_id` (to enforce `line_key` uniqueness per submission) and
    `redacted` (name/header lines are kept but never sent to an LLM).
  - `assignments` gets `deleted_at` for the 30-day soft delete (§9).
  - `teachers` gets `onboarded_at`.
  - `criterion_scores` has a CHECK that exactly one of `question_id` / `criterion_key` is set.
  - `releases.token` has a CHECK that it's at least 32 characters (≥128-bit).
  - Teachers can only update `display_name`, `locale`, `subjects` and `onboarded_at` on their
    own row (column grants), so they can't change their own `plan` or `school_id`.
  - `grading_runs` and `style_profiles` are read-only for clients; they're written by the
    pipeline with the service role.
- **D-009 — RLS helper functions** (`can_access_class/assignment/submission/student`) are
  `security definer`, `stable`, and use `search_path = ''`. Policy subtlety found by the test
  suite: `INSERT … RETURNING` on `classes` failed because a STABLE helper can't see the row
  the statement just inserted. The owner check is now inline in `classes_select`.
- **D-010 / D-011** — see section A (JSON outputs instead of forced tools; refusal fallbacks).
- **D-012 — RLS tests run two ways.**
  1. Against a plain Postgres with a small Supabase stub (`tests/db/supabase-stub.sql`: `auth`,
     `storage`, roles). This is fast and runs anywhere (`pnpm test:db`).
  2. Against a real local Supabase database (`RLS_AGAINST_SUPABASE=1`).

  CI does both.

- **D-013 — E2E runs against a real local Supabase stack** (`supabase start` without studio,
  realtime and the other unused services). Magic links are read from Mailpit. No auth mocking.
- **D-014 — Removing a student is a soft delete** (`active = false`) with Undo and "Recently
  removed → Restore" (§4 "undo for every destructive action"). Hard deletes come with the data
  retention controls.
- **D-015 — Sentry 11** uses `dataCollection` (everything off) instead of the removed
  `sendDefaultPii`, plus our own `beforeSend` / `beforeBreadcrumb` scrubbers. These drop
  bodies, cookies, headers, query strings, console and UI breadcrumbs, and `/s/<token>`
  segments. Session Replay is deliberately off, because it would record student work.
  `withSentryConfig` (source-map upload) is left out until there's a Sentry auth token.
- **D-016 — Auth callback redirects use `NEXT_PUBLIC_SITE_URL`**, not
  `request.nextUrl.origin`. Under `next start` the origin resolved to `localhost` while the
  cookie was on `127.0.0.1`, which dropped the session (found by E2E).
- **D-017 — Local Supabase auth `email_sent` rate limit raised to 100/h** in
  `supabase/config.toml` (default 2/h) so E2E can sign in several teachers. This setting is
  local-only and doesn't affect hosted projects.
- **D-018 — PostHog not wired in Phase 0.** It needs a project key and a decision on region
  (EU/US). An analytics wrapper with PII-free event names will come with the first real flows
  in Phase 1.
- **D-019 — PWA:** the web manifest ships now. The service worker (Serwist) and the IndexedDB
  upload queue come with the capture flow in Phase 1, where offline behaviour actually
  matters; caching authenticated pages before then risks serving stale or private content.
