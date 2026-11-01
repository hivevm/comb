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

/** Registers, as the icon `name`, a canvas `width` × `height` the page fills in `color`, and
 *  waits until it is drawn. */
async function registerCanvas(
  page: Page,
  name: string,
  width: number,
  height: number,
  color = "#2563eb",
) {
  await page.evaluate(
    async ({ name: icon, width: w, height: h, color: fill }) => {
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [w, h];
      const context = canvas.getContext("2d")!;
      context.fillStyle = fill;
      context.fillRect(0, 0, w, h);
      window.comb.registerIcon(icon, canvas);
      await window.comb.whenRendered();
    },
    { name, width, height, color },
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

/** The colour, `[r, g, b]`, the canvas shows at the world point `(x, y)` of node `b`, read off a
 *  screenshot. */
async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.locator("#canvas canvas").screenshot();
  return page.evaluate(
    async ({ shot, x: worldX, y: worldY }) => {
      const bytes = Uint8Array.from(atob(shot), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const ratio = image.width / document.querySelector("#canvas canvas")!.clientWidth;
      const copy = document.createElement("canvas");
      [copy.width, copy.height] = [image.width, image.height];
      const context = copy.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const at = window.screenPoint(worldX, worldY);
      const { data } = context.getImageData(
        Math.round(at.x * ratio),
        Math.round(at.y * ratio),
        1,
        1,
      );
      return [data[0]!, data[1]!, data[2]!];
    },
    { shot: png.toString("base64"), x, y },
  );
}

test("the icon is Comb's copy of the image: closing the ImageBitmap or painting the canvas after registering changes nothing", async ({
  page,
}) => {
  // Verifies: ADR-0013
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openIcon(page);
  await page.evaluate(async () => {
    const red = document.createElement("canvas");
    [red.width, red.height] = [16, 16];
    const context = red.getContext("2d")!;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 16, 16);
    const bitmap = await createImageBitmap(red);
    window.comb.registerIcon("flag", bitmap);
    bitmap.close();
    // The host application's canvas, registered and then painted over.
    window.comb.registerIcon("other", red);
    context.fillStyle = "#00ff00";
    context.fillRect(0, 0, 16, 16);
    await window.comb.whenRendered();
  });
  // Drawn as registered, and again once the far level has taken the views away and near binds
  // them anew.
  expect(await pixelAt(page, 20, 36)).toEqual([255, 0, 0]);
  await setViewport(page, { x: 100, y: 100, scale: 0.1 });
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const [sprite] = await sprites(page);
  expect(sprite!.texture).toBe("flag");
  expect(await pixelAt(page, 20, 36)).toEqual([255, 0, 0]);
  expect(errors).toEqual([]);
});

test("an image of another origin whose pixels the page may not read is refused, and nothing breaks a frame", async ({
  page,
}) => {
  // Verifies: ADR-0013, Q-6
  // The policy of Q-6 lets no image of another origin into the page, so this test serves the
  // document without it, as a host application without that policy would, and the image itself
  // from another origin, 127.0.0.1, which the test serves; Comb requests nothing.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = "http://127.0.0.1:5174";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("/", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.route(`${origin}/x.png`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  await openIcon(page);
  const outcome = await page.evaluate(async (from) => {
    const image = new Image();
    image.src = `${from}/x.png`;
    await image.decode();
    const tainted = document.createElement("canvas");
    [tainted.width, tainted.height] = [1, 1];
    tainted.getContext("2d")!.drawImage(image, 0, 0);
    const reasons = [image, tainted].map((icon) => {
      try {
        window.comb.registerIcon("flag", icon);
        return "registered";
      } catch (error) {
        const { name, reason } = error as Error & { reason: string };
        return `${name} ${reason}`;
      }
    });
    window.comb.setViewport({ x: 120, y: 100, scale: 1 });
    const rendered = await Promise.race([
      window.comb.whenRendered().then(() => "rendered"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 3000)),
    ]);
    return { reasons, rendered };
  }, origin);
  expect(outcome).toEqual({
    reasons: ["IconError crossOrigin", "IconError crossOrigin"],
    rendered: "rendered",
  });
  expect(await sprites(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("after destroy, registerIcon checks its arguments as before and keeps nothing", async ({
  page,
}) => {
  // Verifies: ADR-0013
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openIcon(page);
  const outcomes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [16, 16];
    window.comb.registerIcon("flag", canvas);
    await window.comb.whenRendered();
    window.comb.destroy();
    const outcome = (call: () => void) => {
      try {
        call();
        return "ok";
      } catch (error) {
        const { name, reason } = error as Error & { reason?: string };
        return reason ? `${name} ${reason}` : name;
      }
    };
    const result = {
      // As the other methods that edit, which go on after destroy without drawing.
      load: outcome(() => window.comb.load({ nodes: [], edges: [] })),
      registered: outcome(() => window.comb.registerIcon("flag", canvas)),
      refused: outcome(() => window.comb.registerIcon("flag", "/flag.png" as never)),
    };
    await new Promise((resolve) => setTimeout(resolve, 100));
    return result;
  });
  expect(outcomes).toEqual({
    load: "ok",
    registered: "ok",
    refused: "IconError fetchable",
  });
  expect(errors).toEqual([]);
});

test("once the engine is lost, a name registered again is drawn at once and nothing breaks a frame", async ({
  page,
}) => {
  // Verifies: ADR-0013, ADR-0021
  // No query runs once the engine is lost, and inspection asks the engine; the canvas is read
  // instead. The views take the new texture as it is registered, and the old one is destroyed
  // then, which a frame that drew it would report as an error.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openIcon(page);
  await registerCanvas(page, "flag", 16, 16, "#ff0000");
  expect(await pixelAt(page, 13, 36)).toEqual([255, 0, 0]);
  const lost = await page.evaluate(() => {
    window.trapNextCall();
    try {
      window.comb.load({ nodes: [], edges: [] });
    } catch (error) {
      return (error as Error).name;
    }
    return "not lost";
  });
  expect(lost).toBe("EngineLostError");
  // 16 × 32 in green, fitted as 8 × 16 from x = 16: the square's left no longer red.
  await registerCanvas(page, "flag", 16, 32, "#00ff00");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
  expect(await pixelAt(page, 20, 36)).toEqual([0, 255, 0]);
  expect(await pixelAt(page, 13, 36)).not.toEqual([255, 0, 0]);
  expect(errors).toEqual([]);
});
