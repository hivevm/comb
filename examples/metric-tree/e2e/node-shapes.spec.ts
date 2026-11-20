// A node drawn and hit in its node shape (G-13, REN-node-shapes-cover-uml): the host
// application sets it from the closed set, the canvas draws its outline and lays its content out in
// its inner rectangle, `heightOf` answers for its height, and a press beside its outline selects
// nothing.
import { expect, test, type Page } from "@playwright/test";
import type { GraphData, NodeShape } from "comb";
import { clickWorld, loaded, open, selections, setViewport, titled } from "./shared";

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
  // The node shapes of UML that hold content (REN-node-shapes-cover-uml): a note's fold and a
  // frame's tab stroked inside their outline.
  pentagon: [
    { kind: "polygon", action: "fill", color: 0xffffff },
    { kind: "polygon", action: "stroke", color: 0xd0d4dc },
  ],
  "notched-rectangle": [
    { kind: "polygon", action: "fill", color: 0xffffff },
    { kind: "polygon", action: "stroke", color: 0xd0d4dc },
  ],
  note: [
    { kind: "polygon", action: "fill", color: 0xffffff },
    { kind: "polygon", action: "stroke", color: 0xd0d4dc },
    { kind: "polygon", action: "stroke", color: 0xd0d4dc },
  ],
  frame: [
    { kind: "rectangle", action: "fill", color: 0xffffff },
    { kind: "rectangle", action: "stroke", color: 0xd0d4dc },
    { kind: "polygon", action: "stroke", color: 0xd0d4dc },
  ],
  // The filled node shapes of UML drawn as lines (REN-node-shapes-cover-uml): a ring and the two
  // strokes of its X, and an X alone, in the near-black of a node's texts.
  "crossed-circle": [
    { kind: "circle", action: "stroke", color: 0x1f2430 },
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
  ],
  cross: [
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
  ],
  // The captioned node shapes: an actor's head, body, arms, and legs, and an hourglass's two
  // triangles, stroked in that near-black; their content has no fill and no border.
  actor: [
    { kind: "circle", action: "stroke", color: 0x1f2430 },
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
  ],
  hourglass: [
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
    { kind: "polygon", action: "stroke", color: 0x1f2430 },
  ],
};

/** The node shapes of UML drawn without a border: a crossed circle and a cross 40 wide without
 *  content, and an actor and an hourglass 120 wide of one title, side by side, above a rectangle
 *  `under` that a press beside a node's outline reaches. */
const SYMBOLS: GraphData = {
  nodes: [
    { id: "under", x: -20, y: -20, width: 700, height: 200, content: titled("under") },
    ...(["crossed-circle", "cross", "actor", "hourglass"] as const).map((shape, i) => ({
      id: shape,
      x: i * 160,
      y: 0,
      width: shape === "actor" || shape === "hourglass" ? 120 : 40,
      shape,
      content: shape === "actor" || shape === "hourglass" ? titled(shape) : [],
    })),
  ],
  edges: [],
};

/** The node shapes of UML that hold content, a node of each 220 wide of one title, side by side. */
const UML: GraphData = {
  nodes: (["pentagon", "notched-rectangle", "note", "frame"] as const).map((shape, i) => ({
    id: shape,
    x: i * 300,
    y: 0,
    width: 220,
    shape,
    content: titled(shape),
  })),
  edges: [],
};

/** What the canvas draws of each node, once drawn: its node shape and outline, the corner radius
 *  of each part of its outline, its height and the
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
          radii: outline?.map(({ radius }) => radius),
          asked: window.comb.heightOf(data.content, data.width, data.shape),
          texts: (texts ?? []).map(({ x, y, width: w, height: h }) => ({ x, y, w, h })),
        };
      }),
    };
  }, shaped);
}

/** The node a click at world point (`x`, `y`) selects, or `null` for none. */
async function selected(page: Page, x: number, y: number): Promise<string | null> {
  await clickWorld(page, x, y);
  const reported = (await selections(page)) as ({ id: string } | null)[];
  return reported.at(-1)?.id ?? null;
}

