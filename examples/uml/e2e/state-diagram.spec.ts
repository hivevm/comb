// Browser tests of the UML example's state diagram (G-12): the life of a Comb, its states rounded
// rectangles of their name, its initial state a filled circle, its final states ringed circles,
// and the choice of whether the engine loaded a diamond, each a node shape of Comb's own
// (ADR-draft-node-shapes), its transitions edges by sides labelled by their event or guard.
import { expect, test, type Page } from "@playwright/test";
import { open } from "./shared";

/** The states of a Comb by their names, and its pseudostates by their node shapes, written here
 *  rather than read from the example. */
const STATES = {
  created: "Created",
  loading: "Loading its engine",
  ready: "Ready",
  rendering: "Rendering a frame",
  lost: "Engine lost",
  destroyed: "Destroyed",
};
const PSEUDOSTATES = {
  initial: "circle",
  loaded: "diamond",
  refused: "ringed-circle",
  final: "ringed-circle",
};

/** Chooses the state diagram in the sidebar and waits until its load has drawn, the whole of it
 *  in view at the near level. */
async function chooseStates(page: Page): Promise<void> {
  await page.locator("#diagram").selectOption("state");
  await page.evaluate(async () => {
    await window.uml.loadReport;
    window.uml.comb.setViewport({ x: 40, y: 20, scale: 0.6 });
    await window.uml.comb.whenRendered();
  });
}

test("the state diagram shows a Comb's life in the node shapes of its states, initial and final states, and choice", async ({
  page,
}) => {
  // Verifies: G-12, ADR-draft-node-shapes
  await page.goto("/");
  await open(page);
  await chooseStates(page);
  await expect(page.locator("#count")).toHaveText("10 states, 11 transitions");
  // It is shown only: the palette offers nothing to add, and the legend of the kinds of
  // relationship names none of its transitions.
  await expect(page.locator("#palette")).toBeHidden();
  await expect(page.locator("#legend")).toBeHidden();
  const drawn = await page.evaluate(() => {
    const { nodes, level, edgeLabels } = window.uml.inspect();
    return {
      level,
      nodes: Object.fromEntries(
        nodes.map(({ id, shape, title, width, height }) => [id, { shape, title, width, height }]),
      ),
      labels: edgeLabels.map(({ text }) => text).sort(),
    };
  });
  expect(drawn.level).toBe("near");
  for (const [id, name] of Object.entries(STATES))
    expect({ id, ...drawn.nodes[id] }).toMatchObject({
      id,
      shape: "rounded-rectangle",
      title: name,
    });
  for (const [id, shape] of Object.entries(PSEUDOSTATES)) {
    const node = drawn.nodes[id]!;
    expect({ id, shape: node.shape, title: node.title }).toEqual({ id, shape, title: undefined });
  }
  // A circle and a ringed circle are as high as wide.
  for (const id of ["initial", "refused", "final"])
    expect(drawn.nodes[id]!.height).toBe(drawn.nodes[id]!.width);
  expect(drawn.labels).toEqual(
    [
      "createComb",
      "engine settled",
      "[loaded]",
      "[refused]",
      "change",
      "rendered",
      "engine lost",
      "destroy",
      "destroy",
    ].sort(),
  );
});

test("the class and the package diagram are kept while the state diagram is shown", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  const before = await page.evaluate(() => window.uml.exampleGraph());
  await chooseStates(page);
  await page.locator("#diagram").selectOption("class");
  await page.evaluate(() => window.uml.loadReport);
  expect(await page.evaluate(() => window.uml.exampleGraph())).toEqual(before);
  // A diagram without node shapes draws its nodes as rectangles.
  const shapes = await page.evaluate(async () => {
    window.uml.comb.setViewport({ x: 0, y: 0, scale: 1 });
    await window.uml.comb.whenRendered();
    return [...new Set(window.uml.inspect().nodes.map(({ shape }) => shape))];
  });
  expect(shapes).toEqual(["rectangle"]);
});
