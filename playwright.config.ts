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
  use: { baseURL: "http://localhost:5173" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { env: chromiumEnv(windowed) } },
    },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
