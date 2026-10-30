// Node content (ADR-0013): rows of TALL columns of texts, laid out by the engine, drawn as
// `BitmapText` where the engine placed them, cut with an ellipsis within their column, each node
// as high as its rows; read through `comb/testing` rather than pixels.
import { expect, test, type Page } from "@playwright/test";
import type { NodeContent, NodeData } from "comb";
import { loaded, node, NODE_HEIGHT, NODE_WIDTH, open, setViewport, told } from "./shared";

/** A text of `role`, of weight 1 unless given. */
const text = (role: "title" | "body" | "caption", value: string, weight?: number) => ({
  kind: "text" as const,
  role,
  text: value,
  ...(weight === undefined ? {} : { weight }),
});

/** A node of four rows: a title, a body beside a caption TALL 1 and 3, and two bodies; 10 +
 *  18 + 16 + 16 + 16 + 10 = 86 high, past the least height of 64. */
const TALL: NodeContent = [
  [text("title", "Bet")],
  [text("body", "Body", 1), text("caption", "Caption", 3)],
  [text("body", "Second")],
  [text("body", "Third")],
];
const TALL_HEIGHT = 86;

/** What the canvas draws of node `id` once it has drawn. */
async function drawnNode(page: Page, id: string) {
  return page.evaluate(async (wanted) => {
    await window.comb.whenRendered();
    return window.inspect().nodes.find((each) => each.id === wanted);
  }, id);
}

test("a node of one title shows one text view where its title was drawn", async ({ page }) => {
  // Verifies: ADR-0013
  await open(page);
  await setViewport(page, { x: 40, y: 300, scale: 1 });
  const drawn = await drawnNode(page, "0:0.0");
  expect(drawn).toMatchObject({
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    title: "Launch push notifications",
  });
  expect(drawn!.texts).toEqual([
    expect.objectContaining({
      role: "title",
      drawn: "Launch push notifications",
      x: 12,
      y: 10,
      width: NODE_WIDTH - 24,
      height: 18,
    }),
  ]);
});

test("rows of texts are drawn where the engine places them, and a node is as high as its rows", async ({
  page,
}) => {
  // Verifies: ADR-0013, Q-4
  await open(page);
  await loaded(page, {
    nodes: [node("a"), { ...node("b", 300), content: TALL }],
    edges: [{ id: "e", source: "a", target: "b" }],
  });
  const a = await drawnNode(page, "a");
  const b = await drawnNode(page, "b");
  expect(a!.height).toBe(NODE_HEIGHT);
  expect(b!.height).toBe(TALL_HEIGHT);
  // The body and the caption share 196 less a gap of 8 by their weights, 47 and 141.
  expect(b!.texts!.map(({ role, x, y, width, height }) => [role, x, y, width, height])).toEqual([
    ["title", 12, 10, 196, 18],
    ["body", 12, 28, 47, 16],
    ["caption", 67, 28, 141, 14],
    ["body", 12, 44, 196, 16],
    ["body", 12, 60, 196, 16],
  ]);
  // The edge enters `b` at the middle of its left side, as high as its rows.
  const edge = await page.evaluate(() => window.inspect().edges.find(({ id }) => id === "e")!);
  expect(edge.target).toEqual({ x: 300, y: TALL_HEIGHT / 2 });
  expect(edge.source).toEqual({ x: NODE_WIDTH, y: NODE_HEIGHT / 2 });
  // A press below `a`'s bottom hits nothing there, and `b` at the same height.
  const kindAt = (x: number, y: number) =>
    page.evaluate(
      ([wx, wy]) => {
        const at = window.screenPoint(wx!, wy!);
        return window.hitKind(at.x, at.y);
      },
      [x, y],
    );
  expect(await kindAt(100, 75)).toBe("none");
  expect(await kindAt(400, 75)).toBe("node");
  expect(await kindAt(400, TALL_HEIGHT + 3)).toBe("none");
});

test("a text wider than its column is cut with an ellipsis within the column", async ({ page }) => {
  // Verifies: ADR-0013
  await open(page);
  const long = "An input metric whose name runs on far past the width of its node";
  await loaded(page, { nodes: [{ ...node("a"), content: [[text("title", long)]] }], edges: [] });
  const shown = await drawnNode(page, "a");
  expect(shown!.title).toBe(long);
  const [drawn] = shown!.texts!;
  expect(drawn!.drawn.endsWith("…")).toBe(true);
  expect(long.startsWith(drawn!.drawn.slice(0, -1))).toBe(true);
  expect(drawn!.drawn.length).toBeGreaterThan(10);
  expect(drawn!.drawnWidth).toBeLessThanOrEqual(drawn!.width);
});

test("the middle level draws the texts of role title alone, and the far level none", async ({
  page,
}) => {
  // Verifies: ADR-0013, ADR-0027
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content: TALL }], edges: [] });
  const at = async (scale: number) => {
    await setViewport(page, { x: 100, y: 100, scale });
    return page.evaluate(() => {
      const { level, nodes, texts, particles } = window.inspect();
      return { level, texts, particles, roles: nodes[0]?.texts?.map(({ role }) => role) };
    });
  };
  expect(await at(1)).toEqual({ level: "near", texts: 5, particles: 0, roles: expect.any(Array) });
  const middle = await at(0.5);
  expect(middle).toEqual({ level: "middle", texts: 1, particles: 0, roles: ["title"] });
  // At the place near gives it.
  const title = (await drawnNode(page, "b"))!.texts![0]!;
  expect([title.x, title.y]).toEqual([12, 10]);
  expect(await at(0.2)).toEqual({ level: "far", texts: 0, particles: 1, roles: undefined });
  // The particle is as high as the node's rows.
  expect((await drawnNode(page, "b"))!.height).toBe(TALL_HEIGHT);
});

