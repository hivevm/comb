// Browser tests run against the examples, each served by Vite (ADR-0008): the metric tree's by the
// projects chromium and chromium-built, the UML example's by the project uml.
import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";
import { chromiumEnv } from "./bench/chromium";

// The three servers listen on ports the system had free when the run began, so that runs in two
// worktrees at once neither collide nor test each other's tree. Playwright loads this file in its
// runner and again in each worker, which inherits the runner's environment: the first load
// chooses them and hands them on in COMB_TEST_PORTS, as "dev,built,uml". A child process asks
// the system for them, since a port is had only by listening, which a file loaded at once cannot
// wait on.
const FREE_PORTS = `
  const net = require("node:net");
  const listening = () => new Promise((resolve, reject) => {
    const server = net.createServer().once("error", reject);
    server.listen(0, () => resolve(server));
  });
  Promise.all([listening(), listening(), listening()]).then((servers) => {
    console.log(servers.map((server) => server.address().port).join(","));
    for (const server of servers) server.close();
  });
`;
process.env.COMB_TEST_PORTS ??= execFileSync(process.execPath, ["-e", FREE_PORTS], {
  encoding: "utf8",
}).trim();
const ports = process.env.COMB_TEST_PORTS.split(",").map(Number);
if (ports.length !== 3 || !ports.every((port) => Number.isInteger(port) && port > 0))
  throw new Error(`COMB_TEST_PORTS is "${process.env.COMB_TEST_PORTS}", not three ports`);
const [dev, built, uml] = ports;

// A run that opens a window (--headed, --ui, --debug) keeps the displays (bench/chromium.ts).
const windowed =
  ["--headed", "--ui", "--debug"].some((flag) => process.argv.includes(flag)) ||
  !!process.env.PWDEBUG;

export default defineConfig({
  testDir: "examples/metric-tree/e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL: `http://localhost:${dev}` },
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
        baseURL: `http://localhost:${built}`,
        launchOptions: { env: chromiumEnv(windowed) },
      },
    },
    {
      name: "uml",
      testDir: "examples/uml/e2e",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${uml}`,
        launchOptions: { env: chromiumEnv(windowed) },
      },
    },
  ],
  // Vite's test mode puts the bridge in test mode, which detaches every view kept across an
  // engine call (packages/comb/src/bridge). It serves on a port of its own, never the 5173 of the
  // example a developer runs. Each run starts its own servers and reuses none: on ports chosen
  // free, a server already listening is one that took the port in between, perhaps another
  // worktree's, and would be tested in place of this tree.
  webServer: [
    {
      command: `bun run dev --mode test --port ${dev} --strictPort`,
      url: `http://localhost:${dev}`,
      reuseExistingServer: false,
    },
    // The build is made afresh for each run and served by `vite preview` in test mode, which only
    // puts it under the policy; the build itself is the production one the benchmark measures.
    {
      command: `bun run build && bunx --bun vite preview --mode test --port ${built} --strictPort`,
      cwd: "examples/metric-tree",
      url: `http://localhost:${built}`,
      reuseExistingServer: false,
    },
    // The UML example in test mode, under the policy, on a port of its own, never its 5176.
    {
      command: `bunx --bun vite --mode test --port ${uml} --strictPort`,
      cwd: "examples/uml",
      url: `http://localhost:${uml}`,
      reuseExistingServer: false,
    },
  ],
});
