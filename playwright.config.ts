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
      grepInvert: /@built/,
      use: { ...devices["Desktop Chrome"], launchOptions: { env: chromiumEnv(windowed) } },
    },
    // The tests tagged @built run against the example's production build, as a host ships it.
    {
      name: "chromium-built",
      grep: /@built/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5175",
        launchOptions: { env: chromiumEnv(windowed) },
      },
    },
  ],
  // Vite's test mode puts the bridge in test mode, which detaches every view kept across an
  // engine call (packages/comb/src/bridge). It serves on a port of its own, so that a server it
  // reuses is one in test mode, never the example a developer runs on 5173.
  webServer: [
    {
      command: "bun run dev --mode test --port 5174 --strictPort",
      url: "http://localhost:5174",
      reuseExistingServer: !process.env.CI,
    },
    // The build is made afresh for each run and served by `vite preview` in test mode, which only
    // puts it under the policy; the build itself is the production one the benchmark measures.
    {
      command: "bun run build && bunx --bun vite preview --mode test --port 5175 --strictPort",
      cwd: "examples/metric-tree",
      url: "http://localhost:5175",
      reuseExistingServer: false,
    },
  ],
});
