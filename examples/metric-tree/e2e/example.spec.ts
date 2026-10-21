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