test("each node shape is drawn at the near level in its outline, its content in its inner rectangle, as high as heightOf gives", async ({
  page,
}) => {
  // Verifies: G-13, REN-node-shapes-cover-uml, REN-node-content-and-hits
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
  // Verifies: G-13, REN-node-shapes-cover-uml
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

test("a pentagon, a notched rectangle, a note, and a frame are drawn in their outline at the near and the middle level, a note's fold and a frame's tab inside", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml
  await open(page);
  for (const scale of [1, 0.4]) {
    await loaded(page, UML, { x: 20, y: 20, scale });
    const drawn = await page.evaluate(async () => {
      await window.comb.whenRendered();
      const { level, nodes } = window.inspect();
      return { level, nodes: nodes.filter((node) => node.outline !== undefined) };
    });
    expect(drawn.level).toBe(scale === 1 ? "near" : "middle");
    expect(drawn.nodes.map(({ id }) => id)).toEqual(UML.nodes.map(({ id }) => id));
    for (const { id, width, height, outline, inner } of drawn.nodes) {
      const parts = outline!.map(({ kind, action, color }) => ({ kind, action, color }));
      expect({ id, parts }).toEqual({ id, parts: OUTLINES[id as NodeShape] });
      // Each outline's fill spans the node's rectangle: the point, the notch, and the fold reach
      // into it, a pentagon's point to its right side.
      const fill = outline!.find(({ action }) => action === "fill")!;
      expect({ id, fill: [fill.x, fill.y, fill.width, fill.height] }).toEqual({
        id,
        fill: [0, 0, width, height],
      });
      const [, , inside] = outline!;
      if (id === "note") {
        // The fold, 12 down from the top right corner and 12 in from it.
        expect([inside!.x, inside!.y, inside!.width, inside!.height]).toEqual([
          width - 12,
          0,
          12,
          12,
        ]);
      }
      if (id === "frame") {
        // The tab's lower edge and its cut corner, at the inner rectangle the engine gives.
        const tab = [inside!.x, inside!.y, inside!.width, inside!.height];
        expect(tab).toEqual([0, 0, inner!.width, inner!.height]);
      }
    }
  }
});

test("a crossed circle, a cross, an actor, and an hourglass are drawn at the near and the middle level as high as heightOf gives, an actor's and an hourglass's drawing above their content", async ({
  page,
}) => {
  // Verifies: G-18, REN-node-shapes-cover-uml, REN-node-content-and-hits
  await open(page);
  for (const scale of [1, 0.4]) {
    await loaded(page, SYMBOLS, { x: 40, y: 40, scale });
    const drawn = await page.evaluate(async (graph) => {
      await window.comb.whenRendered();
      const { level, nodes } = window.inspect();
      return {
        level,
        nodes: nodes
          .filter(({ id }) => id !== "under")
          .map((node) => {
            const data = graph.nodes.find(({ id }) => id === node.id)!;
            return { ...node, asked: window.comb.heightOf(data.content, data.width, data.shape) };
          }),
      };
    }, SYMBOLS);
    expect(drawn.level).toBe(scale === 1 ? "near" : "middle");
    expect(drawn.nodes.map(({ id }) => id)).toEqual([
      "crossed-circle",
      "cross",
      "actor",
      "hourglass",
    ]);
    for (const { id, width, height, asked, outline, inner, drawing, texts } of drawn.nodes) {
      const parts = outline!.map(({ kind, action, color }) => ({ kind, action, color }));
      expect({ id, parts }).toEqual({ id, parts: OUTLINES[id as NodeShape] });
      expect({ id, height }).toEqual({ id, height: asked });
      if (id === "crossed-circle" || id === "cross") {
        // As high as wide, no content, every part within the node.
        expect({ id, width, height, texts: texts!.length }).toEqual({
          id,
          width: 40,
          height: 40,
          texts: 0,
        });
        for (const part of outline!) {
          expect(part.x).toBeGreaterThanOrEqual(0);
          expect(part.x + part.width).toBeLessThanOrEqual(40);
        }
        continue;
      }
      // A drawing 48 high at the top, 2 or 1.5 times as high as wide and centred, the title and
      // its padding, 38, directly below it, laid out to the node's width: 86 together, at least
      // the least height of 64 as a whole node (REN-node-shapes-cover-uml, *Height*).
      const wide = id === "actor" ? 24 : 32;
      expect({ id, drawing }).toEqual({
        id,
        drawing: { x: (120 - wide) / 2, y: 0, width: wide, height: 48 },
      });
      expect({ id, inner }).toEqual({ id, inner: { x: 0, y: 48, width: 120, height: 38 } });
      expect({ id, height }).toEqual({ id, height: 86 });
      expect({ id, texts: texts!.map(({ x, y, width: w }) => [x, y, w]) }).toEqual({
        id,
        texts: [[12, 58, 96]],
      });
    }
  }
});

test("content in a crossed circle or a cross is refused as content in a filled node shape, naming the node", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, Q-7
  await open(page);
  const problems = await page.evaluate(() =>
    (["crossed-circle", "cross"] as const).map((shape) => {
      try {
        window.comb.load({ nodes: [{ ...window.node("x"), shape }], edges: [] });
        return null;
      } catch (error) {
        return (error as { problem?: unknown }).problem;
      }
    }),
  );
  expect(problems).toEqual([
    { kind: "contentInFilledShape", node: "x" },
    { kind: "contentInFilledShape", node: "x" },
  ]);
});

