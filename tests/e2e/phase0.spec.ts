import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Phase 0 happy path (§11): a teacher signs in (magic link), switches
 * language, creates a class and adds students by pasting a list. Also checks
 * that a second teacher cannot open the first teacher's class.
 *
 * Needs a local Supabase stack with Mailpit (`pnpm dlx supabase start`).
 */
test("teacher signs in, switches language, creates a class and adds students", async ({ page }) => {
  const email = `teacher-${Date.now()}@tinta.test`;

  await page.goto("/login");
  // Spanish by default (Accept-Language es-BO)
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  await page.getByTestId("language-switcher").selectOption("en");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByTestId("language-switcher").selectOption("es");
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();

  await signIn(page, email);
  await expect(page.getByText("Aún no tienes clases")).toBeVisible();

  await page.getByRole("link", { name: "Nueva clase" }).first().click();
  await page.getByLabel("Nombre de la clase").fill("5.º A — Matemáticas");
  await page.getByLabel("Materia").fill("Matemáticas");
  await page.getByRole("button", { name: "Crear clase" }).click();
  await expect(page.getByRole("heading", { name: "5.º A — Matemáticas" })).toBeVisible();

  await page.getByLabel("Un nombre por línea").fill("1. Ana Pérez\n2. Luis Mamani\n3. Sofía Quispe\nana perez\n");
  await page.getByRole("button", { name: "Agregar a la clase" }).click();
  await expect(page.getByTestId("roster-result")).toContainText("Se agregaron 3 estudiantes");
  await expect(page.getByTestId("student-count")).toHaveText("3 estudiantes");
  await expect(page.getByTestId("student-list")).toContainText("Sofía Quispe");

  // Remove + undo
  await page.getByRole("button", { name: "Quitar a Luis Mamani" }).click();
  await expect(page.getByTestId("student-count")).toHaveText("2 estudiantes");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByTestId("student-count")).toHaveText("3 estudiantes");

  // Switch the UI to English while signed in (persists to profile)
  await page.getByTestId("language-switcher").selectOption("en");
  await expect(page.getByTestId("student-count")).toHaveText("3 students");

  // Home lists the class with its count
  await page.goto("/");
  await expect(page.getByText("5.º A — Matemáticas")).toBeVisible();
  await expect(page.getByText("3 students")).toBeVisible();
});

test("a second teacher cannot open the first teacher's class", async ({ browser }) => {
  const ctxA = await browser.newContext({ locale: "es-BO" });
  const a = await ctxA.newPage();
  await signIn(a, `owner-${Date.now()}@tinta.test`);
  await a.goto("/classes/new");
  await a.getByLabel("Nombre de la clase").fill("Clase privada");
  await a.getByRole("button", { name: "Crear clase" }).click();
  await expect(a.getByRole("heading", { name: "Clase privada" })).toBeVisible();
  const classUrl = a.url();

  const ctxB = await browser.newContext({ locale: "es-BO" });
  const b = await ctxB.newPage();
  await signIn(b, `other-${Date.now()}@tinta.test`);
  const res = await b.goto(classUrl);
  expect(res?.status()).toBe(404);
  await expect(b.getByText("Clase privada")).toHaveCount(0);
  await b.goto("/");
  await expect(b.getByText("Aún no tienes clases")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test("anonymous visitors are sent to sign in", async ({ page }) => {
  await page.goto("/classes/new");
  await expect(page).toHaveURL(/\/login\?next=%2Fclasses%2Fnew/);
});
