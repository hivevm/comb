// Browser tests of the UML example's state diagram (G-12): the life of a Comb, its states rounded
// rectangles of their name, its initial state a filled circle, its final states ringed circles,
// and the choice of whether the engine loaded a diamond, each a node shape of Comb's own
// (ADR-0032), its transitions edges docked on the outline (ADR-0031), labelled by their event or
// guard.
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
  // Verifies: G-12, ADR-0032
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

/** How far `point` lies from the outline of a node of `shape` at `node`, in world units, written
 *  here from ADR-0032's node shapes rather than read from the engine: along the line from the
 *  node's centre for an ellipse, a circle, and a diamond, from the border for a rectangle, and
 *  from the arc of a rounded rectangle's corner, rounded by 10. */
function offOutline(
  shape: string,
  node: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): number {
  const [a, b] = [node.width / 2, node.height / 2];
  const [dx, dy] = [Math.abs(point.x - node.x - a), Math.abs(point.y - node.y - b)];
  const along = Math.hypot(dx, dy);
  const radial = (k: number) => Math.abs(along - along / k);
  switch (shape) {
    case "ellipse":
    case "circle":
    case "ringed-circle":
      return radial(Math.hypot(dx / a, dy / b));
    case "diamond":
      return radial(dx / a + dy / b);
    case "rounded-rectangle": {
      const r = Math.min(10, a, b);
      const [ex, ey] = [dx - (a - r), dy - (b - r)];
      if (ex > 0 && ey > 0) return Math.abs(Math.hypot(ex, ey) - r);
      return Math.min(Math.abs(dx - a), Math.abs(dy - b));
    }
    default:
      return Math.min(Math.abs(dx - a), Math.abs(dy - b));
  }
}

test("every transition of the state diagram docks on the outline of its states, on the line between their centres", async ({
  page,
}) => {
  // Verifies: G-12, ADR-0031, Q-4
  await page.goto("/");
  await open(page);
  await chooseStates(page);
  const { nodes, edges, viewport } = await page.evaluate(() => {
    const scene = window.uml.inspect();
    return {
      edges: scene.edges,
      viewport: scene.viewport,
      nodes: scene.nodes.map(({ id, x, y, width, height, shape }) => ({
        id,
        x,
        y,
        width,
        height,
        shape,
      })),
    };
  });
  expect(edges).toHaveLength(11);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Half a pixel at the zoom it is drawn at (Q-4), in world units.
  const within = 0.5 / viewport.scale;
  const centre = ({ x, y, width, height }: (typeof nodes)[number]) => ({
    x: x + width / 2,
    y: y + height / 2,
  });
  const ends = edges.flatMap(({ id, source, target }) => {
    const [from, to] = id.split("-").map((each) => byId.get(each)!);
    return [
      { id, end: source, node: from!, other: to! },
      { id, end: target, node: to!, other: from! },
    ];
  });
  for (const { id, end, node, other } of ends) {
    const [c, o] = [centre(node), centre(other)];
    const towards = Math.hypot(o.x - c.x, o.y - c.y);
    const off = Math.abs((end.x - c.x) * (o.y - c.y) - (end.y - c.y) * (o.x - c.x)) / towards;
    expect({ id, at: node.id, offLine: off <= within }).toEqual({
      id,
      at: node.id,
      offLine: true,
    });
    expect((end.x - c.x) * (o.x - c.x) + (end.y - c.y) * (o.y - c.y)).toBeGreaterThan(0);
    expect({ id, at: node.id, offOutline: offOutline(node.shape!, node, end) <= within }).toEqual({
      id,
      at: node.id,
      offOutline: true,
    });
  }
  // The ends at one state towards different states never meet: ready has five ends, towards four
  // states. Its two transitions with rendering share one line, as ADR-0031 accepts.
  const atReady = ends.filter(({ node }) => node.id === "ready");
  expect(atReady).toHaveLength(5);
  for (const [i, a] of atReady.entries())
    for (const b of atReady.slice(i + 1))
      if (a.other.id !== b.other.id)
        expect(Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y)).toBeGreaterThan(1);
});
