import { defineConfig } from "@playwright/test";

/**
 * Browser tests against the dev-only table previews (/dev/table-states) and
 * the home page: `pnpm --filter web e2e`. Uses the installed Google Chrome, so
 * no browser download is needed. Starts `next dev` unless one is running.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", channel: "chrome" },
  webServer: { command: "pnpm dev --port 3000", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "small-mobile", use: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true } },
  ],
});
