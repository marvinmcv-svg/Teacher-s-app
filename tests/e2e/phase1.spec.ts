import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makePage } from "../fixtures/fake-providers";
import { gradeWithFakeProviders, latestSubmissionId, signIn } from "./helpers";

/**
 * Phase 1 core loop (§11): create an assignment → upload a photographed page →
 * grading → review (red items must be checked) → approve → release → the
 * student opens their annotated feedback on a phone.
 *
 * The grading worker is simulated with the real pipeline + test-only fake
 * OCR/LLM providers (helpers.ts); everything else is the real app.
 */
test("core loop: assignment → scan → grade → review → approve → release → student view", async ({ page, browser }) => {
  const email = `p1-${Date.now()}@tinta.test`;
  await signIn(page, email);

  // Class + roster
  await page.getByRole("link", { name: "Nueva clase" }).first().click();
  await page.getByLabel("Nombre de la clase").fill("6.º B");
  await page.getByRole("button", { name: "Crear clase" }).click();
  await page.getByLabel("Un nombre por línea").fill("Ana Pérez\nLuis Mamani");
  await page.getByRole("button", { name: "Agregar a la clase" }).click();
  await expect(page.getByTestId("student-count")).toHaveText("2 estudiantes");

  // Assignment wizard (typed key)
  await page.getByRole("link", { name: "Nueva tarea" }).click();
  await page.getByLabel("Título").fill("Fracciones y ecuaciones");
  await page.getByRole("button", { name: "Siguiente" }).click();
  const rows = page.getByTestId("question-row");
  await rows.nth(0).getByLabel("Tipo").selectOption("numeric");
  await rows.nth(0).getByLabel("Puntos").fill("2");
  await rows.nth(0).getByLabel("Respuesta correcta").fill("3/4");
  await page.getByRole("button", { name: "Agregar pregunta" }).click();
  await rows.nth(1).getByLabel("Tipo").selectOption("math_steps");
  await rows.nth(1).getByLabel("Puntos").fill("3");
  await rows.nth(1).getByLabel("Respuesta correcta").fill("x = 3");
  await expect(page.getByText("5 puntos en total")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible();
  await page.getByRole("button", { name: "Crear tarea" }).click();
  await expect(page.getByRole("heading", { name: "Fracciones y ecuaciones" })).toBeVisible();
  const assignmentId = page.url().split("/assignments/")[1];

  // Scan → bulk upload one photographed page (camera isn't available headless)
  await page.getByRole("link", { name: "Escanear papeles" }).click();
  const dir = path.join("test-results", "fixtures");
  mkdirSync(dir, { recursive: true });
  const photo = path.join(dir, "page.jpg");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(photo, await makePage(["Nombre: Ana Pérez", "1) 3/4", "2) x = 7"]));
  await page.getByText("Subir fotos").click();
  await page.getByLabel("Subir fotos").setInputFiles(photo);
  await expect(page.getByTestId("upload-queue")).toContainText("Subido", { timeout: 30_000 });

  // The grading worker (simulated): real pipeline, fake providers
  const submissionId = await latestSubmissionId(assignmentId);
  gradeWithFakeProviders(submissionId);

  // Hub: name-reading suggestion → teacher confirms
  await page.goto(`/assignments/${assignmentId}`);
  await expect(page.getByText("¿Es Ana Pérez?")).toBeVisible();
  await page.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByTestId("submission-list")).toContainText("Ana Pérez");
  await expect(page.getByTestId("submission-list")).toContainText("Revisión obligatoria");

  // Review: the harsh/disputed item blocks approval until checked
  await page.goto(`/assignments/${assignmentId}/review`);
  await page.getByTestId("review-queue").getByText("Ana Pérez").click();
  await expect(page.getByRole("heading", { name: "Ana Pérez" })).toBeVisible();
  await expect(page.getByText("Las dos revisiones no coinciden")).toBeVisible();
  await expect(page.getByText("Sign error when moving 2.")).toBeVisible(); // deduction rationale expanded by default
  const approve = page.getByTestId("approve");
  await expect(approve).toBeDisabled();
  await expect(page.getByText("Falta revisar 1 pregunta marcada")).toBeVisible();
  // the teacher gives 1 point for the correct method
  const q2 = page.getByTestId("review-item").nth(1);
  await q2.getByRole("button", { name: "Subir puntaje" }).click();
  await expect(q2.getByLabel("Puntaje", { exact: true })).toHaveValue("0.5");
  await q2.getByRole("button", { name: "Subir puntaje" }).click();
  await expect(approve).toBeEnabled();
  // pins anchored on the page
  const pageFigure = page.getByRole("figure", { name: "Página 1" });
  await expect(pageFigure.getByRole("button", { name: "1. Correcto: ¡Bien simplificado!", exact: true })).toBeVisible();
  await expect(
    pageFigure.getByRole("button", { name: "2. Error: Revisa el signo al pasar el 2.", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/shots/review.png", fullPage: true });
  await approve.click();
  await expect(page.getByText("Aprobado ✓")).toBeVisible();

  // Release
  await page.goto(`/assignments/${assignmentId}/release`);
  await expect(page.getByText("1 trabajo aprobado listo para publicar")).toBeVisible();
  await page.getByRole("button", { name: "Publicar todos los aprobados" }).click();
  const copy = page.getByTestId("copy-link");
  await expect(copy).toBeVisible();
  const studentUrl = await copy.getAttribute("data-url");
  expect(studentUrl).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);

  // Gradebook CSV has the teacher-approved grade (3 of 5 → 60 on 1–100)
  const csv = await page.request.get(`/api/assignments/${assignmentId}/export.csv`);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain("Ana Pérez");
  expect(text).toMatch(/Ana Pérez,,2,1,3,5,60,1/);

  // Student opens the link on a phone — no login
  const studentCtx = await browser.newContext({ locale: "en-US" }); // viewer language doesn't matter
  const s = await studentCtx.newPage();
  await s.goto(studentUrl!);
  await expect(s.getByRole("heading", { name: "Fracciones y ecuaciones" })).toBeVisible();
  await expect(s.getByTestId("student-grade")).toContainText("60");
  await expect(s.getByText("Lo que hiciste bien")).toBeVisible(); // rendered in the student's feedback language (es)
  await expect(s.getByText("Fracción correcta en la 1.")).toBeVisible();
  await expect(s.getByText("Revisa el signo al pasar el 2.").first()).toBeVisible();
  await expect(s.getByText(/usó un asistente de IA/)).toBeVisible();
  await s.screenshot({ path: "test-results/shots/student.png", fullPage: true });
  const pdf = await s.request.get(`${studentUrl}/annotated.pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  // A made-up token shows nothing (in the viewer's language — there is no student to infer one from)
  await s.goto(studentUrl!.replace(/.{6}$/, "AAAAAA"));
  await expect(s.getByRole("heading", { name: "Link unavailable" })).toBeVisible();
  await expect(s.getByText("Fracciones y ecuaciones")).toHaveCount(0);
  await studentCtx.close();
});
