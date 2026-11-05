/**
 * RLS isolation suite (Phase 0 acceptance, §9): teacher A can never read or
 * write teacher B's data; anon reads nothing; co-teachers see only classes
 * they were added to.
 *
 * Runs against a real Postgres. Locally: `pnpm test:db` (spins one up).
 * CI: Postgres service container + TEST_DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Run `pnpm test:db` (starts a local Postgres) or point it at a disposable database.",
  );
}

// RLS_AGAINST_SUPABASE=1: TEST_DATABASE_URL points at a real (local) Supabase
// database that already has the migrations applied (`supabase start`).
const AGAINST_SUPABASE = process.env.RLS_AGAINST_SUPABASE === "1";
const root = path.resolve(__dirname, "../..");
const dbName = `tinta_rls_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
let db: Client;

const A = randomUUID(); // teacher A — owns class A
const B = randomUUID(); // teacher B — owns class B
const C = randomUUID(); // teacher C — co-teacher on class A only

type Ids = Record<string, string>;
const ids: Ids = {};

/** Run `fn` inside a transaction as the given Supabase role / user. */
async function as<T>(
  user: string | null,
  fn: (
    q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>,
  ) => Promise<T>,
): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`set local role ${user ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
    const result = await fn((sql, params) => db.query(sql, params as unknown[]));
    await db.query("commit");
    return result;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

/** Expect a write to be rejected by RLS (error) or silently affect 0 rows. */
async function expectBlocked(user: string | null, sql: string, params: unknown[] = []) {
  let rowCount: number | null = null;
  let errored = false;
  try {
    rowCount = await as(user, async (q) => (await q(sql, params)).rowCount);
  } catch {
    errored = true;
  }
  expect(errored || rowCount === 0, `expected blocked: ${sql}`).toBe(true);
}

async function count(user: string | null, table: string, where = "true", params: unknown[] = []) {
  return as(user, async (q) =>
    Number((await q(`select count(*)::int as n from ${table} where ${where}`, params)).rows[0].n),
  );
}

beforeAll(async () => {
  if (AGAINST_SUPABASE) {
    db = new Client({ connectionString: ADMIN_URL });
    await db.connect();
  } else {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();

    const url = new URL(ADMIN_URL);
    url.pathname = `/${dbName}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();

    await db.query(readFileSync(path.join(root, "tests/db/supabase-stub.sql"), "utf8"));
    const migrationsDir = path.join(root, "supabase/migrations");
    for (const file of readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      await db.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  }

  // Sign-ups (the auth trigger creates the teachers rows)
  for (const [id, email] of [
    [A, `a-${A}@test`],
    [B, `b-${B}@test`],
    [C, `c-${C}@test`],
  ]) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  }

  // Seed through the real RLS path, as each teacher
  for (const [teacher, key] of [
    [A, "A"],
    [B, "B"],
  ] as const) {
    await as(teacher, async (q) => {
      const cls = await q("insert into public.classes (teacher_id, name) values ($1, $2) returning id", [
        teacher,
        `Class ${key}`,
      ]);
      ids[`class${key}`] = cls.rows[0].id as string;
      const st = await q("insert into public.students (class_id, display_name) values ($1, $2) returning id", [
        ids[`class${key}`],
        `Student ${key}`,
      ]);
      ids[`student${key}`] = st.rows[0].id as string;
      const asg = await q(
        `insert into public.assignments (class_id, title, scale) values ($1, 'Fracciones', '{"type":"points","min":0,"max":10,"pass_mark":6,"decimals":0}') returning id`,
        [ids[`class${key}`]],
      );
      ids[`assignment${key}`] = asg.rows[0].id as string;
      const sub = await q(
        "insert into public.submissions (assignment_id, student_id, status) values ($1, $2, 'approved') returning id",
        [ids[`assignment${key}`], ids[`student${key}`]],
      );
      ids[`submission${key}`] = sub.rows[0].id as string;
      await q("insert into public.pages (submission_id, position, storage_path) values ($1, 1, $2)", [
        ids[`submission${key}`],
        `${teacher}/x/p1.jpg`,
      ]);
      await q("insert into public.feedback (submission_id, locale) values ($1, 'es')", [ids[`submission${key}`]]);
      await q("insert into public.releases (submission_id, token, channel) values ($1, $2, 'link')", [
        ids[`submission${key}`],
        randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
      ]);
      await q("insert into public.comment_bank (teacher_id, locale, text) values ($1, 'es', 'Revisa el signo')", [
        teacher,
      ]);
      // Phase 2 tables
      await q("insert into public.pdf_imports (assignment_id, teacher_id, storage_path) values ($1, $2, $3)", [
        ids[`assignment${key}`],
        teacher,
        `${teacher}/${ids[`assignment${key}`]}/imports/x.pdf`,
      ]);
      await q(
        `insert into public.blind_checks (submission_id, assignment_id, teacher_id, items, n_items, exact_rate, within_rate)
         values ($1, $2, $3, '[]', 0, 1, 1)`,
        [ids[`submission${key}`], ids[`assignment${key}`], teacher],
      );
      await q(
        "insert into public.mini_lessons (assignment_id, misconception_tag, locale, lesson) values ($1, 'sign_error', 'es', '{}')",
        [ids[`assignment${key}`]],
      );
    });
  }
  // A adds C as co-teacher of class A
  await as(A, (q) => q("insert into public.class_teachers (class_id, teacher_id) values ($1, $2)", [ids.classA, C]));
});

