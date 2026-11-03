// An edge mesh hidden while it holds no edge still uploads what it was marked for (ADR-0027): the
// GPU holds the indices the mesh's arrays hold, so that no edge of an earlier query draws again.
import { expect, test } from "@playwright/test";
import { canvasSize, open, setViewport } from "./shared";

test("a query of none between one of many edges and one of fewer leaves no index of the first on the GPU", async ({
  page,
}) => {
  // Verifies: ADR-0027
  await open(page);
  await page.evaluate(async () => {
    const edges = (from: string, to: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `${from}${i}`, source: from, target: to }));
    window.comb.load({
      nodes: [
        window.node("a", 0, 0),
        window.node("b", 300, 0),
        window.node("c", 20_000, 0),
        window.node("d", 20_300, 0),
      ],
      edges: [...edges("a", "b", 40), ...edges("c", "d", 3)],
    });
    await window.comb.whenRendered();
  });
  const { width, height } = await canvasSize(page);
  /** Centred on world (x, 0) at scale 1. */
  const at = (x: number) => ({ x: width / 2 - x, y: height / 2, scale: 1 });
  /** The indices the mesh drew, and how many indices past them the GPU holds that are not 0. */
  const drawn = () =>
    page.evaluate(() => {
      const { edgeMesh, edges } = window.inspect();
      const stale = window.gpuEdgeIndices().subarray(edgeMesh.indices);
      return { edges: edges.length, indices: edgeMesh.indices, stale: stale.some((i) => i !== 0) };
    });

  await setViewport(page, at(150));
  const many = await drawn();
  expect(many).toMatchObject({ edges: 40, stale: false });
  // Into empty space: the query finds none, and the mesh hides.
  await setViewport(page, at(10_000));
  expect(await drawn()).toMatchObject({ edges: 0, indices: 0 });
  await setViewport(page, at(20_150));
  const fewer = await drawn();
  expect(fewer.edges).toBe(3);
  expect(fewer.indices).toBeLessThan(many.indices);
  // The GPU holds no index of the 40 edges past the 3 edges' indices: none of them draws again.
  expect(fewer.stale).toBe(false);
});
