import { defineConfig } from "@playwright/test";

/**
 * E2E tests for the Rule Engine Obsidian plugin.
 *
 * These tests drive the REAL Obsidian Electron app via Chrome DevTools Protocol (CDP).
 * No browser binaries need to be installed — Playwright connects to the already-running
 * Obsidian process over its --remote-debugging-port.
 *
 * CI requirements:
 *   - Linux: Obsidian needs a virtual display. Run `Xvfb :99 -screen 0 1280x800x24 &`
 *     before the test run, or use the provided Dockerfile.e2e.
 *   - Set OBSIDIAN_BIN to the path of the Obsidian executable if it differs from default.
 *   - Set CDP_PORT to override the default debugging port (9223).
 *
 * Local quick-start:
 *   npm run build && npx playwright test
 */
export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Single worker: Obsidian is a single app instance shared across all tests
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    // No browser launch config — we use connectOverCDP in fixtures
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "e2e/test-results",
});
