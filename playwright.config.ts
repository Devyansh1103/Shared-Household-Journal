import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (A6, from Phase 8). They need the local Supabase stack
// (`npm run db:start`) and a production build (`npm run build`); the server is
// started on port 3100 if it isn't already running.
//
// Browser: set PLAYWRIGHT_CHANNEL to use an installed browser (e.g. "msedge"
// or "chrome"); otherwise install one with `npx playwright install chromium`.

const PORT = 3100;
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;

export default defineConfig({
  testDir: "e2e",
  // The tests share one local database; run them one at a time.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel } },
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
