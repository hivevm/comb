// Browser tests run against the example, served by Vite (ADR-0008).
import { defineConfig, devices } from "@playwright/test";
import { chromiumEnv } from "./bench/chromium";

// A run that opens a window (--headed, --ui, --debug) keeps the displays (bench/chromium.ts).
const windowed =
  ["--headed", "--ui", "--debug"].some((flag) => process.argv.includes(flag)) ||
  !!process.env.PWDEBUG;

export default defineConfig({
  testDir: "examples/metric-tree/e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL: "http://localhost:5174" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { env: chromiumEnv(windowed) } },
    },
  ],
  // Vite's test mode puts the bridge in test mode, which detaches every view kept across an
  // engine call (packages/comb/src/bridge). It serves on a port of its own, so that a server it
  // reuses is one in test mode, never the example a developer runs on 5173.
  webServer: {
    command: "bun run dev --mode test --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
  },
});
