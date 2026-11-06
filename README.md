# Tinta

Upload photos of a stack of handwritten papers and get them back marked in red pen: ✓ and ✗ next to each answer, mistakes circled, short comments handwritten in the margin and the score circled at the top. The teacher takes a quick look, approves, and downloads one zip of marked images named after each student ("Pérez, Ana.jpg"), so they sort by last name.
Spanish-first, bilingual (es/en), mobile-first PWA.

> **Scope (D-039): log in → class list → assignment with answer key → upload papers (one by one or in bulk) → AI marks them → quick review → download.** That's the whole app. No student share links, gradebook export, admin, billing or analytics.
>
> - assignment wizard (typed key, snap-the-key extraction, rubric templates, local grading scales)
> - capture (camera with a live quality gate, bulk photo upload, offline queue)
> - the grading pipeline (Claude + Google Vision via Inngest)
> - review queue + quick review screen (change scores, edit/hide comments, add your own, approve one or all)
> - download: one marked page as JPEG, or the whole class as a zip, files named "Last, First.jpg"
>
> **Grading needs API keys** (`ANTHROPIC_API_KEY`, Google Vision credentials, `SUPABASE_SECRET_KEY`, Inngest). Without them the app says so; it never fakes a grade. See "What's not done yet" below.
> The product spec is the master prompt. Engineering decisions are in [DECISIONS.md](DECISIONS.md) and data handling is in [PRIVACY.md](PRIVACY.md).

## Stack

Next.js 16 (App Router, `proxy.ts`) · TypeScript strict · Tailwind v4 · next-intl · Supabase (Postgres, Auth, Storage, RLS) · Inngest · Sentry · Vitest · Playwright.

## Setup

Requirements: Node 22+, pnpm 10, Docker (for local Supabase).

```bash
pnpm install
```

```bash
pnpm dlx supabase start -x studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta
```

Copy `.env.example` to `.env.local`. Then fill in `NEXT_PUBLIC_SUPABASE_URL` (`API_URL`) and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`PUBLISHABLE_KEY`) from the output of:

```bash
pnpm dlx supabase status
```

```bash
pnpm dev
```

Open http://127.0.0.1:3000 and sign in with a magic link. Local emails show up in Mailpit at http://127.0.0.1:54324.
If env vars are missing, the app sends you to `/setup` with instructions; it never silently degrades.

**Google sign-in:** enable the Google provider in Supabase (hosted dashboard, or `[auth.external.google]` in `supabase/config.toml` locally) with an OAuth client. Add `<site>/auth/callback` to the redirect URLs.

**Inngest (local):** run the dev server, which discovers `/api/inngest`:

```bash
pnpm dlx inngest-cli@latest dev -u http://127.0.0.1:3000/api/inngest
```

## Testing

| Command                                                                                                                              | What                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck`                                                                                                       | ESLint, `next typegen` + `tsc`                                              |
| `pnpm test`                                                                                                                          | Unit tests (roster parsing, i18n parity, env, redirects, Sentry scrubbing)  |
| `pnpm test:db`                                                                                                                       | RLS isolation suite on a throwaway local Postgres (needs Postgres binaries) |
| `RLS_AGAINST_SUPABASE=1 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm exec vitest run --project db` | Same suite against the real local Supabase DB                               |
| `pnpm build && pnpm test:e2e`                                                                                                        | Playwright (Pixel 7) happy path against local Supabase                      |

CI (`.github/workflows/ci.yml`) runs all of the above.

## Layout

```
app/(teacher)/       authed teacher app (home, classes, roster)
app/login, app/auth  sign-in + OAuth/magic-link callback
app/setup            missing-config screen
app/api/inngest      Inngest endpoint      app/api/health   health check
components/          design system (ui/) + app components
lib/                 env, i18n, supabase clients, roster parser, actions, observability
i18n/request.ts      next-intl locale resolution
messages/            es.json, en.json
inngest/             job client + functions
supabase/            config.toml + migrations (schema, RLS, storage)
tests/               unit/, db/ (RLS), e2e/
```

## What's not done yet (Phase 1)

- **Accuracy is unmeasured.** No golden papers yet: they need written school and parent consent. The Phase 1 eval targets (≥ 90 % within-tolerance agreement; "high" items ≥ 95 % correct) can't be checked until a real set exists and the keys are configured.
- **Real-model runs.** The pipeline has never run against the live Claude or Google Vision APIs from this environment (no keys). Everything around the providers is tested.
- **Capture:** no live edge detection, auto-crop or perspective correction yet (framing guide only).
- **Measurements still to do:**
  - Lighthouse installability check
  - throttled-3G run on a mid-range Android
  - the 15-minute, 10-real-papers acceptance run
- **Name order in file names** is inferred from how the class list is written (see D-039). Write names as "Pérez Quispe, Ana" in the list if a name comes out wrong.
