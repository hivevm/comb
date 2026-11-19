// An edge that ends on another edge (API-edges-dock-nodes-or-edges, *An end on an edge*): a
// comment anchored on the middle of an extend between two use cases follows the extend in each
// frame of a drag, goes with it, is named with it to `canDelete`, and an end on an end on an edge
// is refused; and an edge from a container to a node it holds docks on the container's outline
// beyond that node (*An end on a container toward a node it holds*). The comment, the extend, and
// the use cases are plain nodes and edges.
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
import { clickWorld, loaded, node, NODE_HEIGHT, NODE_WIDTH, open, told } from "./shared";

/** Q-4's precision, half a pixel, in world units at the scale of 1 the tests draw at. */
const Q4 = 0.5;
const RED = 0xdc2626;

/** Use cases `u1` at the origin and `u2` 600 to its right, the extend from `u1` to `u2`, a comment
 *  `note` above its middle, and the anchor from the comment's bottom onto the middle of the
 *  extend, in red. */
const ANCHORED: GraphData = {
  nodes: [node("u1"), node("u2", 600), node("note", 300, -300)],
  edges: [
    { id: "extend", source: "u1", target: "u2", arrow: "open", dash: [8, 4] },
    {
      id: "anchor",
      source: "note",
      sourceSide: "bottom",
      targetEdge: "extend",
      targetT: 0.5,
      arrow: "none",
      color: RED,
    },
  ],
};

/** The ends of the extend and of the anchor as the canvas draws them now. */
async function ends(page: Page) {
  return page.evaluate(() => {
    const { edges } = window.inspect();
    const of = (id: string) => edges.find((edge) => edge.id === id)!;
    return { extend: of("extend"), anchor: of("anchor") };
  });
}

/** How far the anchor's end lies from the middle of the extend, its path parameter 0.5: the
 *  middle of its two ends, since an edge from the right side to the left one pulls its control
 *  points level by the same distance (API-edges-dock-nodes-or-edges, *The path between two
 *  nodes*). */
async function offPath(page: Page): Promise<number> {
  const { extend, anchor } = await ends(page);
  const middle = {
    x: (extend.source.x + extend.target.x) / 2,
    y: (extend.source.y + extend.target.y) / 2,
  };
  return Math.hypot(anchor.target.x - middle.x, anchor.target.y - middle.y);
}

/** Drags the node centred on the world point `from` by `(dx, dy)` in six steps, and returns how
 *  far the anchor's end lay from the extend's middle in each frame, the button still down at the
 *  last. */
async function dragged(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const at = (x: number, y: number) =>
    page.evaluate(
      ({ x: worldX, y: worldY }) => {
        const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
        const screen = window.screenPoint(worldX, worldY);
        return { x: rect.left + screen.x, y: rect.top + screen.y };
      },
      { x, y },
    );
  const press = await at(from.x, from.y);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  const off: number[] = [];
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(press.x + (dx * step) / 6, press.y + (dy * step) / 6);
    await page.evaluate(() => window.comb.whenRendered());
    off.push(await offPath(page));
  }
  return off;
}

/** How many pixels in the square of 7 by 7 screen pixels centred on the world point `(x, y)` the
 *  canvas draws in red, within a tolerance. */
async function redAround(page: Page, x: number, y: number): Promise<number> {
  const png = await page.locator("#canvas canvas").screenshot();
  return page.evaluate(
    async ({ shot, x: worldX, y: worldY, ink }) => {
      const bytes = Uint8Array.from(atob(shot), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const ratio = image.width / document.querySelector("#canvas canvas")!.clientWidth;
      const copy = document.createElement("canvas");
      [copy.width, copy.height] = [image.width, image.height];
      const context = copy.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const at = window.screenPoint(worldX, worldY);
      const want = [(ink >> 16) & 0xff, (ink >> 8) & 0xff, ink & 0xff];
      let red = 0;
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          const [px, py] = [Math.round((at.x + dx) * ratio), Math.round((at.y + dy) * ratio)];
          const { data } = context.getImageData(px, py, 1, 1);
          if (want.every((value, channel) => Math.abs(data[channel]! - value) < 48)) red++;
        }
      }
      return red;
    },
    { shot: png.toString("base64"), x, y, ink: RED },
  );
}