test("a crossed circle and a cross 12 wide without a height are drawn 12 by 12, a circle 12 wide as a junction, and an actor without content as high as its drawing", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, REN-node-content-and-hits
  await open(page);
  const small: GraphData = {
    nodes: [
      ...(["crossed-circle", "cross", "circle"] as const).map((shape, i) => ({
        id: shape,
        x: i * 40,
        y: 0,
        width: 12,
        shape,
        content: [],
      })),
      // A height below its drawing's: 60 wide, its drawing 48 high; 12 wide, 24.
      { id: "actor", x: 160, y: 0, width: 60, height: 10, shape: "actor", content: [] },
      { id: "pin", x: 260, y: 0, width: 12, height: 4, shape: "actor", content: [] },
      // None wide: a drawing of none, which inspection leaves out.
      { id: "none", x: 320, y: 0, width: 0, shape: "actor", content: [] },
    ],
    edges: [],
  };
  await loaded(page, small, { x: 40, y: 40, scale: 2 });
  const nodes = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().nodes;
  });
  const of = (id: string) => nodes.find((node) => node.id === id)!;
  for (const id of ["crossed-circle", "cross", "circle"]) {
    const { width, height } = of(id);
    expect({ id, width, height }).toEqual({ id, width: 12, height: 12 });
  }
  // The junction: a filled circle across the node.
  const junction = of("circle").outline!.map(({ kind, action, x, y, width, height }) => ({
    kind,
    action,
    box: [x, y, width, height],
  }));
  expect(junction).toEqual([{ kind: "circle", action: "fill", box: [0, 0, 12, 12] }]);
  expect([of("actor").height, of("actor").drawing]).toEqual([
    48,
    { x: 18, y: 0, width: 24, height: 48 },
  ]);
  expect([of("pin").height, of("pin").drawing]).toEqual([
    24,
    { x: 0, y: 0, width: 12, height: 24 },
  ]);
  const none = of("none");
  expect({ height: none.height, drawing: none.drawing, parts: none.outline }).toEqual({
    height: 0,
    drawing: undefined,
    parts: [],
  });
});

