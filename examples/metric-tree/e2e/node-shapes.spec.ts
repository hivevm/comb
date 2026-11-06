// A node drawn and hit in its node shape (ADR-0032): the host application sets it from
// the closed set, the canvas draws its outline and lays its content out in its inner rectangle,
// `heightOf` answers for its height, and a press beside its outline selects nothing.
import { expect, test, type Page } from "@playwright/test";
import type { GraphData, NodeShape } from "comb";
import { clickWorld, loaded, open, selections, titled } from "./shared";

/** Each node shape, a node of it 160 wide at its own place, four to a row: a content node shape
 *  of one title, a filled one of none. */
const SHAPES: readonly { shape: NodeShape; filled: boolean }[] = [
  { shape: "rectangle", filled: false },
  { shape: "rounded-rectangle", filled: false },
  { shape: "ellipse", filled: false },
  { shape: "diamond", filled: false },
  { shape: "circle", filled: true },
  { shape: "ringed-circle", filled: true },
  { shape: "bar", filled: true },
];
const WIDTH = 160;

/** The top-left corner of the node of the node shape `shape`. */
const placeOf = (shape: NodeShape) => {
  const i = SHAPES.findIndex((s) => s.shape === shape);
  return { x: (i % 4) * 200, y: Math.floor(i / 4) * 250 };
};

const shaped: GraphData = {
  nodes: SHAPES.map(({ shape, filled }) => ({
    id: shape,
    ...placeOf(shape),
    width: WIDTH,
    shape,
    content: filled ? [] : titled(shape),
  })),
  edges: [],
};

/** The primitive of PixiJS each node shape's outline is drawn with, its fill's and its stroke's
 *  colour: white within the border of a node, and the near-black of a node's texts filled. */
const OUTLINES: Record<NodeShape, { kind: string; action: string; color: number }[]> = {
  rectangle: [
    { kind: "roundedRectangle", action: "fill", color: 0xffffff },
    { kind: "roundedRectangle", action: "stroke", color: 0xd0d4dc },
  ],
  "rounded-rectangle": [
    { kind: "roundedRectangle", action: "fill", color: 0xffffff },
    { kind: "roundedRectangle", action: "stroke", color: 0xd0d4dc },
  ],
  ellipse: [
    { kind: "ellipse", action: "fill", color: 0xffffff },
    { kind: "ellipse", action: "stroke", color: 0xd0d4dc },
  ],
  diamond: [
    { kind: "polygon", action: "fill", color: 0xffffff },
    { kind: "polygon", action: "stroke", color: 0xd0d4dc },
  ],
  circle: [{ kind: "circle", action: "fill", color: 0x1f2430 }],
  "ringed-circle": [
    { kind: "circle", action: "stroke", color: 0x1f2430 },
    { kind: "circle", action: "fill", color: 0x1f2430 },
  ],
  bar: [{ kind: "rectangle", action: "fill", color: 0x1f2430 }],
};

/** What the canvas draws of each node, once drawn: its node shape and outline, its height and the
 *  height `heightOf` gives its content, width, and node shape, and the rectangles of its texts. */
async function drawnShapes(page: Page) {
  return page.evaluate(async (graph) => {
    await window.comb.whenRendered();
    const { nodes, level } = window.inspect();
    return {
      level,
      nodes: nodes.map(({ id, width, height, shape, outline, texts }) => {
        const data = graph.nodes.find((node) => node.id === id)!;
        return {
          id,
          width,
          height,
          shape,
          outline: outline?.map(({ kind, action, color }) => ({ kind, action, color })),
          fills: outline
            ?.filter(({ action }) => action === "fill")
            .map(({ x, y, width: w, height: h }) => [x, y, w, h]),
          asked: window.comb.heightOf(data.content, data.width, data.shape),
          texts: (texts ?? []).map(({ x, y, width: w, height: h }) => ({ x, y, w, h })),
        };
      }),
    };
  }, shaped);
}

