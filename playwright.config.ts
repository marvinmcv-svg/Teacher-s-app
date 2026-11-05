import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// E2E runs against a production build and a local Supabase stack
// (`pnpm dlx supabase start`). See README → Testing.
const PORT = 3000;
const baseURL = `http://127.0.0.1:${PORT}`;

// The test process needs the same env as the app (Supabase URL + service key for
// the simulated grading worker in tests/e2e/helpers.ts).
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL, trace: "retain-on-failure", locale: "es-BO" },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `pnpm start --hostname 127.0.0.1 --port ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
});