test("a press on an actor's drawing hits the actor, one beside a crossed circle's ring what lies below, and the selected actor is outlined", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, G-5
  await open(page);
  await loaded(page, SYMBOLS, { x: 40, y: 40, scale: 1 });
  // The actor at (320, 0), 120 wide, its drawing from x = 368 to 392: its arm at y = 16.8, its
  // body below its head, and its left leg. (Its head lies at the connector of its top side.)
  expect(await selected(page, 370, 17)).toBe("actor");
  expect(await selected(page, 40, 150)).toBe("under");
  expect(await selected(page, 380, 25)).toBe("actor");
  expect(await selected(page, 40, 150)).toBe("under");
  expect(await selected(page, 374, 39.6)).toBe("actor");
  // Hit as its bounding rectangle: beside its drawing, at the corner of its box.
  expect(await selected(page, 40, 150)).toBe("under");
  expect(await selected(page, 323, 3)).toBe("actor");
  const outline = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().nodes.find(({ id }) => id === "actor")!.outline!;
  });
  expect(outline.at(-1)).toMatchObject({
    kind: "rectangle",
    action: "stroke",
    color: 0x3b82f6,
    x: 0,
    y: 0,
    width: 120,
    height: 86,
  });
  // The crossed circle at (0, 0), 40 wide: at its box's corner, outside its ring, the rectangle
  // below; the cross beside it is hit at its box's corner.
  expect(await selected(page, 2, 2)).toBe("under");
  expect(await selected(page, 20, 20)).toBe("crossed-circle");
  expect(await selected(page, 162, 2)).toBe("cross");
});

/** Opens the example on the Canvas 2D fallback, WebGL refused. */
async function openOnCanvas(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, id: string, options?: unknown) {
        return id.startsWith("webgl") ? null : Reflect.apply(getContext, this, [id, options]);
      },
    });
  });
  await open(page, "?fallback=canvas");
}

/** The level drawn once the frames scheduled so far have rendered and been presented, on a canvas
 *  the renderer `canvas` draws. */
async function settled(page: Page): Promise<string> {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    await new Promise(requestAnimationFrame);
    const { level, renderer } = window.inspect();
    return renderer === "canvas" ? level : `${level} on ${renderer}`;
  });
}

test("on the Canvas 2D fallback a crossed circle, a cross, an actor, and an hourglass are drawn in the near-black of a node's texts at the near level", async ({
  page,
}) => {
  // Verifies: REN-webgl2-or-canvas-fallback, REN-node-shapes-cover-uml
  await openOnCanvas(page);
  await loaded(page, SYMBOLS, { x: 20, y: 20, scale: 2 });
  expect(await settled(page)).toBe("near");
  // The crossed circle at (0, 0), 40 wide: its ring's top, its X off the centre, and none inside
  // the ring between the X's arms. The cross's diagonal. The actor's arm at 0.35 of its drawing's
  // 48, its body below its head, and none in the middle of its head.
  const near = await inkAt(page, 0x1f2430, [
    [20, 0.5],
    [12, 12],
    [20, 8],
    [170, 10],
    [374, 16.8],
    [380, 25],
    [380, 6],
  ]);
  expect(near).toEqual([true, true, false, true, true, true, false]);
  // The hourglass at (480, 0), 120 wide, its drawing 32 wide from x = 524: the left sides of its
  // two triangles, and none inside the upper one.
  await setViewport(page, { x: -700, y: 20, scale: 2 });
  expect(await settled(page)).toBe("near");
  expect(
    await inkAt(page, 0x1f2430, [
      [532, 12],
      [532, 36],
      [540, 8],
    ]),
  ).toEqual([true, true, false]);
});

test("on the Canvas 2D fallback a crossed circle, a cross, and an hourglass are drawn at the middle level, and a diamond's outline closes", async ({
  page,
}) => {
  // Verifies: REN-webgl2-or-canvas-fallback, REN-node-shapes-cover-uml
  await openOnCanvas(page);
  // At the middle level the strokes are thinner than a pixel: darker than the white below them
  // on the crossed circle's X, the cross's diagonal, and the hourglass's sides, and white beside.
  await loaded(page, SYMBOLS, { x: 20, y: 20, scale: 0.5 });
  expect(await settled(page)).toBe("middle");
  const dark = await darkAt(page, [
    [20, 20],
    [180, 20],
    [532, 12],
    [100, 100],
    [250, 100],
  ]);
  expect(dark).toEqual([true, true, true, false, false]);
  // A diamond's outline closes on the fallback too: the middle of its upper left side, the last
  // its corners draw, in the border's grey (a regression: the fallback left a polygon's stroke
  // open where PixiJS's `poly` was not told to close it, as WebGL2 closes it anyway).
  const diamond: GraphData = {
    nodes: [{ id: "d", x: 0, y: 0, width: 160, shape: "diamond", content: titled("d") }],
    edges: [],
  };
  await loaded(page, diamond, { x: 20, y: 20, scale: 2 });
  expect(await settled(page)).toBe("near");
  expect(
    await inkAt(page, 0xd0d4dc, [
      [40, 32],
      [120, 32],
    ]),
  ).toEqual([true, true]);
});

