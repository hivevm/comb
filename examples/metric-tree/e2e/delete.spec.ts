// The user deletes the selection with Delete or Backspace on the focused canvas, unless the host
// application's `canDelete` refuses (G-4, ADR-0023): a node with every edge at it, or an edge
// alone, told as `by: "user"`, the selection cleared.
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
import { NODE_HEIGHT, NODE_WIDTH, open, screenCentre, setViewport } from "./shared";

const node = (id: string, x = 0, y = 0) => ({
  id,
  title: id,
  x,
  y,
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
});

/** Node `a` between `b` and `c`, an edge from `b` to `a` and one from `a` to `c`, and one from `b`
 *  to `c` below them. */
const ROW: GraphData = {
  nodes: [node("b"), node("a", 400), node("c", 800)],
  edges: [
    { id: "b-a", source: "b", target: "a" },
    { id: "a-c", source: "a", target: "c" },
    { id: "b-c", source: "b", target: "c" },
  ],
};

/** Loads ROW as the example's own at a scale of 0.8, recording each change and selection into
 *  `window.told`, the selections as `selection <id or null>`. */
async function loaded(page: Page): Promise<void> {
  await page.evaluate(async (graph) => {
    window.useGraph(graph);
    const w = window as unknown as { told: unknown[] };
    w.told = [];
    window.comb.onChange((change) => w.told.push(change));
    window.comb.onSelectionChange((selection) => w.told.push(`selection ${selection?.id ?? null}`));
    await window.comb.whenRendered();
  }, ROW);
  await setViewport(page, { x: 40, y: 200, scale: 0.8 });
}

/** What the canvas draws once it has drawn, and what was told since the load. */
async function state(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    const { nodes, edges } = window.inspect();
    return {
      nodes: nodes.map(({ id }) => id).sort(),
      edges: edges.map(({ id }) => id).sort(),
      told: (window as unknown as { told: unknown[] }).told,
    };
  });
}

/** Clicks the screen point at which the canvas shows the world point `(x, y)`. */
async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const at = await page.evaluate(
    ({ x, y }) => {
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const screen = window.screenPoint(x, y);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    },
    { x, y },
  );
  await page.mouse.click(at.x, at.y);
}

async function selectNode(page: Page, id: string): Promise<void> {
  const at = await screenCentre(page, id);
  await page.mouse.click(at.x, at.y);
}

test("Delete removes a selected node with both its edges, as the user's, and clears the selection", async ({
  page,
}) => {
  // Verifies: G-4, ADR-0023
  await open(page);
  await loaded(page);
  await selectNode(page, "a");
  await page.keyboard.press("Delete");
  expect(await state(page)).toEqual({
    nodes: ["b", "c"],
    edges: ["b-c"],
    told: [
      "selection a",
      { kind: "nodesRemoved", by: "user", nodes: ["a"], edges: ["b-a", "a-c"] },
      "selection null",
    ],
  });
  await expect(page.locator("#count")).toHaveText("2 nodes, 1 edges");
});

test("Backspace removes a selected edge alone, and its default action is prevented", async ({
  page,
}) => {
  // Verifies: G-4, ADR-0023
  await open(page);
  await loaded(page);
  await page.evaluate(() => {
    const w = window as unknown as { prevented: boolean[] };
    w.prevented = [];
    window.addEventListener("keydown", (event) => w.prevented.push(event.defaultPrevented));
  });
  // On the edge from b to c, which runs straight along y = 32 under a.
  await clickWorld(page, 300, 32);
  await page.keyboard.press("Backspace");
  const result = await state(page);
  expect(result.nodes).toEqual(["a", "b", "c"]);
  expect(result.edges).toEqual(["a-c", "b-a"]);
  expect(result.told).toEqual([
    "selection b-c",
    { kind: "edgesRemoved", by: "user", edges: ["b-c"] },
    "selection null",
  ]);
  const prevented = await page.evaluate(
    () => (window as unknown as { prevented: boolean[] }).prevented,
  );
  expect(prevented).toEqual([true]);
});

