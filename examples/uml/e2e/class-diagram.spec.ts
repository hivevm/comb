// Browser tests of the UML example's class diagram (G-12), through the hooks the example sets
// under `window.uml` and the functions of comb/testing.
import { expect, test, type Page } from "@playwright/test";
import {
  CLASSIFIERS,
  RELATIONSHIPS as EDGES,
  contentOf,
  ELLIPSIS,
  NODE_WIDTH,
  ROW_LIMIT,
  shownMembers,
} from "../src/class-diagram";
import { KINDS, RELATIONSHIPS } from "../src/relationships";

/** The Content Security Policy of Q-6, which the test server sends with every response. */
const POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";

/** Opens the example and waits until its first load has drawn. */
async function open(page: Page): Promise<void> {
  // The example sets its hooks after a top-level await, which the load event does not wait for.
  await page.waitForFunction(() => "uml" in window);
  await page.evaluate(() => window.uml.loadReport);
}

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

test("the UML example draws the class diagram beside its sidebar, the class diagram its one choice", async ({
  page,
}) => {
  // Verifies: G-12
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toBe(POLICY);
  await open(page);
  await expect(page.locator("#canvas canvas")).toBeVisible();
  await expect(page.locator("#diagram option")).toHaveText(["Class diagram"]);
  const report = await page.evaluate(() => window.uml.loadReport);
  expect(report).toEqual({ diagram: "class", nodes: CLASSIFIERS.length, edges: EDGES.length });
  await expect(page.locator("#count")).toHaveText(
    `${CLASSIFIERS.length} classes and interfaces, ${EDGES.length} relationships`,
  );
  const drawn = await page.evaluate(() => window.uml.inspect());
  expect(drawn.renderer).toBe("webgl");
  expect(drawn.nodes.map(({ id }) => id).sort()).toEqual(CLASSIFIERS.map(({ id }) => id).sort());
  expect(errors).toEqual([]);
});

test("each class or interface is a node of its stereotype, name, and members, placed by heightOf", async ({
  page,
}) => {
  // Verifies: G-12, G-10, ADR-0026
  await page.goto("/");
  await open(page);
  const { graph, heights, drawn } = await page.evaluate(() => {
    const copy = window.uml.exampleGraph();
    const { nodes } = window.uml.inspect();
    return {
      graph: copy,
      heights: copy.nodes.map((node) => window.uml.comb.heightOf(node.content, node.width)),
      drawn: Object.fromEntries(nodes.map(({ id, x, y, height }) => [id, { x, y, height }])),
    };
  });
  for (const classifier of CLASSIFIERS) {
    const node = graph.nodes.find(({ id }) => id === classifier.id)!;
    expect(node.content).toEqual(contentOf(classifier));
    const rows = node.content.map((row) =>
      row.map((each) => (each.kind === "text" ? `${each.role} ${each.text}` : each.kind)),
    );
    const head = classifier.stereotype ? [`caption ${classifier.stereotype}`] : [];
    const members = [...classifier.attributes, ...classifier.operations];
    const fit = ROW_LIMIT - head.length - 1;
    // Every member where they fit, otherwise the first that fit before a row of "…".
    const shown = members.length <= fit ? members : [...members.slice(0, fit - 1), ELLIPSIS];
    expect(rows).toEqual(
      [...head, `title ${classifier.name}`, ...shown.map((text) => `body ${text}`)].map((row) => [
        row,
      ]),
    );
  }
  // Comb's and EdgeData's members are more than fit.
  expect(shownMembers(CLASSIFIERS.find(({ id }) => id === "Comb")!).at(-1)).toBe(ELLIPSIS);
  expect(shownMembers(CLASSIFIERS.find(({ id }) => id === "EdgeData")!).at(-1)).toBe(ELLIPSIS);
  // Each node is drawn as high as heightOf gives its content, and where it was placed.
  graph.nodes.forEach((node, i) => {
    expect(drawn[node.id]).toEqual({ x: node.x, y: node.y, height: heights[i] });
  });
  // Placed by those heights, no node overlaps another.
  for (const [i, a] of graph.nodes.entries())
    for (const [j, b] of graph.nodes.entries()) {
      if (j <= i) continue;
      const apart =
        a.x + NODE_WIDTH <= b.x ||
        b.x + NODE_WIDTH <= a.x ||
        a.y + heights[i]! <= b.y ||
        b.y + heights[j]! <= a.y;
      expect(apart, `${a.id} and ${b.id} overlap`).toBe(true);
    }
});

