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

test("a badge is drawn near as a pill of its colour around its text, and the middle and far level draw none", async ({
  page,
}) => {
  // Verifies: ADR-0013, ADR-0027
  // A title, then a green badge beside a blue one, each in a column of 94: the pill hugs its text,
  // 8 either side, and is 22 high, the body's line of 16 and 3 above and below; the row is 22.
  const content: NodeContent = [
    [text("title", "Bet")],
    [
      { kind: "badge", text: "Done", color: 0x22c55e },
      { kind: "badge", text: "Blocked by the platform team", color: 0x2563eb },
    ],
  ];
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content }], edges: [] });
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const drawn = (await drawnNode(page, "b"))!;
  // The pills as the view's `Graphics` draws them, and the texts on them.
  const [donePill, blockedPill] = drawn.pills!;
  expect(drawn.pills).toHaveLength(2);
  expect(donePill).toMatchObject({ x: 12, y: 28, height: 22, color: 0x22c55e });
  expect(blockedPill).toMatchObject({ x: 114, y: 28, height: 22, color: 0x2563eb });
  const [, done, blocked] = drawn.texts!;
  expect(done).toMatchObject({ kind: "badge", role: "body", drawn: "Done", fill: 0x1f2430 });
  expect(blocked).toMatchObject({ kind: "badge", role: "body", fill: 0xffffff });
  // Each pill as wide as its text is drawn and the padding, within Q-4, and within its column:
  // the long text cut with an ellipsis inside the padding.
  for (const [pill, onIt] of [
    [donePill!, done!],
    [blockedPill!, blocked!],
  ] as const) {
    expect(Math.abs(pill.width - (onIt.drawnWidth + 16))).toBeLessThanOrEqual(0.5);
    expect(pill.width).toBeLessThanOrEqual(94);
  }
  expect(blocked!.drawn.endsWith("…")).toBe(true);
  expect(drawn.height).toBe(64);
  const at = async (scale: number) => {
    await setViewport(page, { x: 100, y: 100, scale });
    return page.evaluate(async () => {
      await window.comb.whenRendered();
      const { level, nodes, texts } = window.inspect();
      const [shown] = nodes;
      return { level, texts, kinds: shown?.texts?.map(({ kind }) => kind), pills: shown?.pills };
    });
  };
  expect(await at(0.5)).toEqual({ level: "middle", texts: 1, kinds: ["text"], pills: [] });
  expect(await at(0.2)).toEqual({ level: "far", texts: 0, kinds: undefined, pills: undefined });
  // Near again the pills are drawn; once updateNode takes the badges away, none.
  expect((await at(1)).pills).toHaveLength(2);
  await page.evaluate(() =>
    window.comb.updateNode("b", { content: [[{ kind: "text", role: "title", text: "Bet" }]] }),
  );
  expect(await at(1)).toEqual({ level: "near", texts: 1, kinds: ["text"], pills: [] });
});

/** Asserts that `pieces` match `expected`, each `[x, y, width, height, color]`, within 0.5 (Q-4)
 *  and of its colour exactly, in order. */
function expectPieces(
  pieces: { x: number; y: number; width: number; height: number; color: number }[],
  expected: number[][],
) {
  expect(pieces).toHaveLength(expected.length);
  pieces.forEach(({ x, y, width, height, color }, i) => {
    const [ex, ey, ew, eh, ecolor] = expected[i]!;
    for (const [got, want] of [
      [x, ex],
      [y, ey],
      [width, ew],
      [height, eh],
    ])
      expect(Math.abs(got! - want!)).toBeLessThanOrEqual(0.5);
    expect(color).toBe(ecolor);
  });
}

