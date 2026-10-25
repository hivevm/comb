// A query's edge mesh within its budget (ADR-0027): graph data the bridge accepts never runs the
// engine out of memory, at any viewport.
import { expect, test } from "@playwright/test";
import { open } from "./shared";

test("20,000 edges between two nodes far apart draw zoomed in, and a later graph draws", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0027
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.evaluate(async () => {
    window.comb.load({
      nodes: [window.node("a", 0, 0), window.node("b", -1e7, 3e6)],
      edges: Array.from({ length: 20_000 }, (_, i) => ({ id: `e${i}`, source: "a", target: "b" })),
    });
    await window.comb.whenRendered();
  });
  // Not awaited through whenRendered: a frame that traps never resolves it.
  const drawn = await page.evaluate(async () => {
    const before = window.renderCount();
    window.comb.setViewport({ x: 0, y: 0, scale: 4 });
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    const rendered = window.renderCount() > before;
    try {
      const { edgeMesh, edges } = window.inspect();
      return { rendered, mesh: edgeMesh, edges: edges.length };
    } catch (error) {
      // After a trap every call into the engine fails; the page error says why.
      return { rendered, inspected: String(error) };
    }
  });
  expect(errors).toEqual([]);
  expect(drawn).toMatchObject({ rendered: true, edges: 20_000, mesh: { detail: "complete" } });
  expect(drawn.mesh!.vertices).toBeGreaterThan(0);
  const after = await page.evaluate(async () => {
    window.comb.load({
      nodes: [window.node("c", 0), window.node("d", 300)],
      edges: [{ id: "f", source: "c", target: "d" }],
    });
    window.comb.setViewport({ x: 0, y: 100, scale: 1 });
    await window.comb.whenRendered();
    const { nodes, edges } = window.inspect();
    return { nodes: nodes.map(({ id }) => id).sort(), edges: edges.map(({ id }) => id) };
  });
  expect(errors).toEqual([]);
  expect(after).toEqual({ nodes: ["c", "d"], edges: ["f"] });
});
