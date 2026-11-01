import { expect, test, type Page } from "@playwright/test";
import { HEIGHTS } from "../src/graph";
import { clickWorld, NODE_HEIGHT, open, POLICY, screenCentre, setViewport } from "./shared";

/** Node `id` as the canvas draws it at the near level, with the viewport moved so that its
 *  top-left corner lies at (100, 100) on the canvas at scale 1. */
async function nearNode(page: Page, id: string) {
  const { x, y } = await page.evaluate(
    (wanted) => window.exampleGraph().nodes.find((node) => node.id === wanted)!,
    id,
  );
  await setViewport(page, { x: 100 - x, y: 100 - y, scale: 1 });
  return page.evaluate((wanted) => {
    const node = window.inspect().nodes.find((each) => each.id === wanted)!;
    return {
      height: node.height,
      icons: node.icons!.map(({ texture }) => texture),
      texts: node.texts!.map(({ kind, drawn }) => `${kind} ${drawn}`),
      pills: node.pills!.map(({ color }) => color),
      bars: node.bars!.map(({ width, color }) => [Math.round(width * 10) / 10, color]),
      arrows: node.arrows!.map(({ color }) => color),
    };
  }, id);
}

/** What the canvas draws of each type of node of the example: a bet with its hypothesis and its
 *  status badge, an epic with its progress bar and status badge, an input metric with values over
 *  three periods and coloured trends, the north-star metric, and a KPI, each with the icon of its
 *  type beside its title and "Details". */
const TYPES = {
  "0:0.0": {
    height: HEIGHTS.bet,
    icons: ["bet"],
    texts: [
      "text Launch push notifications",
      "text Reminders bring listeners back",
      "badge Testing",
      "action Details",
    ],
    pills: [0x1d4ed8],
    bars: [],
    arrows: [],
  },
  "0:1.1": {
    height: HEIGHTS.epic,
    icons: ["epic"],
    texts: ["text Social notifications", "text 60%", "badge In progress", "action Details"],
    pills: [0x1d4ed8],
    // 60 % of a bar of 196 less the gap and the caption's column, then the track.
    bars: [
      [90.2, 0x2563eb],
      [60.2, 0xe5e7eb],
    ],
    arrows: [],
  },
  "0:2.1": {
    height: HEIGHTS["input-metric"],
    icons: ["input-metric"],
    texts: [
      "text Avg. sessions per week",
      ...["Q1 4.1 2%", "Q2 4.4 7%", "Q3 4.3 2%"].flatMap((period) =>
        period.split(" ").map((part) => `metric ${part}`),
      ),
      "text Last three quarters",
      "action Details",
    ],
    pills: [],
    bars: [],
    arrows: [0x15803d, 0x15803d, 0xb91c1c],
  },
  "0:3.0": {
    height: HEIGHTS["north-star"],
    icons: ["north-star"],
    texts: [
      "text Weekly listening time",
      "metric Hours per subscriber and week",
      "metric 6.2 h",
      "metric 4%",
      "text North-star metric",
      "action Details",
    ],
    pills: [],
    bars: [],
    arrows: [0x15803d],
  },
  "0:4.1": {
    height: HEIGHTS.kpi,
    icons: ["kpi"],
    texts: [
      "text Monthly retention",
      "metric Last month",
      "metric 92%",
      "metric 1%",
      "text KPI",
      "action Details",
    ],
    pills: [],
    bars: [],
    arrows: [0xb91c1c],
  },
};

test("the example draws the metric tree on a canvas beside its sidebar", async ({ page }) => {
  // Verifies: ADR-0008 — the golden path, built, served, and driven by the toolchain it decides.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Verifies: Q-6 — every browser test runs under the policy the test server sends.
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toBe(POLICY);
  await open(page);
  await expect(page.locator("#canvas canvas")).toBeVisible();
  await expect(page.locator("#count")).toHaveText("15 nodes, 15 edges");
  // WebGL2, not PixiJS's Canvas 2D fallback, which draws no edge mesh.
  expect(await page.evaluate(() => window.inspect().renderer)).toBe("webgl");
  // The bridge in test mode, so that a view kept across an engine call fails the suite.
  expect(await page.evaluate(() => window.testMode())).toBe(true);
  expect(errors).toEqual([]);
});

