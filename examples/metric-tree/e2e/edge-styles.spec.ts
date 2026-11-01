// The edges' colours, dashes, and arrowheads, against a reference image (G-11).
import { expect, test } from "@playwright/test";
import { open } from "./shared";

test("the edges show their colours, dashes, and arrowheads", async ({ page }) => {
  // Verifies: G-11, ADR-0027
  await open(page);
  expect((await page.evaluate(() => window.inspect())).edgeTriangles).toBeGreaterThan(0);
  // The reference image, approved by eye, holds the edges alone, without the text of nodes and
  // labels, whose fonts differ between machines: grey dashed edges from bets to epics to input
  // metrics, green and red edges into and out of the north-star metric, every edge ending in an
  // arrowhead at its target.
  await page.evaluate(async () => {
    window.showLayers({ nodes: false, edgeLabels: false });
    await window.comb.whenRendered();
  });
  // Three pixels of tolerance: a single missing arrowhead differs by eight.
  await expect(page.locator("#canvas canvas")).toHaveScreenshot("metric-tree-edges.png", {
    maxDiffPixels: 3,
  });
});