test("updateNode replaces the content, the canvas shows it, the node's height follows, and nodeUpdated carries it", async ({
  page,
}) => {
  // Verifies: ADR-0013, ADR-0030, G-5
  await open(page);
  await loaded(page, { nodes: [node("a")], edges: [] });
  await page.evaluate((content) => window.comb.updateNode("a", { content }), TALL);
  const drawn = await drawnNode(page, "a");
  expect(drawn!.height).toBe(TALL_HEIGHT);
  expect(drawn!.texts!.map(({ drawn: shown }) => shown)).toEqual([
    "Bet",
    "Body",
    "Caption",
    "Second",
    "Third",
  ]);
  // The content as Comb keeps it, each weight given, 1 where it was left out.
  const weighted = TALL.map((row) => row.map((element) => ({ weight: 1, ...element })));
  expect(await told(page)).toEqual([
    { kind: "nodeUpdated", by: "host", id: "a", patch: { content: weighted } },
  ]);
  // The example's sidebar shows the title, which its copy of the graph follows.
  const copy = await page.evaluate(() => window.exampleGraph().nodes[0]);
  expect((copy as NodeData).content).toEqual(weighted);
});

test("content past a limit or malformed is refused naming the node, and the graph stays as it was", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0013
  await open(page);
  await loaded(page, { nodes: [node("a")], edges: [] });
  const refused = await page.evaluate(() => {
    const title = { kind: "text", role: "title", text: "t" };
    const patches: unknown[] = [
      { content: Array.from({ length: 9 }, () => [title]) },
      { content: [Array.from({ length: 7 }, () => title)] },
      { content: [5] },
      { content: [[{ ...title, kind: "badge" }]] },
      { content: [[{ ...title, weight: -1 }]] },
      { content: [[{ ...title, role: "headline" }]] },
      { content: [[{ ...title, text: 5 }]] },
      { content: [[{ ...title, text: "x".repeat(1001) }]] },
    ];
    return patches.map((patch) => {
      try {
        window.comb.updateNode("a", patch as never);
        return "accepted";
      } catch (error) {
        return (error as Error & { problem: { kind: string } }).problem;
      }
    });
  });
  const at = { node: "a", row: 0, column: 0 };
  expect(refused).toEqual([
    { kind: "tooManyRows", node: "a", limit: 8 },
    { kind: "tooManyColumns", node: "a", row: 0, limit: 6 },
    { kind: "invalidContentShape", index: 0, id: "a", row: 0, expected: "a list of elements" },
    { kind: "invalidElementKind", ...at },
    { kind: "invalidWeight", ...at },
    { kind: "invalidRole", ...at },
    { kind: "invalidContentText", ...at, field: "text" },
    { kind: "contentTextTooLong", ...at, field: "text", limit: 1000 },
  ]);
  const drawn = await drawnNode(page, "a");
  expect(drawn).toMatchObject({ height: NODE_HEIGHT, title: "a" });
  expect(drawn!.texts).toHaveLength(1);
});

test("a text of characters beyond the measured ones is cut within its column", async ({ page }) => {
  // Verifies: ADR-0013
  await open(page);
  const texts = [
    "数据驱动的增长指标与留存率的关系",
    "📈🚀🔥💡✨🎯📊🧭🌍🔔",
    "Δ 漢字 😀 mixed 文字 🚀 text",
  ];
  await loaded(page, {
    nodes: texts.map((value, i) => ({
      ...node(`n${i}`, 0, i * 100),
      width: 120,
      content: [[text("title", value)]],
    })),
    edges: [],
  });
  for (let i = 0; i < texts.length; i++) {
    const [drawn] = (await drawnNode(page, `n${i}`))!.texts!;
    expect(drawn!.drawn.endsWith("…")).toBe(true);
    expect(drawn!.drawnWidth).toBeLessThanOrEqual(drawn!.width);
  }
});

test("a node's connectors follow the height its content lays out to", async ({ page }) => {
  // Verifies: ADR-0013, ADR-0024
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content: TALL }], edges: [] });
  /** The connectors drawn while the pointer is over the node, by side. */
  const connectors = async () => {
    const at = await page.evaluate(() => {
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const point = window.screenPoint(110, 20);
      return { x: rect.left + point.x, y: rect.top + point.y };
    });
    await page.mouse.move(at.x, at.y);
    return page.evaluate(async () => {
      await window.comb.whenRendered();
      const points = window.inspect().connectorPoints;
      return Object.fromEntries(points.map(({ side, x, y }) => [side, [x, y]]));
    });
  };
  expect(await connectors()).toEqual({
    top: [110, 0],
    right: [NODE_WIDTH, TALL_HEIGHT / 2],
    bottom: [110, TALL_HEIGHT],
    left: [0, TALL_HEIGHT / 2],
  });
  await page.evaluate(() =>
    window.comb.updateNode("b", { content: [[{ kind: "text", role: "title", text: "b" }]] }),
  );
  await page.mouse.move(0, 0);
  expect(await connectors()).toEqual({
    top: [110, 0],
    right: [NODE_WIDTH, NODE_HEIGHT / 2],
    bottom: [110, NODE_HEIGHT],
    left: [0, NODE_HEIGHT / 2],
  });
});
