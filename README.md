# Tinta

Snap a stack of handwritten papers and get back graded work with red-pen-style feedback pinned to the page. The teacher reviews and approves everything before students see it.
Spanish-first, bilingual (es/en), mobile-first PWA.

> **Status: Phase 0 (foundations) complete.** Sign-in, language switching, classes and rosters. No AI grading yet; that is Phase 1.
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