test("a comment's anchor stays on the middle of the extend in each frame as either use case moves", async ({
  page,
}) => {
  // Verifies: API-edges-dock-nodes-or-edges, REN-moving-layer-moves-content, Q-4
  await open(page);
  await loaded(page, ANCHORED, { x: 200, y: 400, scale: 1 });
  expect(await offPath(page)).toBeLessThanOrEqual(Q4);
  const before = (await ends(page)).anchor.target;
  // `u2` 200 to the right, level, so that the extend stays level and the anchor comes down onto
  // its middle along the normal there.
  const centre = { x: 600 + NODE_WIDTH / 2, y: NODE_HEIGHT / 2 };
  const right = await dragged(page, centre, 200, 0);
  expect(
    right.every((off) => off <= Q4),
    `${right}`,
  ).toBe(true);
  // The moving layer draws the anchor where it ends now, and no frame left it where it was.
  const now = (await ends(page)).anchor.target;
  expect(now.x - before.x).toBeCloseTo(100, 3);
  expect(await redAround(page, now.x, now.y - 10)).toBeGreaterThan(0);
  expect(await redAround(page, before.x, before.y - 10)).toBe(0);
  await page.mouse.up();
  // `u1` down and to the left, the extend no longer level.
  const down = await dragged(page, { x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 }, -150, 120);
  await page.mouse.up();
  expect(
    down.every((off) => off <= Q4),
    `${down}`,
  ).toBe(true);
  expect(await offPath(page)).toBeLessThanOrEqual(Q4);
  const moves = await told<{ kind: string; id: string }>(page);
  expect(moves.map(({ kind, id }) => `${kind} ${id}`)).toEqual(["nodeMoved u2", "nodeMoved u1"]);
});

test("an end on an edge that ends on an edge, on itself, or on its own edge is refused naming the edge, and the graph stays", async ({
  page,
}) => {
  // Verifies: API-edges-dock-nodes-or-edges, Q-7
  await open(page);
  await loaded(page, ANCHORED);
  const refused = await page.evaluate(() => {
    const outcome = (call: () => void) => {
      try {
        call();
        return "accepted";
      } catch (error) {
        return (error as { problem?: unknown }).problem ?? String(error);
      }
    };
    const edges = window.exampleGraph().edges;
    const onEdge = (id: string, on: string) => ({
      id,
      source: "u1",
      targetEdge: on,
      targetT: 0.25,
    });
    const load = (more: object[]) => () =>
      window.comb.load({ nodes: window.exampleGraph().nodes, edges: [...edges, ...more] } as never);
    return {
      chain: outcome(load([onEdge("onto-anchor", "anchor")])),
      itself: outcome(load([onEdge("self", "self")])),
      cycle: outcome(
        load([onEdge("x", "y"), { id: "y", source: "u2", targetEdge: "x", targetT: 0.5 }]),
      ),
      added: outcome(() => window.comb.addEdge(onEdge("onto-anchor", "anchor"))),
      addedItself: outcome(() => window.comb.addEdge(onEdge("self", "self"))),
      missing: outcome(() => window.comb.addEdge(onEdge("lost", "nowhere"))),
      sided: outcome(() =>
        window.comb.addEdge({ ...onEdge("sided", "extend"), targetSide: "top" } as never),
      ),
      edges: window.inspect().edges.map(({ id }) => id),
    };
  });
  const invalid = (edge: string) => ({ kind: "invalidEdgeEnd", edge, end: "targetEdge" });
  expect(refused).toEqual({
    chain: invalid("onto-anchor"),
    itself: invalid("self"),
    cycle: invalid("x"),
    added: invalid("onto-anchor"),
    addedItself: invalid("self"),
    missing: { kind: "missingEdge", edge: "lost", missing: "nowhere" },
    sided: {
      kind: "invalidField",
      list: "edges",
      index: 0,
      id: "sided",
      field: "targetSide",
      expected:
        '"top", "right", "bottom", "left", or "outline" where the end lies on a node, none where it lies on an edge',
    },
    edges: ["extend", "anchor"],
  });
  expect(await told(page)).toEqual([]);
});

