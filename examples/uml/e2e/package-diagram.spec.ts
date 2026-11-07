// Browser tests of the UML example's package diagram (G-12): the choice in the sidebar, Comb's
// modules and crates as packages, their dependencies as dashed edges with an arrowhead and the
// label «import» or «use», which the legend names, and the class diagram kept while the package
// diagram is shown.
import { expect, test, type Page } from "@playwright/test";
import { DRAWN, open, setViewport } from "./shared";

/** Comb's modules and crates, as the package diagram names them. */
const PACKAGES = ["api", "bridge", "store", "interaction", "render", "engine-wasm", "engine"];

/** The dependencies between them, written from the imports of `packages/comb/src` without its
 *  tests and from `crates/engine-wasm/Cargo.toml`: a module's import of another «import», the
 *  bridge's load of the WebAssembly package and the bridge crate's use of the core «use». */
const DEPENDENCIES = [
  ["api", "bridge", "«import»"],
  ["api", "store", "«import»"],
  ["api", "interaction", "«import»"],
  ["api", "render", "«import»"],
  ["interaction", "bridge", "«import»"],
  ["interaction", "store", "«import»"],
  ["render", "bridge", "«import»"],
  ["render", "store", "«import»"],
  ["store", "bridge", "«import»"],
  ["bridge", "engine-wasm", "«use»"],
  ["engine-wasm", "engine", "«use»"],
] as const;

/** Chooses `diagram` in the sidebar and waits until its load has drawn. */
async function choose(page: Page, diagram: "class" | "package"): Promise<void> {
  await page.locator("#diagram").selectOption(diagram);
  await page.evaluate(() => window.uml.loadReport);
}

/** What the canvas draws: the identifiers of its nodes and edges, sorted. */
async function drawn(page: Page) {
  return page.evaluate(async () => {
    window.uml.comb.fitView();
    await window.uml.comb.whenRendered();
    const { nodes, edges } = window.uml.inspect();
    return {
      nodes: nodes.map(({ id }) => id).sort(),
      edges: edges.map(({ id }) => id).sort(),
    };
  });
}

test("the package diagram shows only Comb's modules and crates, each a «package» of its name", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  await expect(page.locator("#diagram option")).toHaveText([
    "Class diagram",
    "Package diagram",
    "State diagram",
  ]);
  await choose(page, "package");
  const graph = await page.evaluate(() => window.uml.exampleGraph());
  expect(graph.nodes.map(({ id }) => id).sort()).toEqual([...PACKAGES].sort());
  expect(await drawn(page)).toEqual({
    nodes: [...PACKAGES].sort(),
    edges: graph.edges.map(({ id }) => id).sort(),
  });
  for (const name of PACKAGES) {
    const node = graph.nodes.find(({ id }) => id === name)!;
    await setViewport(page, { x: 100 - node.x, y: 100 - node.y, scale: 1 });
    const texts = await page.evaluate(
      (wanted) => window.uml.inspect().nodes.find(({ id }) => id === wanted)!.texts!,
      name,
    );
    expect(texts.map(({ drawn: text }) => text)).toEqual(["«package»", name]);
  }
  await expect(page.locator("#count")).toHaveText("7 packages, 11 dependencies");
  await expect(page.locator("#palette li:visible")).toHaveText(["Package"]);
});

test("each dependency of the package diagram is dashed, has an arrowhead, and says «import» or «use»", async ({
  page,
}) => {
  // Verifies: G-12, G-11
  await page.goto("/");
  await open(page);
  await choose(page, "package");
  const { edges } = await page.evaluate(() => window.uml.exampleGraph());
  expect(edges.map(({ source, target, label }) => [source, target, label?.text]).sort()).toEqual(
    DEPENDENCIES.map((each) => [...each]).sort(),
  );
  const { color } = DRAWN.dependency!;
  for (const edge of edges) {
    expect(edge.dash, edge.id).toEqual([6, 4]);
    expect(edge.arrow, edge.id).toBe("end");
    expect(edge.color, edge.id).toBe(color);
    expect(edge.label?.background, edge.id).toBe(color);
  }
});

test("the package diagram's legend names a dependency «import» and a dependency «use»", async ({
  page,
}) => {
  // Verifies: G-12, G-11
  await page.goto("/");
  await open(page);
  await choose(page, "package");
  await expect(page.locator("#legend")).toBeVisible();
  const dependency = page.locator('#legend-kinds li[data-kind="dependency"]');
  await expect(dependency).toContainText("«import»");
  await expect(dependency).toContainText("«use»");
});

test("chosen again after the package diagram, the class diagram's legend names a dependency «use» alone", async ({
  page,
}) => {
  // Verifies: G-12, G-11
  await page.goto("/");
  await open(page);
  const dependency = page.locator('#legend-kinds li[data-kind="dependency"]');
  await choose(page, "package");
  await expect(dependency).toHaveText("Dependency «import» or «use»");
  await choose(page, "class");
  await expect(dependency).toHaveText("Dependency «use»");
});

for (const diagram of ["class", "package"] as const)
  test(`the legend names each label an edge of the ${diagram} diagram carries, beside its kind`, async ({
    page,
  }) => {
    // Verifies: G-12, G-11
    await page.goto("/");
    await open(page);
    await choose(page, diagram);
    const { labels, kinds } = await page.evaluate(() => ({
      labels: window.uml
        .exampleGraph()
        .edges.flatMap(({ id, label }) => (label ? [[id, label.text] as const] : [])),
      kinds: window.uml.edgeKinds(),
    }));
    expect(labels.length).toBeGreaterThan(0);
    for (const [id, text] of labels)
      await expect(page.locator(`#legend-kinds li[data-kind="${kinds[id]}"]`), id).toContainText(
        text,
      );
  });

test("chosen again, the class diagram is shown with the nodes and edges it had, an edit among them", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  await setViewport(page, { x: 0, y: 0, scale: 1 });
  await page
    .locator('#palette [data-kind="class"]')
    .dragTo(page.locator("#canvas canvas"), { targetPosition: { x: 400, y: 500 } });
  const before = await page.evaluate(() => ({
    graph: window.uml.exampleGraph(),
    kinds: window.uml.edgeKinds(),
  }));
  expect(before.graph.nodes.map(({ id }) => id)).toContain("class-1");
  await choose(page, "package");
  await choose(page, "class");
  const after = await page.evaluate(() => ({
    graph: window.uml.exampleGraph(),
    kinds: window.uml.edgeKinds(),
  }));
  expect(after).toEqual(before);
  expect(await drawn(page)).toEqual({
    nodes: before.graph.nodes.map(({ id }) => id).sort(),
    edges: before.graph.edges.map(({ id }) => id).sort(),
  });
  await expect(page.locator("#palette li:visible")).toHaveText([
    "Class",
    "Interface",
    "Abstract class",
  ]);
});