test("each node shape is drawn at the near level in its outline, its content in its inner rectangle, as high as heightOf gives", async ({
  page,
}) => {
  // Verifies: ADR-0032, ADR-0026
  await open(page);
  await loaded(page, shaped, { x: 20, y: 20, scale: 1 });
  const { level, nodes } = await drawnShapes(page);
  expect(level).toBe("near");
  expect(nodes.map(({ id }) => id)).toEqual(SHAPES.map(({ shape }) => shape));
  for (const { id, width, height, shape, outline, fills, asked, texts } of nodes) {
    expect({ id, shape, outline }).toEqual({ id, shape: id, outline: OUTLINES[id as NodeShape] });
    // Each fills the node's rectangle, the ringed circle its inner circle of half the radius.
    const fill =
      id === "ringed-circle"
        ? [width / 4, height / 4, width / 2, height / 2]
        : [0, 0, width, height];
    expect({ id, fills }).toEqual({ id, fills: [fill] });
    expect({ id, height }).toEqual({ id, height: asked });
    // The content of a content node shape lies within its inner rectangle: the node itself for a
    // rectangle, the rectangle inscribed in an ellipse, and the middle half of a diamond.
    const share = { ellipse: Math.SQRT1_2, diamond: 0.5 }[id as string] ?? 1;
    const [left, top] = [(width * (1 - share)) / 2, (height * (1 - share)) / 2];
    const filled = SHAPES.find((s) => s.shape === id)!.filled;
    expect({ id, texts: texts.length }).toEqual({ id, texts: filled ? 0 : 1 });
    for (const { x, y, w, h } of texts) {
      expect(x).toBeGreaterThanOrEqual(Math.floor(left));
      expect(y).toBeGreaterThanOrEqual(Math.floor(top));
      expect(x + w).toBeLessThanOrEqual(width - left);
      expect(y + h).toBeLessThanOrEqual(height - top);
    }
  }
  // The heights of the node shapes: a rectangle's of one title, an ellipse's grown by √2, a
  // diamond's doubled, a circle's its width, and a bar's 8.
  const height = (id: string) => nodes.find((node) => node.id === id)!.height;
  expect(height("rounded-rectangle")).toBe(height("rectangle"));
  expect(height("ellipse")).toBeCloseTo(height("rectangle") * Math.SQRT2, 3);
  expect(height("diamond")).toBe(2 * height("rectangle"));
  expect([height("circle"), height("ringed-circle"), height("bar")]).toEqual([WIDTH, WIDTH, 8]);
});

test("each node shape is drawn at the middle level in its outline, with its title", async ({
  page,
}) => {
  // Verifies: ADR-0032
  await open(page);
  await loaded(page, shaped, { x: 20, y: 20, scale: 0.4 });
  const { level, nodes } = await drawnShapes(page);
  expect(level).toBe("middle");
  for (const { id, shape, outline, texts } of nodes) {
    expect({ id, shape, outline }).toEqual({ id, shape: id, outline: OUTLINES[id as NodeShape] });
    const filled = SHAPES.find((s) => s.shape === id)!.filled;
    expect({ id, texts: texts.length }).toEqual({ id, texts: filled ? 0 : 1 });
  }
});

test("a press beside the outline of each node shape that leaves its rectangle's corner selects nothing, and one within selects it", async ({
  page,
}) => {
  // Verifies: ADR-0032, G-5
  await open(page);
  await loaded(page, shaped, { x: 20, y: 20, scale: 1 });
  const selected = async (x: number, y: number) => {
    await clickWorld(page, x, y);
    const reported = (await selections(page)) as ({ id: string } | null)[];
    return reported.at(-1)?.id ?? null;
  };
  const { nodes } = await drawnShapes(page);
  const beside = ["rounded-rectangle", "ellipse", "diamond", "circle", "ringed-circle"] as const;
  for (const id of beside) {
    const { x, y } = placeOf(id);
    const height = nodes.find((node) => node.id === id)!.height;
    // Within the node's rectangle, at its top-left corner, outside its outline: nothing.
    expect({ id, corner: await selected(x + 2, y + 2) }).toEqual({ id, corner: null });
    // At its centre: the node.
    const centre = await selected(x + WIDTH / 2, y + height / 2);
    expect({ id, centre }).toEqual({ id, centre: id });
    // A rectangle is hit at the same corner, as before node shapes.
    expect(await selected(2, 2)).toBe("rectangle");
  }
});

test("each node shape is drawn at the far level as a particle, as every node is", async ({
  page,
}) => {
  // Verifies: ADR-0032
  await open(page);
  await loaded(page, shaped, { x: 20, y: 20, scale: 0.2 });
  const { level, nodes } = await drawnShapes(page);
  expect(level).toBe("far");
  expect(nodes.map(({ id, shape, outline }) => ({ id, shape, outline }))).toEqual(
    SHAPES.map(({ shape }) => ({ id: shape, shape: undefined, outline: undefined })),
  );
});

test("a node whose node shape names none is refused naming the node and the field, and a graph without node shapes draws rectangles", async ({
  page,
}) => {
  // Verifies: ADR-0032, Q-7
  await open(page);
  const problem = await page.evaluate(() => {
    const graph = {
      nodes: [{ ...window.node("a"), shape: "hexagon" }],
      edges: [],
    } as unknown as GraphData;
    try {
      window.comb.load(graph);
      return null;
    } catch (error) {
      return (error as { problem?: unknown }).problem;
    }
  });
  expect(problem).toEqual({
    kind: "invalidField",
    list: "nodes",
    index: 0,
    id: "a",
    field: "shape",
    expected: `"rectangle", "rounded-rectangle", "ellipse", "circle", "ringed-circle", "diamond", or "bar"`,
  });
  // The example's own graph names no node shape: every node is a rectangle.
  const shapes = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return [...new Set(window.inspect().nodes.map(({ shape }) => shape))];
  });
  expect(shapes).toEqual(["rectangle"]);
});