test("a progress bar is drawn near as its segments from its column's left and its track after them, and the middle and far level draw none", async ({
  page,
}) => {
  // Verifies: ADR-0013, ADR-0027, Q-4
  // A title, then a bar of 0.3 green and 0.2 grey alone in its row, its column 196 wide from 12,
  // then a caption beside a bar of 0.5 blue weighted 3, its column 141 wide from 67. Each bar is
  // 8 high in the middle of a body's line of 16: from 32 in the row from 28, from 48 in the row
  // from 44; the node is 10 + 18 + 16 + 16 + 10 = 70 high.
  const [green, grey, blue] = [0x22c55e, 0x9ca3af, 0x2563eb];
  const content: NodeContent = [
    [text("title", "Bet")],
    [
      {
        kind: "progress",
        segments: [
          { fraction: 0.3, color: green },
          { fraction: 0.2, color: grey },
        ],
      },
    ],
    [
      text("caption", "c"),
      { kind: "progress", segments: [{ fraction: 0.5, color: blue }], weight: 3 },
    ],
  ];
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content }], edges: [] });
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const drawn = (await drawnNode(page, "b"))!;
  expect(drawn.height).toBe(70);
  // The pieces as the view's `Graphics` draws them, read from its fills: each bar's segments in
  // order from its column's left, then its track in the track colour.
  const track = 0xe5e7eb;
  const expected = [
    [12, 32, 58.8, 8, green],
    [70.8, 32, 39.2, 8, grey],
    [110, 32, 98, 8, track],
    [67, 48, 70.5, 8, blue],
    [137.5, 48, 70.5, 8, track],
  ];
  expectPieces(drawn.bars!, expected);
  // A progress bar shows no text.
  expect(drawn.texts!.map(({ kind }) => kind)).toEqual(["text", "text"]);
  const at = async (scale: number) => {
    await setViewport(page, { x: 100, y: 100, scale });
    return page.evaluate(async () => {
      await window.comb.whenRendered();
      const { level, nodes } = window.inspect();
      return { level, bars: nodes[0]?.bars };
    });
  };
  expect(await at(0.5)).toEqual({ level: "middle", bars: [] });
  expect(await at(0.2)).toEqual({ level: "far", bars: undefined });
  // Near again the bars are drawn; once updateNode takes them away, none.
  expect((await at(1)).bars).toHaveLength(expected.length);
  await page.evaluate(() =>
    window.comb.updateNode("b", { content: [[{ kind: "text", role: "title", text: "Bet" }]] }),
  );
  expect(await at(1)).toEqual({ level: "near", bars: [] });
});

/** Asserts that `got` is `want` within 0.5 (Q-4). */
const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(0.5);

/** A metric of weight 1 showing `caption` over `value` and a trend of `shown`, `direction`, and
 *  `color`. */
const metric = (caption: string, value: string, shown: string, direction: string, color: number) =>
  ({ kind: "metric", caption, value, trend: { text: shown, direction, color } }) as const;

const [GREEN, RED, GREY] = [0x22c55e, 0xef4444, 0x6b7280];

/** A title, then a metric alone in its row, its cell the column of 196 from (12, 28) and two
 *  lines, the caption's of 14 and the body's of 16; then two metrics side by side, columns of 94
 *  from 12 and 114, from 58. The node is 10 + 18 + 30 + 30 + 10 = 98 high. */
const METRICS = [
  [text("title", "Bet")],
  [metric("Revenue", "42,000", "+3.5%", "up", GREEN)],
  [metric("Churn", "2.1%", "-0.4%", "down", RED), metric("NPS", "41", "±0", "flat", GREY)],
] as NodeContent;

/** The cells of the metrics of `METRICS`, and the triangle of each one's arrow from its square's
 *  top-left corner `(x, y)`. */
const METRIC_CELLS = [
  {
    left: 12,
    top: 28,
    width: 196,
    arrow: (x: number, y: number) => [x, y + 10, x + 10, y + 10, x + 5, y],
  },
  {
    left: 12,
    top: 58,
    width: 94,
    arrow: (x: number, y: number) => [x, y, x + 10, y, x + 5, y + 10],
  },
  {
    left: 114,
    top: 58,
    width: 94,
    arrow: (x: number, y: number) => [x, y, x, y + 10, x + 10, y + 5],
  },
];

