// Browser tests of editing the UML example's class diagram (G-12): the palette, the sidebar's
// forms, the connection and its change of kind, and the deletion, through the hooks the example
// sets under `window.uml`.
import { expect, test, type Page } from "@playwright/test";
import { NODE_WIDTH } from "../src/shared";
import { clickNode, clickWorld, drawnNode, DRAWN, open, pagePoint, setViewport } from "./shared";

/** The texts the canvas draws of node `id`. */
async function textsOf(page: Page, id: string): Promise<string[]> {
  return page.evaluate(async (wanted) => {
    await window.uml.comb.whenRendered();
    const node = window.uml.inspect().nodes.find((each) => each.id === wanted)!;
    return node.texts!.map(({ drawn }) => drawn);
  }, id);
}

/** The edges of the example's graph and the kind of each. */
async function edges(page: Page) {
  return page.evaluate(() => ({
    edges: window.uml.exampleGraph().edges,
    kinds: window.uml.edgeKinds(),
  }));
}

/** Shows node `id` near, its top-left corner at (100, 150) on the canvas, at scale 1. */
async function showNear(page: Page, id: string): Promise<void> {
  const node = (await drawnNode(page, id))!;
  await setViewport(page, { x: 100 - node.x, y: 150 - node.y, scale: 1 });
}

test("an interface dropped from the palette is a node of «interface» and a default name under the pointer", async ({
  page,
}) => {
  // Verifies: G-12, G-1
  await page.goto("/");
  await open(page);
  await setViewport(page, { x: 0, y: 0, scale: 1 });
  const canvas = page.locator("#canvas canvas");
  await page
    .locator('#palette [data-kind="interface"]')
    .dragTo(canvas, { targetPosition: { x: 400, y: 500 } });
  const added = await page.evaluate(() => window.uml.exampleGraph().nodes.at(-1)!);
  expect(added.id).toBe("interface-1");
  expect(await textsOf(page, added.id)).toEqual(["«interface»", "NewInterface"]);
  expect(await page.evaluate(() => window.uml.nodeKinds()["interface-1"])).toBe("interface");
  // Centred on the drop, by the height Comb gives its content.
  const drawn = (await drawnNode(page, added.id))!;
  const centre = await pagePoint(page, drawn.x + NODE_WIDTH / 2, drawn.y + drawn.height / 2);
  const box = (await canvas.boundingBox())!;
  expect(centre.x - box.x).toBeCloseTo(400, 0);
  expect(centre.y - box.y).toBeCloseTo(500, 0);
});

test("an operation added in the sidebar is a row of the node, which grows by its height", async ({
  page,
}) => {
  // Verifies: G-12, G-5
  await page.goto("/");
  await open(page);
  await showNear(page, "IconError");
  const before = (await drawnNode(page, "IconError"))!;
  await clickNode(page, "IconError");
  await expect(page.locator("#name")).toHaveValue("IconError");
  await expect(page.locator("#attributes")).toHaveValue("+reason: IconProblem");
  await page.locator("#operations").fill("+toString(): string");
  expect(await textsOf(page, "IconError")).toEqual([
    "IconError",
    "+reason: IconProblem",
    "+toString(): string",
  ]);
  const after = (await drawnNode(page, "IconError"))!;
  // One body row more: the height of a node of two body rows less that of one, as Comb lays out.
  const row = await page.evaluate((width) => {
    const text = (role: "title" | "body") => [{ kind: "text" as const, role, text: "x" }];
    const heightOf = (rows: number) =>
      window.uml.comb.heightOf(
        [text("title"), ...Array.from({ length: rows }, () => text("body"))],
        width,
      );
    return heightOf(2) - heightOf(1);
  }, NODE_WIDTH);
  expect(row).toBeGreaterThan(0);
  expect(after.height).toBe(before.height + row);
});

test("a connection adds an association, which the sidebar changes to a generalization", async ({
  page,
}) => {
  // Verifies: G-12, G-3
  await page.goto("/");
  await open(page);
  await showNear(page, "IconError");
  const [from, to] = [
    (await drawnNode(page, "IconError"))!,
    (await drawnNode(page, "RendererUnavailableError"))!,
  ];
  // From IconError's right connector to RendererUnavailableError's left one.
  const start = await pagePoint(page, from.x + from.width, from.y + from.height / 2);
  const end = await pagePoint(page, to.x, to.y + to.height / 2);
  await page.mouse.move(start.x - 20, start.y);
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  const connected = await edges(page);
  const added = connected.edges.find(
    (each) => each.source === "IconError" && each.target === "RendererUnavailableError",
  )!;
  expect(connected.kinds[added.id]).toBe("association");
  const association = DRAWN.association!;
  expect(added).toMatchObject({ color: association.color, arrow: association.arrow });
  expect(added.dash).toBeUndefined();
  // Selected on its path, the sidebar changes it to a generalization.
  await clickWorld(page, (from.x + from.width + to.x) / 2, from.y + from.height / 2);
  await expect(page.locator("#kind")).toHaveValue("association");
  await page.locator("#kind").selectOption("generalization");
  const changed = await edges(page);
  const edge = changed.edges.find(({ id }) => id === added.id)!;
  const generalization = DRAWN.generalization!;
  expect(changed.kinds[added.id]).toBe("generalization");
  expect(edge).toMatchObject({ color: generalization.color, arrow: generalization.arrow });
  expect(edge.dash).toBeUndefined();
  expect(edge.label).toBeUndefined();
});