for (const name of ["false", "undefined", "a truthy value that is not true", "a throw"] as const) {
  test(`canDelete returning ${name} deletes nothing and tells nothing`, async ({ page }) => {
    // Verifies: ADR-0023
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await loaded(page);
    await page.evaluate((name) => {
      const asked: unknown[] = [];
      (window as unknown as { asked: unknown[] }).asked = asked;
      const results: Record<string, () => unknown> = {
        false: () => false,
        undefined: () => undefined,
        "a truthy value that is not true": () => 1,
        "a throw": () => {
          throw new Error("host veto");
        },
      };
      window.canDelete = (deletion) => (asked.push(deletion), results[name]!());
    }, name);
    await selectNode(page, "a");
    await page.keyboard.press("Delete");
    const result = await state(page);
    expect(result.nodes).toEqual(["a", "b", "c"]);
    expect(result.told).toEqual(["selection a"]);
    const asked = await page.evaluate(() => (window as unknown as { asked: unknown[] }).asked);
    expect(asked).toEqual([{ nodes: ["a"], edges: ["b-a", "a-c"] }]);
    expect(errors).toEqual(name === "a throw" ? ["host veto"] : []);
  });
}

test("canDelete returning true deletes, and a host's own removal never asks it", async ({
  page,
}) => {
  // Verifies: ADR-0023
  await open(page);
  await loaded(page);
  await page.evaluate(() => {
    const w = window as unknown as { asked: number };
    w.asked = 0;
    window.canDelete = () => ((w.asked += 1), true);
  });
  await selectNode(page, "a");
  await page.keyboard.press("Delete");
  await page.evaluate(() => window.comb.removeNodes(["b"]));
  const result = await state(page);
  expect(result.nodes).toEqual(["c"]);
  expect(await page.evaluate(() => (window as unknown as { asked: number }).asked)).toBe(1);
});

test("Delete with the focus outside the canvas deletes nothing", async ({ page }) => {
  // Verifies: ADR-0023
  await open(page);
  await loaded(page);
  await selectNode(page, "a");
  await page.locator("#title").focus();
  await page.keyboard.press("Delete");
  const result = await state(page);
  expect(result.nodes).toEqual(["a", "b", "c"]);
  expect(result.told).toEqual(["selection a"]);
});

test("a veto that adds an edge itself refuses the deletion, and Comb and the engine stay in step", async ({
  page,
}) => {
  // Verifies: ADR-0023, ADR-0022
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page);
  await page.evaluate(() => {
    window.canDelete = () => {
      window.comb.addEdge({ id: "x", source: "a", target: "b" });
      return true;
    };
  });
  await selectNode(page, "a");
  await page.keyboard.press("Delete");
  const result = await state(page);
  expect(result.nodes).toEqual(["a", "b", "c"]);
  expect(result.edges).toEqual(["a-c", "b-a", "b-c", "x"]);
  // The edge the veto added is the store's and the engine's alike: a patch of it is taken.
  await page.evaluate(() => window.comb.updateEdge("x", { color: 0x2060e0 }));
  expect(errors).toEqual([]);
});

test("a Delete held down deletes once, and with a modifier not at all", async ({ page }) => {
  // Verifies: ADR-0023
  await open(page);
  await loaded(page);
  await page.evaluate(() => {
    const w = window as unknown as { asked: number };
    w.asked = 0;
    window.canDelete = () => ((w.asked += 1), false);
  });
  await selectNode(page, "a");
  await page.keyboard.down("Delete");
  await page.keyboard.down("Delete");
  await page.keyboard.down("Delete");
  await page.keyboard.up("Delete");
  await page.keyboard.press("Control+Backspace");
  expect(await page.evaluate(() => (window as unknown as { asked: number }).asked)).toBe(1);
});
