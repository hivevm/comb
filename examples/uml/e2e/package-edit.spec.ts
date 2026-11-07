// Browser tests of editing the UML example's package diagram (G-12): the palette's package, the
// sidebar's name of a package and «import» or «use» of a dependency, a connection that adds a
// dependency «use», none of a package with itself, and the edits each diagram keeps.
import { expect, test, type Page } from "@playwright/test";
import { NODE_WIDTH } from "../src/shared";
import { clickNode, clickWorld, drawnNode, DRAWN, open, pagePoint, setViewport } from "./shared";

/** Chooses `diagram` in the sidebar and waits until its load has drawn. */
async function choose(page: Page, diagram: "class" | "package"): Promise<void> {
  await page.locator("#diagram").selectOption(diagram);
  await page.evaluate(() => window.uml.loadReport);
}

/** The texts the canvas draws of node `id`. */
async function textsOf(page: Page, id: string): Promise<string[]> {
  return page.evaluate(async (wanted) => {
    await window.uml.comb.whenRendered();
    const node = window.uml.inspect().nodes.find((each) => each.id === wanted)!;
    return node.texts!.map(({ drawn }) => drawn);
  }, id);
}

/** The example's copy of the graph and the kind of each edge. */
async function state(page: Page) {
  return page.evaluate(() => ({
    graph: window.uml.exampleGraph(),
    kinds: window.uml.edgeKinds(),
  }));
}

/** Shows node `id` near, its top-left corner at (100, 150) on the canvas, at scale 1. */
async function showNear(page: Page, id: string): Promise<void> {
  const node = (await drawnNode(page, id))!;
  await setViewport(page, { x: 100 - node.x, y: 150 - node.y, scale: 1 });
}

/** Drags a connection from the world point `from`, a connector, to the world point `to`. */
async function connect(page: Page, from: [number, number], to: [number, number]) {
  const [start, end] = [await pagePoint(page, ...from), await pagePoint(page, ...to)];
  await page.mouse.move(start.x - 20, start.y);
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/** Drops the palette's `kind` on the canvas at (400, 500), the view at the origin at scale 1. */
async function dropAt(page: Page, kind: string): Promise<void> {
  await setViewport(page, { x: 0, y: 0, scale: 1 });
  await page
    .locator(`#palette [data-kind="${kind}"]`)
    .dragTo(page.locator("#canvas canvas"), { targetPosition: { x: 400, y: 500 } });
}

test("a package dropped from the palette is a node of «package» and a default name under the pointer", async ({
  page,
}) => {
  // Verifies: G-12, G-1
  await page.goto("/");
  await open(page);
  await choose(page, "package");
  // The palette offers the package alone while the package diagram is shown.
  await expect(page.locator("#palette li:visible")).toHaveText(["Package"]);
  await dropAt(page, "package");
  const added = (await state(page)).graph.nodes.at(-1)!;
  expect(added.id).toBe("package-1");
  expect(await textsOf(page, added.id)).toEqual(["«package»", "NewPackage"]);
  const drawn = (await drawnNode(page, added.id))!;
  const centre = await pagePoint(page, drawn.x + NODE_WIDTH / 2, drawn.y + drawn.height / 2);
  const box = (await page.locator("#canvas canvas").boundingBox())!;
  expect(centre.x - box.x).toBeCloseTo(400, 0);
  expect(centre.y - box.y).toBeCloseTo(500, 0);
});

test("the sidebar renames a selected package, and shows no stereotype or members for it", async ({
  page,
}) => {
  // Verifies: G-12, G-5
  await page.goto("/");
  await open(page);
  await choose(page, "package");
  await showNear(page, "store");
  await clickNode(page, "store");
  await expect(page.locator("#name")).toHaveValue("store");
  for (const field of ["#stereotype", "#attributes", "#operations"])
    await expect(page.locator(field)).toBeHidden();
  await page.locator("#name").fill("state");
  expect(await textsOf(page, "store")).toEqual(["«package»", "state"]);
});

test("a connection of two packages adds a dependency «use», which the sidebar makes «import»", async ({
  page,
}) => {
  // Verifies: G-12, G-3, G-11
  await page.goto("/");
  await open(page);
  await choose(page, "package");
  await showNear(page, "interaction");
  const [from, to] = [(await drawnNode(page, "interaction"))!, (await drawnNode(page, "render"))!];
  await connect(
    page,
    [from.x + from.width, from.y + from.height / 2],
    [to.x, to.y + to.height / 2],
  );
  const { graph, kinds } = await state(page);
  const added = graph.edges.find(
    ({ source, target }) => source === "interaction" && target === "render",
  )!;
  const dependency = DRAWN.dependency!;
  expect(kinds[added.id]).toBe("dependency");
  expect(added).toMatchObject({ color: dependency.color, dash: [6, 4], arrow: "end" });
  expect(added.label?.text).toBe("«use»");
  // Selected on its path, the sidebar offers «import» or «use» and no other kind.
  await clickWorld(page, (from.x + from.width + to.x) / 2, from.y + from.height / 2);
  await expect(page.locator("#dependency")).toHaveValue("«use»");
  await expect(page.locator("#kind")).toBeHidden();
  await page.locator("#dependency").selectOption("«import»");
  const edge = (await state(page)).graph.edges.find(({ id }) => id === added.id)!;
  expect(edge.label?.text).toBe("«import»");
  expect(edge).toMatchObject({ color: dependency.color, dash: [6, 4], arrow: "end" });
});

test("no dependency joins a package with itself: a connection dragged back to it adds no edge", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  await choose(page, "package");
  await showNear(page, "store");
  const before = await state(page);
  const node = (await drawnNode(page, "store"))!;
  await connect(
    page,
    [node.x + node.width, node.y + node.height / 2],
    [node.x, node.y + node.height / 2],
  );
  expect(await state(page)).toEqual(before);
});

test("edits on both diagrams are kept as the user switches from one to the other and back", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  await dropAt(page, "class");
  const classDiagram = await state(page);
  await choose(page, "package");
  await dropAt(page, "package");
  const packageDiagram = await state(page);
  expect(packageDiagram.graph.nodes.map(({ id }) => id)).toContain("package-1");
  await choose(page, "class");
  expect(await state(page)).toEqual(classDiagram);
  await choose(page, "package");
  expect(await state(page)).toEqual(packageDiagram);
});