test("the copies query parameter sets the size without the control", async ({ page }) => {
  await open(page, "?copies=10");
  await expect(page.locator("#copies")).toHaveValue("10");
  await expect(page.locator("#count")).toHaveText("150 nodes, 150 edges");
  expect((await page.evaluate(() => window.loadReport)).nodes).toBe(150);
});

test("picking the largest copies option shows at least 50,000 nodes and edges", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  const largest = await page
    .locator("#copies option")
    .evaluateAll((options) => (options.at(-1) as HTMLOptionElement).value);
  await page.locator("#copies").selectOption(largest);
  const report = await page.evaluate(() => window.loadReport);
  expect(report.nodes).toBeGreaterThanOrEqual(50_000);
  expect(report.edges).toBeGreaterThanOrEqual(50_000);
  await expect(page.locator("#count")).toHaveText(`${report.nodes} nodes, ${report.edges} edges`);
  // Shown, not only loaded: the canvas draws every node and edge, since all are in view, at the
  // far level: nodes as particles, no text, and a number of display objects that does not grow
  // with the graph, apart from the one particle container.
  const drawn = await page.evaluate(() => {
    const snapshot = window.inspect();
    return {
      level: snapshot.level,
      nodes: snapshot.nodes.length,
      particles: snapshot.particles,
      edges: snapshot.edges.length,
      texts: snapshot.texts,
    };
  });
  expect(drawn).toEqual({
    level: "far",
    nodes: report.nodes,
    particles: report.nodes,
    edges: report.edges,
    texts: 0,
  });
  // Verifies: ADR-0027
  // The world, the edges layer and its mesh, the particle container, and the empty layers of
  // node views, labels, and connectors.
  expect(await page.evaluate(() => window.inspect().displayObjects)).toBe(7);
});

test("each type of node shows the elements of its type, as inspection reports them", async ({
  page,
}) => {
  // Verifies: G-9, G-10 — the node types differ only in the content the example describes.
  await open(page);
  for (const [id, drawn] of Object.entries(TYPES)) {
    expect({ id, ...(await nearNode(page, id)) }).toEqual({ id, ...drawn });
  }
  // Each node's middle lies where a node of one title had it, the middle of its row, so that the
  // edges meet the nodes where the reference image of edge-styles.spec.ts draws them: the rows of
  // a column 110 apart and centred on y = 0, each a node of one title high.
  const middles = await page.evaluate(async () => {
    window.comb.fitView();
    await window.comb.whenRendered();
    return window.inspect().nodes.map(({ id, y, height }) => [id, y + height / 2] as const);
  });
  const rows = [2, 5, 4, 1, 3];
  const expected = rows.flatMap((count, column) =>
    Array.from({ length: count }, (_, row) => [
      `0:${column}.${row}`,
      (row - (count - 1) / 2) * 110 + NODE_HEIGHT / 2,
    ]),
  );
  expect(new Map(middles)).toEqual(new Map(expected as [string, number][]));
});

test("a bet's status changed in the sidebar shows on its badge", async ({ page }) => {
  // Verifies: G-9
  await open(page);
  const bet = await screenCentre(page, "0:0.0");
  await page.mouse.click(bet.x, bet.y);
  await expect(page.locator("#title")).toHaveValue("Launch push notifications");
  await expect(page.locator("#status")).toHaveValue("Testing");
  await page.locator("#status").selectOption("Invalidated");
  await page.evaluate(() => window.comb.whenRendered());
  const drawn = await nearNode(page, "0:0.0");
  expect(drawn).toEqual({
    ...TYPES["0:0.0"],
    texts: [...TYPES["0:0.0"].texts.slice(0, 2), "badge Invalidated", "action Details"],
    pills: [0xb91c1c],
  });
});

