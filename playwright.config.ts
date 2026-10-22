import { defineConfig, devices } from "@playwright/test";

// Several dev servers share this machine, so the suite stays off :3000.
const port = Number(process.env.E2E_PORT ?? 3142);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker everywhere: the visibility-toggle spec mutates the org row
  // every other spec reads, and the storage-state cache is written unlocked.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Set E2E_BASE_URL to run against a server that is already up.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next build && npx next start -p ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 240_000,
      },
});
