// An icon the host application registered (ADR-0013): an image it loaded itself, drawn as a sprite
// of its texture in the square the engine laid the icon out in, fitted with its aspect kept; an
// icon none is registered under draws nothing until one is, without a new load; a name registered
// again draws the new image; and registerIcon refuses with a typed error what Comb would have to
// fetch or cannot draw, and fetches nothing (Q-6).
import { expect, test, type Page } from "@playwright/test";
import type { NodeContent } from "comb";
import { loaded, node, open, setViewport, told } from "./shared";

/** A title row, then an icon named "flag" alone in a column of 196: its square from (12, 28), the
 *  body's line of 16 on a side, at its column's left below the title's line of 18. */
const CONTENT: NodeContent = [
  [{ kind: "text", role: "title", text: "Bet" }],
  [{ kind: "icon", name: "flag" }],
];

/** The square of `CONTENT`'s icon, relative to its node, as the engine lays it out. */
const SQUARE = { x: 12, y: 28, width: 16, height: 16 };

/** Opens the example on node `b` of `CONTENT` at the origin, at scale 1. */
async function openIcon(page: Page): Promise<void> {
  await open(page);
  await loaded(page, { nodes: [{ ...node("b"), content: CONTENT }], edges: [] });
}

/** Registers, as the icon `name`, a canvas `width` × `height` the page draws, and waits until it
 *  is drawn. */
async function registerCanvas(page: Page, name: string, width: number, height: number) {
  await page.evaluate(
    async ({ name: icon, width: w, height: h }) => {
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [w, h];
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#2563eb";
      context.fillRect(0, 0, w, h);
      window.comb.registerIcon(icon, canvas);
      await window.comb.whenRendered();
    },
    { name, width, height },
  );
}

/** The sprites of icons node `b` draws. */
async function sprites(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().nodes.find((drawn) => drawn.id === "b")?.icons ?? [];
  });
}

/** Asserts that `got` lies within 0.5 px of `want`, each of x, y, width, and height. */
function expectNear(
  got: { x: number; y: number; width: number; height: number },
  want: { x: number; y: number; width: number; height: number },
) {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(got[key] - want[key]), key).toBeLessThanOrEqual(0.5);
}

test("a registered icon is drawn as a sprite of its texture in the square the engine laid out", async ({
  page,
}) => {
  // Verifies: ADR-0013, Q-4
  await openIcon(page);
  await registerCanvas(page, "flag", 64, 64);
  const [sprite, ...others] = await sprites(page);
  expect(others).toEqual([]);
  expect(sprite!.texture).toBe("flag");
  expectNear(sprite!, SQUARE);
  // An ImageBitmap is drawn alike, and a non-square image fitted with its aspect kept, centred in
  // the square: 32 × 16 as 16 × 8, 4 below the square's top.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [32, 16];
    canvas.getContext("2d")!.fillRect(0, 0, 32, 16);
    window.comb.registerIcon("flag", await createImageBitmap(canvas));
  });
  const [wide] = await sprites(page);
  expect(wide!.texture).toBe("flag");
  expectNear(wide!, { x: 12, y: 32, width: 16, height: 8 });
  // The middle and the far level draw no icon.
  for (const scale of [0.5, 0.1]) {
    await setViewport(page, { x: 100, y: 100, scale });
    expect(await sprites(page)).toEqual([]);
  }
});

test("an icon not yet registered draws nothing, and once registered it is drawn without a new load", async ({
  page,
}) => {
  // Verifies: ADR-0013
  await openIcon(page);
  expect(await sprites(page)).toEqual([]);
  // The title is drawn, and the node laid out, as with the icon.
  const drawn = await page.evaluate(() => {
    const b = window.inspect().nodes.find((candidate) => candidate.id === "b")!;
    return { height: b.height, texts: b.texts!.map((text) => text.drawn) };
  });
  expect(drawn).toEqual({ height: 64, texts: ["Bet"] });
  await registerCanvas(page, "other", 16, 16);
  expect(await sprites(page)).toEqual([]);
  await registerCanvas(page, "flag", 16, 16);
  const [sprite] = await sprites(page);
  expect(sprite!.texture).toBe("flag");
  expectNear(sprite!, SQUARE);
  // No change of the graph was told: no load, no edit.
  expect(await told(page)).toEqual([]);
});

test("a name registered again draws the new image wherever the old one was drawn", async ({
  page,
}) => {
  // Verifies: ADR-0013
  await openIcon(page);
  await registerCanvas(page, "flag", 16, 16);
  expectNear((await sprites(page))[0]!, SQUARE);
  await registerCanvas(page, "flag", 16, 32);
  const [sprite, ...others] = await sprites(page);
  expect(others).toEqual([]);
  // Its texture is the one registered now; 16 × 32 fitted as 8 × 16, 4 right of the square's left.
  expect(sprite!.texture).toBe("flag");
  expectNear(sprite!, { x: 16, y: 28, width: 8, height: 16 });
});

test("registerIcon refuses a string, a URL, an image that has not loaded, and a name no icon can give, and requests nothing", async ({
  page,
}) => {
  // Verifies: ADR-0013, Q-6
  await openIcon(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const reasons = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [16, 16];
    const empty = document.createElement("canvas");
    [empty.width, empty.height] = [0, 0];
    const cases: [unknown, unknown][] = [
      ["flag", "/bet.png"],
      ["flag", "https://example.test/bet.png"],
      ["flag", new URL("https://example.test/bet.png")],
      ["flag", new Request("https://example.test/bet.png")],
      ["flag", new Image()],
      ["flag", empty],
      ["flag", { width: 16, height: 16 }],
      [5, canvas],
      ["x".repeat(1001), canvas],
    ];
    return cases.map(([name, image]) => {
      try {
        window.comb.registerIcon(name as string, image as HTMLCanvasElement);
        return "registered";
      } catch (error) {
        const { name: kind, reason } = error as Error & { reason: string };
        return `${kind} ${reason}`;
      }
    });
  });
  expect(reasons).toEqual([
    "IconError fetchable",
    "IconError fetchable",
    "IconError fetchable",
    "IconError fetchable",
    "IconError notLoaded",
    "IconError notLoaded",
    "IconError invalid",
    "IconError invalidName",
    "IconError nameTooLong",
  ]);
  await page.evaluate(() => window.comb.whenRendered());
  expect(requests).toEqual([]);
  // Nothing was registered: the icon still draws nothing.
  expect(await sprites(page)).toEqual([]);
});
