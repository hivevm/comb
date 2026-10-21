// WebGL2, or the Canvas 2D fallback a host application opts in to (ADR-0018).
import { expect, test } from "@playwright/test";
import { open } from "./shared";

test("without WebGL, Comb refuses instead of drawing without edges", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
  // A browser without WebGL: every WebGL context is refused, as where no GPU process starts.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, id: string, options?: unknown) {
        return id.startsWith("webgl") ? null : Reflect.apply(getContext, this, [id, options]);
      },
    });
  });
  await page.goto("/");
  await expect
    .poll(() => errors)
    .toContainEqual(expect.stringContaining("RendererUnavailableError"));
  await expect(page.locator("#canvas canvas")).toHaveCount(0);
});

test("without WebGL, a host application that opts in gets Canvas 2D with its edges", async ({
  page,
}) => {
  // Verifies: ADR-0018
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, id: string, options?: unknown) {
        return id.startsWith("webgl") ? null : Reflect.apply(getContext, this, [id, options]);
      },
    });
  });
  await open(page, "?fallback=canvas");
  const drawn = await page.evaluate(() => {
    const snapshot = window.inspect();
    return {
      renderer: snapshot.renderer,
      nodes: snapshot.nodes.length,
      edgeTriangles: snapshot.edgeTriangles,
    };
  });
  // One tree: 15 nodes, all in view after fitView.
  expect(drawn.renderer).toBe("canvas");
  expect(drawn.nodes).toBe(15);
  expect(drawn.edgeTriangles).toBeGreaterThan(0);
  // Drawn, not only counted: with the nodes and the edge labels hidden, the canvas holds pixels
  // in the green of the tree's positively correlated edges, which only the edges layer paints;
  // within 16 per channel, since antialiasing blends the pixels at a triangle's border, and the
  // background, grey, and red lie far outside that.
  const green = await page.evaluate(async () => {
    window.showLayers({ nodes: false, edgeLabels: false });
    await window.comb.whenRendered();
    await new Promise(requestAnimationFrame);
    const source = document.querySelector<HTMLCanvasElement>("#canvas canvas")!;
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    const context = copy.getContext("2d")!;
    context.drawImage(source, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const off = [0x22, 0xa5, 0x5b].map((value, channel) => Math.abs(data[i + channel]! - value));
      if (Math.max(...off) <= 16) count += 1;
    }
    return count;
  });
  expect(green).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