test("a press beside the outline of each node shape that leaves its rectangle's corner selects nothing, and one within selects it", async ({
  page,
}) => {
  // Verifies: G-13, REN-node-shapes-cover-uml, G-5
  await open(page);
  await loaded(page, shaped, { x: 20, y: 20, scale: 1 });
  const { nodes } = await drawnShapes(page);
  const beside = ["rounded-rectangle", "ellipse", "diamond", "circle", "ringed-circle"] as const;
  for (const id of beside) {
    const { x, y } = placeOf(id);
    const height = nodes.find((node) => node.id === id)!.height;
    // Within the node's rectangle, at its top-left corner, outside its outline: nothing.
    expect({ id, corner: await selected(page, x + 2, y + 2) }).toEqual({ id, corner: null });
    // At its centre: the node.
    const centre = await selected(page, x + WIDTH / 2, y + height / 2);
    expect({ id, centre }).toEqual({ id, centre: id });
    // A rectangle is hit at the same corner, as before node shapes.
    expect(await selected(page, 2, 2)).toBe("rectangle");
  }
});

test("a rounded rectangle is hit just inside the corner arc it is drawn with, and not just outside it", async ({
  page,
}) => {
  // Verifies: G-13, REN-node-shapes-cover-uml
  await open(page);
  await loaded(page, shaped, { x: 20, y: 20, scale: 1 });
  const { level, nodes } = await drawnShapes(page);
  expect(level).toBe("near");
  // The radius the canvas draws the rounded rectangle's corners by, which the engine hits it by.
  const radii = nodes.find((node) => node.id === "rounded-rectangle")!.radii!;
  expect(radii).toEqual([expect.any(Number), radii[0]]);
  const radius = radii[0]!;
  // On the diagonal from the centre of the top-left corner's arc to the node's corner, a quarter
  // unit within the arc and a quarter beyond it, both inside the node's bounding rectangle: a drawn
  // radius off by more than about 0.6 moves the arc past one of the two presses.
  const { x, y } = placeOf("rounded-rectangle");
  const at = (distance: number) => radius - distance / Math.SQRT2;
  const inside = await selected(page, x + at(radius - 0.25), y + at(radius - 0.25));
  const outside = await selected(page, x + at(radius + 0.25), y + at(radius + 0.25));
  expect({ radius, inside, outside }).toEqual({
    radius,
    inside: "rounded-rectangle",
    outside: null,
  });
});

/** Whether the canvas shows the colour `color` (`0xRRGGBB`) within a pixel of each world point
 *  `points`, read off a screenshot of what the browser last presented. */