test("a click on Details selects its node and opens the sidebar on it", async ({ page }) => {
  // Verifies: G-9, G-10
  await open(page);
  await expect(page.locator("#selection")).toBeHidden();
  await nearNode(page, "0:2.1");
  const { x, y } = await page.evaluate(() => {
    const node = window.inspect().nodes.find(({ id }) => id === "0:2.1")!;
    const details = node.texts!.find(({ kind }) => kind === "action")!;
    return { x: node.x + details.x + 8, y: node.y + details.y + 8 };
  });
  await clickWorld(page, x, y);
  await expect(page.locator("#selection")).toBeVisible();
  await expect(page.locator("#node-type")).toHaveText("Input metric");
  await expect(page.locator("#title")).toHaveValue("Avg. sessions per week");
  await expect(page.locator("#title")).toBeFocused();
  await expect(page.locator("#periods fieldset")).toHaveCount(3);
  expect(await page.evaluate(() => window.inspect().highlighted)).toBe("0:2.1");
});

test("at 3,334 copies the example holds 50,010 nodes, each with the content of its type", async ({
  page,
}) => {
  // Verifies: G-9
  test.setTimeout(120_000);
  await open(page, "?copies=3334");
  expect((await page.evaluate(() => window.loadReport)).nodes).toBe(50_010);
  await expect(page.locator("#count")).toHaveText("50010 nodes, 50010 edges");
  // The last copy's nodes, as the first copy's, drawn at the near level.
  for (const [id, drawn] of Object.entries(TYPES)) {
    const last = id.replace(/^0:/, "3333:");
    expect({ last, ...(await nearNode(page, last)) }).toEqual({ last, ...drawn });
  }
});

test("the sidebar edits a node from its own content once another caller replaced it, and from its fields across its own edits", async ({
  page,
}) => {
  // Verifies: G-9
  await open(page);
  // The host replaces the north-star metric's content directly, not through the sidebar.
  await page.evaluate(() =>
    window.comb.updateNode("0:3.0", {
      content: [[{ kind: "text", role: "title", text: "North star" }]],
    }),
  );
  const star = await screenCentre(page, "0:3.0");
  await page.mouse.click(star.x, star.y);
  await expect(page.locator("#title")).toHaveValue("North star");
  await expect(page.locator("#periods fieldset")).toHaveCount(0);
  await page.locator("#title").fill("Listening time");
  const content = await page.evaluate(
    () => window.exampleGraph().nodes.find(({ id }) => id === "0:3.0")!.content,
  );
  expect(content).toEqual([[expect.objectContaining({ role: "title", text: "Listening time" })]]);
  expect(content[0]).toHaveLength(1);

  // A bet edited twice through the sidebar keeps both edits and the rest of its content.
  const bet = await screenCentre(page, "0:0.0");
  await page.mouse.click(bet.x, bet.y);
  await page.locator("#status").selectOption("Validated");
  await page.locator("#hypothesis").fill("Reminders double the return rate");
  await page.evaluate(() => window.comb.whenRendered());
  expect(await nearNode(page, "0:0.0")).toEqual({
    ...TYPES["0:0.0"],
    texts: [
      "text Launch push notifications",
      "text Reminders double the return rate",
      "badge Validated",
      "action Details",
    ],
    pills: [0x15803d],
  });
});

test("the sidebar drops a selected node's type fields once another caller replaces its content", async ({
  page,
}) => {
  // Verifies: G-9
  await open(page);
  const bet = await screenCentre(page, "0:0.0");
  await page.mouse.click(bet.x, bet.y);
  await expect(page.locator("#status-field")).toBeVisible();
  await expect(page.locator("#hypothesis-field")).toBeVisible();
  await page.evaluate(() =>
    window.comb.updateNode("0:0.0", {
      content: [[{ kind: "text", role: "title", text: "Replaced" }]],
    }),
  );
  await expect(page.locator("#status-field")).toBeHidden();
  await expect(page.locator("#hypothesis-field")).toBeHidden();
  await expect(page.locator("#node-type")).toHaveText("");
  await expect(page.locator("#title")).toHaveValue("Replaced");
});
