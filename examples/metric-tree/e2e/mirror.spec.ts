// The example keeps its own copy of the graph from what `onChange` tells, as a host application
// that persists would (ADR-0030): a node dragged, retitled, and an edge restyled are in the copy.
import { expect, test } from "@playwright/test";
import { open, screenCentre } from "./shared";

test("the example's copy holds a dragged node's position, its new title, and its edge's new style", async ({
  page,
}) => {
  // Verifies: ADR-0030
  await open(page);
  const northStar = "0:3.0";
  const edge = "0:2.3-3.0";
  const drawnAt = () =>
    page.evaluate((id) => {
      const { x, y } = window.inspect().nodes.find((node) => node.id === id)!;
      return { x, y };
    }, northStar);
  const before = await drawnAt();
  const from = await screenCentre(page, northStar);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 100, { steps: 10 });
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());
  const drawn = await drawnAt();
  const scale = await page.evaluate(() => window.inspect().viewport.scale);
  // The drag moved the node by its own offset, so that a copy left where it was fails.
  expect(drawn.x - before.x).toBeCloseTo(60 / scale, 1);
  expect(drawn.y - before.y).toBeCloseTo(100 / scale, 1);

  // Retitled through Comb, as any host would, not through the sidebar's own handler.
  await page.evaluate(
    ({ northStar, edge }) => {
      window.comb.updateNode(northStar, { title: "North star" });
      window.comb.updateEdge(edge, { color: 0x3366cc, dash: [6, 4], label: null });
    },
    { northStar, edge },
  );

  const copy = await page.evaluate(
    ({ northStar, edge }) => {
      const graph = window.exampleGraph();
      return {
        node: graph.nodes.find(({ id }) => id === northStar),
        edge: graph.edges.find(({ id }) => id === edge),
      };
    },
    { northStar, edge },
  );
  expect(copy.node).toMatchObject({ x: drawn.x, y: drawn.y, title: "North star" });
  expect(copy.edge).toMatchObject({ color: 0x3366cc, dash: [6, 4] });
  expect(copy.edge?.label).toBeUndefined();
});
