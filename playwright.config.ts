// Browser tests run against the example, served by Vite (ADR-0008).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "examples/metric-tree/e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL: "http://localhost:5173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
