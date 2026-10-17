import { expect, test } from "@playwright/test";

test("the example draws the metric tree on a canvas beside its sidebar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#canvas canvas")).toBeVisible();
  await expect(page.locator("#count")).toHaveText("15 nodes, 15 edges");
  expect(errors).toEqual([]);
});