async function inkAt(page: Page, color: number, points: [number, number][]): Promise<boolean[]> {
  const png = await page.locator("#canvas canvas").screenshot();
  return page.evaluate(
    async ({ png: shot, color: ink, points: at }) => {
      const bytes = Uint8Array.from(atob(shot), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const ratio = image.width / document.querySelector("#canvas canvas")!.clientWidth;
      const copy = document.createElement("canvas");
      [copy.width, copy.height] = [image.width, image.height];
      const context = copy.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const want = [(ink >> 16) & 0xff, (ink >> 8) & 0xff, ink & 0xff];
      return at.map(([x, y]) => {
        const screen = window.screenPoint(x, y);
        const [px, py] = [Math.round(screen.x * ratio), Math.round(screen.y * ratio)];
        const { data } = context.getImageData(px - 1, py - 1, 3, 3);
        return Array.from({ length: 9 }, (_, i) => i * 4).some((i) =>
          want.every((value, channel) => Math.abs(data[i + channel]! - value) < 24),
        );
      });
    },
    { png: png.toString("base64"), color, points },
  );
}

/** Every node shape of the closed set, as `OUTLINES` names them, a node of each 160 wide at its own
 *  place, four to a row: a filled one of no content, the others of one title. */
const EVERY: GraphData = {
  nodes: (Object.keys(OUTLINES) as NodeShape[]).map((shape, i) => ({
    id: shape,
    x: (i % 4) * 200,
    y: Math.floor(i / 4) * 250,
    width: WIDTH,
    shape,
    content: ["circle", "ringed-circle", "bar", "crossed-circle", "cross"].includes(shape)
      ? []
      : titled(shape),
  })),
  edges: [],
};

/** Whether the canvas shows a pixel clearly darker than white, by more than 40 in each channel,
 *  within a pixel of each world point `points`, read off a screenshot. */
async function darkAt(page: Page, points: [number, number][]): Promise<boolean[]> {
  const png = await page.locator("#canvas canvas").screenshot();
  return page.evaluate(
    async ({ png: shot, points: at }) => {
      const bytes = Uint8Array.from(atob(shot), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const ratio = image.width / document.querySelector("#canvas canvas")!.clientWidth;
      const copy = document.createElement("canvas");
      [copy.width, copy.height] = [image.width, image.height];
      const context = copy.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return at.map(([x, y]) => {
        const screen = window.screenPoint(x, y);
        const [px, py] = [Math.round(screen.x * ratio), Math.round(screen.y * ratio)];
        const { data } = context.getImageData(px - 1, py - 1, 3, 3);
        return Array.from({ length: 9 }, (_, i) => i * 4).some((i) =>
          [0, 1, 2].every((channel) => data[i + channel]! < 255 - 40),
        );
      });
    },
    { png: png.toString("base64"), points },
  );
}

test("each node shape is drawn at the far level as a particle of the far level's colour, as every node is", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, REN-virtualized-nested-scene
  await open(page);
  await loaded(page, EVERY, { x: 20, y: 20, scale: 0.2 });
  const { level, nodes } = await page.evaluate(async (graph) => {
    await window.comb.whenRendered();
    const inspected = window.inspect();
    return {
      level: inspected.level,
      nodes: inspected.nodes.map(({ id, x, y, width, height, shape, outline }) => {
        const data = graph.nodes.find((node) => node.id === id)!;
        const asked = window.comb.heightOf(data.content, data.width, data.shape);
        return { id, x, y, width, height, shape, outline, asked };
      }),
    };
  }, EVERY);
  expect(level).toBe("far");
  const ids = EVERY.nodes.map(({ id }) => id);
  // A particle for each node, none of them a view: no node shape, no outline.
  expect(await page.evaluate(() => window.inspect().particles)).toBe(ids.length);
  expect(nodes.map(({ id, shape, outline }) => ({ id, shape, outline }))).toEqual(
    ids.map((id) => ({ id, shape: undefined, outline: undefined })),
  );
  // Each at its node's place, as wide as its node and as high as heightOf gives its node shape.
  for (const { id, x, y, width, height, asked } of nodes) {
    const data = EVERY.nodes.find((node) => node.id === id)!;
    expect({ id, x, y, width, height }).toEqual({
      id,
      x: data.x,
      y: data.y,
      width: WIDTH,
      height: asked,
    });
  }
  // Each drawn on the canvas at its centre in the grey of a node at the far level.
  const centres = nodes.map(({ x, y, height }): [number, number] => [
    x + WIDTH / 2,
    y + height / 2,
  ]);
  const ink = await inkAt(page, 0xc3c8d1, centres);
  expect(nodes.map(({ id }, i) => ({ id, ink: ink[i] }))).toEqual(
    ids.map((id) => ({ id, ink: true })),
  );
});

test("a node whose node shape names none is refused naming the node and the field, and a graph without node shapes draws rectangles", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, Q-7
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
    expected:
      '"rectangle", "rounded-rectangle", "ellipse", "circle", "ringed-circle", "diamond", ' +
      '"bar", "pentagon", "notched-rectangle", "note", "frame", "crossed-circle", "cross", ' +
      '"actor", or "hourglass"',
  });
  // The example's own graph names no node shape: every node is a rectangle.
  const shapes = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return [...new Set(window.inspect().nodes.map(({ shape }) => shape))];
  });
  expect(shapes).toEqual(["rectangle"]);
});
