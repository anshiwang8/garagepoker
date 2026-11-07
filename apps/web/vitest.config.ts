import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests for the web app's pure logic (layout, presets, text). Browser tests live in e2e/ (Playwright). */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