test("a metric is drawn near as its caption over its value, its trend's arrow and text in the trend's colour", async ({
  page,
}) => {
  // Verifies: ADR-0013, Q-4
  // On each value's line the value lies at the column's left, the arrow 8 after it, a square of
  // 10 3 below the line's top, and the trend's text 4 after the arrow, to the column's end.
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content: METRICS }], edges: [] });
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const shown = (await drawnNode(page, "b"))!;
  expect(shown.height).toBe(98);
  const texts = shown.texts!.slice(1);
  expect(texts.map((t) => [t.kind, t.role, t.drawn, t.fill])).toEqual([
    ["metric", "caption", "Revenue", 0x6b7280],
    ["metric", "body", "42,000", 0x1f2430],
    ["metric", "body", "+3.5%", GREEN],
    ["metric", "caption", "Churn", 0x6b7280],
    ["metric", "body", "2.1%", 0x1f2430],
    ["metric", "body", "-0.4%", RED],
    ["metric", "caption", "NPS", 0x6b7280],
    ["metric", "body", "41", 0x1f2430],
    ["metric", "body", "±0", GREY],
  ]);
  // Each metric's parts where the engine placed them, its value as wide as it is drawn, and its
  // arrow, as the view's `Graphics` fills it, of its direction and the trend's colour.
  expect(shown.arrows!.map(({ color }) => color)).toEqual([GREEN, RED, GREY]);
  METRIC_CELLS.forEach(({ left, top, width, arrow }, m) => {
    const [caption, value, trend] = texts.slice(m * 3, m * 3 + 3);
    for (const [got, want] of [
      [caption!.x, left],
      [caption!.y, top],
      [caption!.width, width],
      [caption!.height, 14],
      [value!.x, left],
      [value!.y, top + 14],
      [value!.width, value!.drawnWidth],
      [value!.height, 16],
      [trend!.x, left + value!.width + 22],
      [trend!.y, top + 14],
      [trend!.x + trend!.width, left + width],
    ])
      near(got!, want!);
    const points = arrow(left + value!.width + 8, top + 17);
    shown.arrows![m]!.points.forEach((point, i) => near(point, points[i]!));
  });
});

test("the middle and far level draw no metric, and near draws it until updateNode takes it away", async ({
  page,
}) => {
  // Verifies: ADR-0013, ADR-0027
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content: METRICS }], edges: [] });
  const at = async (scale: number) => {
    await setViewport(page, { x: 100, y: 100, scale });
    return page.evaluate(async () => {
      await window.comb.whenRendered();
      const { level, nodes } = window.inspect();
      const [shown] = nodes;
      return { level, kinds: shown?.texts?.map(({ kind }) => kind), arrows: shown?.arrows };
    });
  };
  expect(await at(0.5)).toEqual({ level: "middle", kinds: ["text"], arrows: [] });
  expect(await at(0.2)).toEqual({ level: "far", kinds: undefined, arrows: undefined });
  expect((await at(1)).arrows).toHaveLength(3);
  await page.evaluate(() =>
    window.comb.updateNode("b", { content: [[{ kind: "text", role: "title", text: "Bet" }]] }),
  );
  expect(await at(1)).toEqual({ level: "near", kinds: ["text"], arrows: [] });
});

test("a trend's text takes each new colour on its pooled text object, and no text object is made for one", async ({
  page,
}) => {
  // Verifies: ADR-0013
  // One metric whose trend's colour changes 200 times: its pooled text object is drawn in each
  // colour in turn, and no further text object is bound for any of them.
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content: METRICS }], edges: [] });
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const drawn = await page.evaluate(async () => {
    const seen: { fill: unknown; texts: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const color = 0x010203 * (i + 1);
      window.comb.updateNode("b", {
        content: [
          [{ kind: "text", role: "title", text: "Bet" }],
          [
            {
              kind: "metric",
              caption: "c",
              value: "1",
              trend: { text: "t", direction: "up", color },
            },
          ],
        ],
      });
      await window.comb.whenRendered();
      const { nodes, texts } = window.inspect();
      seen.push({ fill: nodes[0]!.texts!.at(-1)!.fill, texts });
    }
    return seen;
  });
  expect(drawn.map(({ fill }) => fill)).toEqual(drawn.map((_, i) => 0x010203 * (i + 1)));
  expect(new Set(drawn.map(({ texts }) => texts)).size).toBe(1);
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
      { content: [[{ ...title, kind: "chart" }]] },
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
