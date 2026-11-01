// The height a host application asks Comb for before it places a node (ADR-0035): the height the
// engine gives a node of that content and width, one per shape of content, refused as `addNode`
// refuses the node.
import { expect, test } from "@playwright/test";
import type { NodeContent } from "comb";
import { open } from "./shared";

/** A node of each type of the metric tree, by its identifier in the first copy. */
const EACH_TYPE = ["0:0.0", "0:1.1", "0:2.1", "0:3.0", "0:4.1"];

test("each type of node is drawn as high as heightOf gives its content and width", async ({
  page,
}) => {
  // Verifies: ADR-0035
  await open(page);
  const heights = await page.evaluate((ids) => {
    const drawn = new Map(window.inspect().nodes.map(({ id, height }) => [id, height]));
    return ids.map((id) => {
      const { content, width } = window.exampleGraph().nodes.find((node) => node.id === id)!;
      return { id, drawn: drawn.get(id), asked: window.comb.heightOf(content, width) };
    });
  }, EACH_TYPE);
  for (const { id, drawn, asked } of heights)
    expect({ id, height: drawn }).toEqual({ id, height: asked });
  // The types differ in height, so that the check is not of one number.
  expect(new Set(heights.map(({ asked }) => asked)).size).toBeGreaterThan(1);
});

test("content of one shape has one height, whatever its texts and its width", async ({ page }) => {
  // Verifies: ADR-0035
  await open(page);
  const heights = await page.evaluate((ids) => {
    // Every text of the content another, a metric's caption, value, and trend's text among them,
    // of the most code units a text may hold.
    const long = "W".repeat(1_000);
    const retexted = (content: NodeContent): NodeContent =>
      content.map((row) =>
        row.map((element) =>
          element.kind === "metric"
            ? { ...element, caption: long, value: long, trend: { ...element.trend, text: long } }
            : "text" in element
              ? { ...element, text: long }
              : element,
        ),
      );
    return ids.map((id) => {
      const { content, width } = window.exampleGraph().nodes.find((node) => node.id === id)!;
      const { comb } = window;
      return [comb.heightOf(content, width), comb.heightOf(retexted(content), 1)];
    });
  }, EACH_TYPE);
  for (const [asked, other] of heights) expect(other).toBe(asked);
});

test("heightOf refuses what addNode refuses of content and width, naming the node the empty string", async ({
  page,
}) => {
  // Verifies: ADR-0035, Q-7
  await open(page);
  const outcomes = await page.evaluate(() => {
    const { comb } = window;
    const problemOf = (call: () => unknown) => {
      try {
        call();
        return "ok";
      } catch (error) {
        return (error as { name: string; problem?: unknown }).problem ?? (error as Error).name;
      }
    };
    const malformed = [
      { content: [[{ kind: "text", role: "title", text: 5 }]], width: 100 },
      { content: [[{ kind: "text", role: "headline", text: "a" }]], width: 100 },
      { content: [[{ kind: "text", role: "title", text: "a" }]], width: -1 },
      { content: "rows", width: 100 },
    ] as unknown as { content: NodeContent; width: number }[];
    return malformed.map(({ content, width }) => ({
      asked: problemOf(() => comb.heightOf(content, width)),
      added: problemOf(() => comb.addNode({ id: "", x: 0, y: 0, width, content })),
    }));
  });
  // Each the problem `addNode` gives a node named "" at the origin.
  for (const { asked, added } of outcomes) {
    expect(added).not.toBe("ok");
    expect(asked).toEqual(added);
  }
});