afterAll(async () => {
  if (AGAINST_SUPABASE) {
    // Supabase blocks direct deletes from storage tables unless explicitly allowed.
    await db?.query("begin");
    await db?.query("set local storage.allow_delete_query = 'true'");
    await db?.query("delete from storage.objects where name like any($1)", [[`${A}/%`, `${B}/%`]]);
    await db?.query("commit");
    await db?.query("delete from auth.users where id = any($1)", [[A, B, C]]);
    await db?.end();
    return;
  }
  await db?.end();
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

const CLASS_SCOPED = ["classes", "students", "assignments", "submissions", "pages", "feedback", "releases"] as const;

describe("RLS: teacher isolation", () => {
  it("every public table has RLS enabled", async () => {
    const res = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(res.rows.map((r) => r.relname)).toEqual([]);
  });

  it("teacher A sees exactly their own rows", async () => {
    for (const t of CLASS_SCOPED) expect(await count(A, `public.${t}`), t).toBe(1);
    // (other teachers' rows may exist in a shared DB; RLS must hide all of them)
    expect(await count(A, "public.comment_bank")).toBe(1);
    expect(await count(A, "public.teachers")).toBe(1);
  });

  it("teacher B cannot read any of teacher A's rows", async () => {
    expect(await count(B, "public.classes", "id = $1", [ids.classA])).toBe(0);
    expect(await count(B, "public.students", "class_id = $1", [ids.classA])).toBe(0);
    expect(await count(B, "public.assignments", "id = $1", [ids.assignmentA])).toBe(0);
    expect(await count(B, "public.submissions", "id = $1", [ids.submissionA])).toBe(0);
    expect(await count(B, "public.pages", "submission_id = $1", [ids.submissionA])).toBe(0);
    expect(await count(B, "public.releases", "submission_id = $1", [ids.submissionA])).toBe(0);
    expect(await count(B, "public.comment_bank", "teacher_id = $1", [A])).toBe(0);
    expect(await count(B, "public.teachers", "id = $1", [A])).toBe(0);
  });

  it("teacher B cannot write into or modify teacher A's data", async () => {
    await expectBlocked(B, "insert into public.students (class_id, display_name) values ($1, 'Intruso')", [ids.classA]);
    await expectBlocked(B, "update public.classes set name = 'hacked' where id = $1", [ids.classA]);
    await expectBlocked(B, "delete from public.students where id = $1", [ids.studentA]);
    await expectBlocked(B, "insert into public.assignments (class_id, title, scale) values ($1, 'x', '{}')", [
      ids.classA,
    ]);
    await expectBlocked(B, "insert into public.classes (teacher_id, name) values ($1, 'spoofed owner')", [A]);
    // moving own student into A's class
    await expectBlocked(B, "update public.students set class_id = $1 where id = $2", [ids.classA, ids.studentB]);
    // linking own submission to A's student
    await expectBlocked(B, "update public.submissions set student_id = $1 where id = $2", [
      ids.studentA,
      ids.submissionB,
    ]);
    // self-granting co-teacher access
    await expectBlocked(B, "insert into public.class_teachers (class_id, teacher_id) values ($1, $2)", [ids.classA, B]);
    // A's data is untouched
    expect(await count(A, "public.classes", "name = 'Class A'")).toBe(1);
    expect(await count(A, "public.students")).toBe(1);
  });

  it("anon (no session) reads nothing", async () => {
    for (const t of CLASS_SCOPED) {
      let n = 0;
      try {
        n = await count(null, `public.${t}`);
      } catch {
        n = 0; // permission denied is also acceptable
      }
      expect(n, t).toBe(0);
    }
  });

  it("co-teacher C sees class A only, and cannot delete it", async () => {
    expect(await count(C, "public.classes")).toBe(1);
    expect(await count(C, "public.students", "class_id = $1", [ids.classA])).toBe(1);
    expect(await count(C, "public.classes", "id = $1", [ids.classB])).toBe(0);
    await expectBlocked(C, "delete from public.classes where id = $1", [ids.classA]);
  });

  it("teachers cannot change their own plan or school", async () => {
    await expectBlocked(A, "update public.teachers set plan = 'school' where id = $1", [A]);
    await as(A, (q) => q("update public.teachers set locale = 'en' where id = $1", [A]));
    expect(await count(A, "public.teachers", "locale = 'en'")).toBe(1);
  });

  it("teachers cannot write pipeline-owned grading_runs", async () => {
    await expectBlocked(
      A,
      "insert into public.grading_runs (submission_id, kind, model, prompt_version, status) values ($1, 'grade', 'm', 'v1', 'ok')",
      [ids.submissionA],
    );
  });
});

describe("RLS: Phase 2 tables", () => {
  it("imports, blind checks and mini-lessons are isolated per teacher", async () => {
    for (const t of ["pdf_imports", "blind_checks", "mini_lessons"]) {
      expect(await count(A, `public.${t}`), t).toBe(1);
    }
    expect(await count(B, "public.pdf_imports", "assignment_id = $1", [ids.assignmentA])).toBe(0);
    expect(await count(B, "public.blind_checks", "submission_id = $1", [ids.submissionA])).toBe(0);
    expect(await count(B, "public.mini_lessons", "assignment_id = $1", [ids.assignmentA])).toBe(0);
    await expectBlocked(
      B,
      "insert into public.pdf_imports (assignment_id, teacher_id, storage_path) values ($1, $2, $3)",
      [ids.assignmentA, B, `${B}/x.pdf`],
    );
    // a PDF path outside the teacher's own prefix is refused
    await expectBlocked(
      A,
      "insert into public.pdf_imports (assignment_id, teacher_id, storage_path) values ($1, $2, $3)",
      [ids.assignmentA, A, `${B}/x.pdf`],
    );
    await expectBlocked(
      B,
      `insert into public.blind_checks (submission_id, assignment_id, teacher_id, items, n_items, exact_rate, within_rate)
       values ($1, $2, $3, '[]', 0, 1, 1)`,
      [ids.submissionA, ids.assignmentA, B],
    );
  });

  it("overnight batches and style profiles are pipeline-owned", async () => {
    await expectBlocked(A, "insert into public.grading_batches (phase, submission_ids) values ('grade', '{}')");
    await expectBlocked(A, "insert into public.style_profiles (teacher_id, profile) values ($1, '{}')", [A]);
    let n = 0;
    try {
      n = await count(A, "public.grading_batches");
    } catch {
      n = 0;
    }
    expect(n).toBe(0);
  });

  it("teachers can set their blind-check rate but not beyond 50%", async () => {
    await as(A, (q) => q("update public.teachers set blind_check_pct = 10 where id = $1", [A]));
    await expectBlocked(A, "update public.teachers set blind_check_pct = 90 where id = $1", [A]);
  });
});

describe("RLS: storage namespacing", () => {
  it("teachers can only upload/read under their own user-id prefix", async () => {
    await as(A, (q) =>
      q("insert into storage.objects (bucket_id, name) values ('pages-original', $1)", [`${A}/asg/p1.jpg`]),
    );
    await expectBlocked(B, "insert into storage.objects (bucket_id, name) values ('pages-original', $1)", [
      `${A}/asg/evil.jpg`,
    ]);
    await expectBlocked(A, "insert into storage.objects (bucket_id, name) values ('pages-redacted', $1)", [
      `${A}/asg/r.jpg`,
    ]);
    expect(await count(B, "storage.objects")).toBe(0);
    expect(await count(A, "storage.objects")).toBe(1);
    const pub = await db.query(
      "select count(*)::int as n from storage.buckets where public and id in ('pages-original','pages-redacted','exports')",
    );
    expect(pub.rows[0].n).toBe(0);
  });
});
