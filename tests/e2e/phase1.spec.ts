import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { makePage } from "../fixtures/fake-providers";
import { gradeWithFakeProviders, latestSubmissionId, signIn } from "./helpers";

/**
 * Core loop: create an assignment → upload a photographed page → grading →
 * quick review → approve → download the marked papers as a zip named by student.
 *
 * The grading worker is simulated with the real pipeline + test-only fake
 * OCR/LLM providers (helpers.ts); everything else is the real app.
 */
test("core loop: assignment → upload → grade → review → approve → download zip", async ({ page }) => {
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

  // Quick review: see the marks, adjust a score, approve
  await page.goto(`/assignments/${assignmentId}/review`);
  await page.getByTestId("review-queue").getByText("Ana Pérez").click();
  await expect(page.getByRole("heading", { name: "Ana Pérez" })).toBeVisible();
  await expect(page.getByText("Sign error when moving 2.")).toBeVisible(); // deduction rationale shown
  const pageFigure = page.getByRole("figure", { name: "Página 1" });
  await expect(pageFigure.getByRole("button", { name: "1. Correcto: ¡Bien simplificado!", exact: true })).toBeVisible();
  // the teacher gives 1 point for the correct method
  const q2 = page.getByTestId("review-item").nth(1);
  await q2.getByRole("button", { name: "Subir puntaje" }).click();
  await q2.getByRole("button", { name: "Subir puntaje" }).click();
  await expect(q2.getByLabel("Puntaje", { exact: true })).toHaveValue("1");
  // one marked page can be downloaded straight from the review screen
  const one = await page.request.get(`/api/submissions/${submissionId}/marked.jpg?page=1`);
  expect(one.status()).toBe(200);
  expect(one.headers()["content-type"]).toBe("image/jpeg");
  expect(one.headers()["content-disposition"]).toContain(encodeURIComponent("Pérez, Ana.jpg"));
  await page.screenshot({ path: "test-results/shots/review.png", fullPage: true });
  await page.getByTestId("approve").click();
  await expect(page.getByText("Aprobado ✓")).toBeVisible();

  // Bulk download: one zip, files named last-name first
  await page.goto(`/assignments/${assignmentId}/review`);
  await expect(page.getByTestId("download-zip")).toBeVisible();
  const zipRes = await page.request.get(`/api/assignments/${assignmentId}/marked.zip`);
  expect(zipRes.status()).toBe(200);
  const files = unzipSync(new Uint8Array(await zipRes.body()));
  expect(Object.keys(files)).toEqual(["Pérez, Ana.jpg"]);
  const { writeFileSync: save } = await import("node:fs");
  save("test-results/shots/marked.jpg", files["Pérez, Ana.jpg"]);

  // Another teacher can't download it
  const other = await page.context().browser()!.newContext();
  const op = await other.newPage();
  await signIn(op, `p1-other-${Date.now()}@tinta.test`);
  expect((await op.request.get(`/api/assignments/${assignmentId}/marked.zip`)).status()).toBe(404);
  await other.close();
});
