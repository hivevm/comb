import { expect, test } from "@playwright/test";
import { open, POLICY } from "./shared";

test("the example draws the metric tree on a canvas beside its sidebar", async ({ page }) => {
  // Verifies: ADR-0008 — the golden path, built, served, and driven by the toolchain it decides.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Verifies: Q-6 — every browser test runs under the policy the test server sends.
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toBe(POLICY);
  await open(page);
  await expect(page.locator("#canvas canvas")).toBeVisible();
  await expect(page.locator("#count")).toHaveText("15 nodes, 15 edges");
  // WebGL2, not PixiJS's Canvas 2D fallback, which draws no edge mesh.
  expect(await page.evaluate(() => window.inspect().renderer)).toBe("webgl");
  // The bridge in test mode, so that a view kept across an engine call fails the suite.
  expect(await page.evaluate(() => window.testMode())).toBe(true);
  expect(errors).toEqual([]);
});

test("the copies query parameter sets the size without the control", async ({ page }) => {
  await open(page, "?copies=10");
  await expect(page.locator("#copies")).toHaveValue("10");
  await expect(page.locator("#count")).toHaveText("150 nodes, 150 edges");
  expect((await page.evaluate(() => window.loadReport)).nodes).toBe(150);
});

test("picking the largest copies option shows at least 50,000 nodes and edges", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  const largest = await page
    .locator("#copies option")
    .evaluateAll((options) => (options.at(-1) as HTMLOptionElement).value);
  await page.locator("#copies").selectOption(largest);
  const report = await page.evaluate(() => window.loadReport);
  expect(report.nodes).toBeGreaterThanOrEqual(50_000);
  expect(report.edges).toBeGreaterThanOrEqual(50_000);
  await expect(page.locator("#count")).toHaveText(`${report.nodes} nodes, ${report.edges} edges`);
  // Shown, not only loaded: the canvas draws every node and edge, since all are in view, at the
  // far level: nodes as particles, no text, and a number of display objects that does not grow
  // with the graph, apart from the one particle container.
  const drawn = await page.evaluate(() => {
    const snapshot = window.inspect();
    return {
      level: snapshot.level,
      nodes: snapshot.nodes.length,
      particles: snapshot.particles,
      edges: snapshot.edges.length,
      texts: snapshot.texts,
    };
  });
  expect(drawn).toEqual({
    level: "far",
    nodes: report.nodes,
    particles: report.nodes,
    edges: report.edges,
    texts: 0,
  });
  // Verifies: ADR-0027
  // The world, the edges layer and its mesh, the particle container, and the empty layers of
  // node views and labels.
  expect(await page.evaluate(() => window.inspect().displayObjects)).toBe(6);
});