test("removing the extend, or a use case at its end, removes the anchor too and names it", async ({
  page,
}) => {
  // Verifies: API-edges-dock-nodes-or-edges, API-edits-report-nested-changes
  await open(page);
  await loaded(page, ANCHORED);
  await page.evaluate(() => window.comb.removeEdges(["extend"]));
  expect(await told(page)).toEqual([
    { kind: "edgesRemoved", by: "host", edges: ["extend", "anchor"] },
  ]);
  // Opened anew, so that one listener records the changes.
  await open(page);
  await loaded(page, ANCHORED);
  await page.evaluate(() => window.comb.removeNodes(["u1"]));
  expect(await told(page)).toEqual([
    { kind: "nodesRemoved", by: "host", nodes: ["u1"], edges: ["extend", "anchor"] },
  ]);
  const drawn = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().edges.map(({ id }) => id);
  });
  expect(drawn).toEqual([]);
});

test("Delete on the selected extend names the extend and its anchor to canDelete", async ({
  page,
}) => {
  // Verifies: API-edges-dock-nodes-or-edges, API-edits-report-nested-changes, G-4
  await open(page);
  await loaded(page, ANCHORED);
  await page.evaluate(() => {
    const w = window as unknown as { asked: unknown[] };
    w.asked = [];
    window.canDelete = (deletion) => (w.asked.push(deletion), true);
  });
  // On the extend, level along y = 32, left of its middle where the anchor ends.
  await clickWorld(page, 300, NODE_HEIGHT / 2);
  await page.keyboard.press("Delete");
  const asked = await page.evaluate(() => (window as unknown as { asked: unknown[] }).asked);
  expect(asked).toEqual([{ nodes: [], edges: ["extend", "anchor"] }]);
  expect(await told(page)).toEqual([
    { kind: "edgesRemoved", by: "user", edges: ["extend", "anchor"] },
  ]);
});

test("a transition from a composite state to a state it holds docks on the composite's outline beyond that state", async ({
  page,
}) => {
  // Verifies: API-edges-dock-nodes-or-edges, G-14
  await open(page);
  const composite: GraphData = {
    nodes: [
      { ...node("composite"), width: 600, height: 400, isContainer: true },
      { ...node("inner", 100, 120), container: "composite" },
    ],
    edges: [
      {
        id: "t",
        source: "composite",
        target: "inner",
        sourceSide: "outline",
        targetSide: "outline",
      },
    ],
  };
  await loaded(page, composite);
  const { t, inner } = await page.evaluate(async () => {
    await window.comb.whenRendered();
    const { edges, nodes } = window.inspect();
    return {
      t: edges.find(({ id }) => id === "t")!,
      inner: nodes.find(({ id }) => id === "inner")!,
    };
  });
  // From the composite's centre (300, 200) through the inner state's, continued to the
  // composite's left side.
  const held = { x: inner.x + inner.width / 2, y: inner.y + inner.height / 2 };
  const along = (300 - 0) / (300 - held.x);
  expect(t.source.x).toBeCloseTo(0, 3);
  expect(Math.abs(t.source.y - (200 - (200 - held.y) * along))).toBeLessThanOrEqual(Q4);
  expect(t.source.x).toBeLessThan(inner.x);
});
