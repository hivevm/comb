// Browser tests run against the example, served by Vite (ADR-0008).
import { defineConfig, devices } from "@playwright/test";

// Headless Chromium starts its GPU process on the display server it finds; a display forwarded
// into the Dev Container (Wayland or X11) makes that fail, and PixiJS then falls back to its
// Canvas 2D renderer without a word. Without them, WebGL2 runs on SwiftShader. A run that opens a
// window (--headed, --ui, --debug) keeps them.
const windowed =
  ["--headed", "--ui", "--debug"].some((flag) => process.argv.includes(flag)) ||
  !!process.env.PWDEBUG;
const browserEnv = windowed
  ? process.env
  : Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== "WAYLAND_DISPLAY" && name !== "DISPLAY",
      ),
    );

export default defineConfig({
  testDir: "examples/metric-tree/e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL: "http://localhost:5173" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { env: browserEnv } },
    },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