/** The texts the canvas draws of node `id` near, at scale 1. */
async function nearTexts(page: Page, id: string): Promise<string[]> {
  return page.evaluate(async (wanted) => {
    const node = window.uml.exampleGraph().nodes.find((each) => each.id === wanted)!;
    window.uml.comb.setViewport({ x: 100 - node.x, y: 100 - node.y, scale: 1 });
    await window.uml.comb.whenRendered();
    const drawn = window.uml.inspect().nodes.find((each) => each.id === wanted)!;
    return drawn.texts!.map(({ drawn: text }) => text);
  }, id);
}

test("near, a node draws its stereotype, its name, and its members, the members past its rows as …", async ({
  page,
}) => {
  // Verifies: G-12, G-10
  await page.goto("/");
  await open(page);
  const edgeLayer = CLASSIFIERS.find(({ id }) => id === "EdgeLayer")!;
  expect(await nearTexts(page, "EdgeLayer")).toEqual([
    edgeLayer.stereotype,
    edgeLayer.name,
    ...edgeLayer.operations,
  ]);
  const comb = CLASSIFIERS.find(({ id }) => id === "Comb")!;
  expect(await nearTexts(page, "Comb")).toEqual([
    comb.stereotype,
    comb.name,
    ...comb.operations.slice(0, ROW_LIMIT - 3),
    ELLIPSIS,
  ]);
});

test("each relationship is drawn as the conventions draw its kind, every kind among them", async ({
  page,
}) => {
  // Verifies: G-12, G-11
  await page.goto("/");
  await open(page);
  const { edges, kinds, drawn } = await page.evaluate(async () => {
    // Near, so that every label is drawn.
    window.uml.comb.setViewport({ x: 0, y: 0, scale: 1 });
    await window.uml.comb.whenRendered();
    const scene = window.uml.inspect();
    return {
      edges: window.uml.exampleGraph().edges,
      kinds: window.uml.edgeKinds(),
      drawn: scene.edges.map(({ id }) => id),
    };
  });
  expect(new Set(Object.values(kinds))).toEqual(new Set(KINDS));
  for (const edge of edges) {
    const style = RELATIONSHIPS[kinds[edge.id]!];
    expect(edge.color).toBe(style.color);
    expect(edge.dash).toEqual(style.dash);
    expect(edge.arrow).toBe(style.arrow);
    expect(edge.label?.text).toBe(style.label?.text);
    if (edge.label)
      expect(edge.label).toMatchObject({ t: style.label!.t, background: style.color });
  }
  await page.evaluate(() => window.uml.comb.fitView());
  const shown = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.map(({ id }) => id);
  });
  expect(shown.sort()).toEqual(edges.map(({ id }) => id).sort());
  expect(drawn.length).toBeGreaterThan(0);
});

test("the labels of dependencies, aggregations, and compositions are drawn on their edges", async ({
  page,
}) => {
  // Verifies: G-12, G-11
  await page.goto("/");
  await open(page);
  const { labels, kinds } = await page.evaluate(async () => {
    const graph = window.uml.exampleGraph();
    const drawn: [string, string][] = [];
    // Each labelled edge in turn, its label in the middle of the canvas at scale 1.
    for (const edge of graph.edges.filter((each) => each.label)) {
      const [source, target] = [edge.source, edge.target].map((id) =>
        graph.nodes.find((node) => node.id === id)!,
      );
      const x = (source!.x + target!.x) / 2;
      const y = (source!.y + target!.y) / 2;
      window.uml.comb.setViewport({ x: 400 - x, y: 300 - y, scale: 1 });
      await window.uml.comb.whenRendered();
      const label = window.uml.inspect().edgeLabels.find((each) => each.edge === edge.id);
      drawn.push([edge.id, label?.text ?? ""]);
    }
    return { labels: drawn, kinds: window.uml.edgeKinds() };
  });
  expect(labels.length).toBeGreaterThan(0);
  for (const [id, text] of labels) expect(text, id).toBe(RELATIONSHIPS[kinds[id]!].label!.text);
});

test("the legend names each kind beside a line of its colour, dash pattern, and arrowhead", async ({
  page,
}) => {
  // Verifies: G-12, G-11
  await page.goto("/");
  await open(page);
  const items = page.locator("#legend-kinds li");
  await expect(items).toHaveCount(KINDS.length);
  for (const [i, kind] of KINDS.entries()) {
    const { name, color, dash, arrow, label } = RELATIONSHIPS[kind];
    const item = items.nth(i);
    await expect(item).toHaveText(label ? `${name} ${label.text}` : name);
    const line = item.locator("line");
    await expect(line).toHaveAttribute("stroke", hex(color));
    if (dash) await expect(line).toHaveAttribute("stroke-dasharray", dash.join(" "));
    else await expect(line).not.toHaveAttribute("stroke-dasharray", /.*/);
    await expect(item.locator("polygon")).toHaveCount(arrow === "end" ? 1 : 0);
  }
});