test("no edge joins a class with itself: Comb offers the loop, and the rules refuse it", async ({
  page,
}) => {
  // Verifies: G-12, G-3
  await page.goto("/");
  await open(page);
  await showNear(page, "Error");
  const before = await edges(page);
  const node = (await drawnNode(page, "Error"))!;
  // From Error's right connector back onto its bottom one.
  const start = await pagePoint(page, node.x + node.width, node.y + node.height / 2);
  const end = await pagePoint(page, node.x + node.width / 2, node.y + node.height);
  await page.mouse.move(start.x - 20, start.y);
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const offered = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return window.uml
      .inspect()
      .connectors.filter(({ node: owner, compatible }) => owner === "Error" && compatible)
      .map(({ side }) => side);
  });
  await page.mouse.up();
  // Comb allows loops, for the state diagram, and offers Error's other connectors; the rules of
  // the class diagram refuse the loop in the veto.
  expect(offered).toEqual(["top", "bottom", "left"]);
  expect(await edges(page)).toEqual(before);
});

test("Delete removes the selected class with its relationships", async ({ page }) => {
  // Verifies: G-12, G-4
  await page.goto("/");
  await open(page);
  await showNear(page, "Error");
  const touching = (await edges(page)).edges
    .filter(({ source, target }) => source === "Error" || target === "Error")
    .map(({ id }) => id);
  expect(touching.length).toBe(5);
  await clickNode(page, "Error");
  await expect(page.locator("#name")).toHaveValue("Error");
  await page.keyboard.press("Delete");
  const { nodes, edges: drawn } = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return {
      nodes: window.uml.exampleGraph().nodes.map(({ id }) => id),
      edges: window.uml.inspect().edges.map(({ id }) => id),
    };
  });
  expect(nodes).not.toContain("Error");
  for (const id of touching) expect(drawn).not.toContain(id);
  const left = await edges(page);
  for (const id of touching) expect(left.kinds[id]).toBeUndefined();
  await expect(page.locator("#node-form")).toBeHidden();
});

test("an edit Comb refuses changes neither the canvas nor the example's copy, and throws nothing on the page", async ({
  page,
}) => {
  // Verifies: G-12
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await open(page);
  await showNear(page, "IconError");
  await clickNode(page, "IconError");
  // A title of more than the 1,000 code units a text of content may hold.
  await page.locator("#name").fill("x".repeat(1001));
  expect(await textsOf(page, "IconError")).toEqual(["IconError", "+reason: IconProblem"]);
  await clickWorld(page, -2000, -2000);
  await clickNode(page, "IconError");
  await expect(page.locator("#name")).toHaveValue("IconError");
  expect(errors).toEqual([]);
});

test("a class whose stereotype the user types as «package» is still a class the sidebar edits", async ({
  page,
}) => {
  // Verifies: G-12, G-5
  await page.goto("/");
  await open(page);
  await showNear(page, "IconError");
  await clickNode(page, "IconError");
  await page.locator("#stereotype").fill("«package»");
  expect(await textsOf(page, "IconError")).toEqual([
    "«package»",
    "IconError",
    "+reason: IconProblem",
  ]);
  await clickWorld(page, -2000, -2000);
  await clickNode(page, "IconError");
  await expect(page.locator("#stereotype")).toHaveValue("«package»");
  await expect(page.locator("#attributes")).toHaveValue("+reason: IconProblem");
  for (const field of ["#stereotype", "#attributes", "#operations"])
    await expect(page.locator(field)).toBeVisible();
  expect(await page.evaluate(() => window.uml.nodeKinds()["IconError"])).toBe("class");
});

test("a change of kind Comb refuses leaves the example's copy with the old kind, and throws nothing on the page", async ({
  page,
}) => {
  // Verifies: G-12
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await open(page);
  await showNear(page, "IconError");
  const [from, to] = [
    (await drawnNode(page, "IconError"))!,
    (await drawnNode(page, "RendererUnavailableError"))!,
  ];
  // A connection from IconError's right connector to RendererUnavailableError's left one.
  const start = await pagePoint(page, from.x + from.width, from.y + from.height / 2);
  const end = await pagePoint(page, to.x, to.y + to.height / 2);
  await page.mouse.move(start.x - 20, start.y);
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await clickWorld(page, (from.x + from.width + to.x) / 2, from.y + from.height / 2);
  await expect(page.locator("#kind")).toHaveValue("association");
  const before = await edges(page);
  // Comb's updateEdge, wrapped to refuse every change from here on.
  await page.evaluate(() => {
    window.uml.comb.updateEdge = () => {
      throw new Error("refused");
    };
  });
  await page.locator("#kind").selectOption("generalization");
  expect(await edges(page)).toEqual(before);
  expect(errors).toEqual([]);
});
