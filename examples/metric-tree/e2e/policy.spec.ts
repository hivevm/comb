import { expect, test, type Page } from "@playwright/test";
import { POLICY } from "./shared";

/** A request or WebSocket the page made, by its kind, its path, and the scripts on whose call
 *  stack it was made, innermost first, async callers included; none for a module import. */
interface Made {
  type: string;
  origin: string;
  path: string;
  by: string[];
}

/** The script of each frame of a stack and of the stacks it was called from. */
function scriptsOf(stack: { callFrames: { url: string }[]; parent?: unknown } | undefined) {
  const scripts: string[] = [];
  for (let at = stack; at; at = at.parent as typeof stack) {
    scripts.push(...at.callFrames.map((frame) => new URL(frame.url).pathname));
  }
  return [...new Set(scripts)];
}

/** Records every request and WebSocket of the page with the scripts that made it, from the
 *  browser's own account of its initiator. */
async function recordRequests(page: Page): Promise<Made[]> {
  const made: Made[] = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Network.requestWillBeSent", ({ request, type, initiator }) => {
    const url = new URL(request.url);
    made.push({
      type: type ?? "Other",
      origin: url.origin,
      path: url.pathname,
      by: scriptsOf(initiator.stack),
    });
  });
  cdp.on("Network.webSocketCreated", ({ url, initiator }) => {
    const { origin, pathname } = new URL(url);
    made.push({ type: "WebSocket", origin, path: pathname, by: scriptsOf(initiator?.stack) });
  });
  await cdp.send("Network.enable");
  return made;
}

/** Where Comb's sources are served from, by the example's workspace or by Vite's `/@fs/`. */
const COMB = "/packages/comb/";

/** Records every `securitypolicyviolation` in the page, from before its first script. */
async function recordViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { violations: string[] }).violations = seen;
    document.addEventListener("securitypolicyviolation", (event) =>
      seen.push(`${event.effectiveDirective} ${event.blockedURI} at ${event.sourceFile}`),
    );
  });
  return () => page.evaluate(() => (window as unknown as { violations: string[] }).violations);
}

/** Loads the example under the policy, then pans the empty canvas by the pointer and zooms by the
 *  wheel, at a point no node covers, and asserts that no violation and no page error occurred;
 *  returns the policy the document was served under and every request the page made. */
async function loadPanZoom(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const made = await recordRequests(page);
  const violations = await recordViolations(page);
  const response = await page.goto("/");
  // Until the first load has drawn, or a violation shows why it will not.
  await page.waitForFunction(
    () =>
      "loadReport" in window ||
      (window as unknown as { violations: string[] }).violations.length > 0,
  );
  expect(await violations()).toEqual([]);
  await page.evaluate(() => window.loadReport);
  expect(await page.evaluate(() => window.inspect().renderer)).toBe("webgl");

  const canvas = (await page.locator("#canvas canvas").boundingBox())!;
  const at = { x: canvas.x + 12, y: canvas.y + 12 };
  const covered = await page.evaluate(
    ({ x, y }) =>
      window.inspect().nodes.some((node) => {
        const from = window.screenPoint(node.x, node.y);
        const to = window.screenPoint(node.x + node.width, node.y + node.height);
        return from.x <= x && x <= to.x && from.y <= y && y <= to.y;
      }),
    { x: 12, y: 12 },
  );
  expect(covered).toBe(false);
  const before = await page.evaluate(() => window.viewport());
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 120, at.y + 80, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());
  const panned = await page.evaluate(() => window.viewport());
  expect(panned.x - before.x).toBeCloseTo(120, 0);
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, -400);
  await expect
    .poll(() => page.evaluate(() => window.viewport().scale))
    .toBeGreaterThan(panned.scale);
  await page.evaluate(() => window.comb.whenRendered());

  expect(await violations()).toEqual([]);
  expect(errors).toEqual([]);
  return { policy: response?.headers()["content-security-policy"], made };
}

test("under the policy, Comb loads, pans, and zooms without a violation or a request of its own", async ({
  page,
}) => {
  // Verifies: Q-6, ADR-0019, ADR-0020
  const { policy, made } = await loadPanZoom(page);
  expect(policy).toBe(POLICY);
  // No request or socket was made by Comb's code, whatever its kind.
  expect(made.filter((request) => request.by.some((script) => script.includes(COMB)))).toEqual([]);
  // The example's own: its document, the modules and the stylesheet Vite serves from the page's
  // origin, Vite's client among them, Vite's HMR socket, made by its client, and one request of
  // the engine file, made by the example.
  const origin = new URL(page.url()).origin;
  const ws = origin.replace(/^http/, "ws");
  const engine = new URL(await page.evaluate(() => window.engineUrl), page.url()).pathname;
  expect(made.filter((request) => ![origin, ws].includes(request.origin))).toEqual([]);
  const served = ["Document", "Script", "Stylesheet"];
  const others = made.filter((request) => !served.includes(request.type));
  // By kind, since Vite's client and the example run concurrently.
  others.sort((a, b) => a.type.localeCompare(b.type));
  expect(others).toEqual([
    { type: "Fetch", origin, path: engine, by: ["/src/main.ts"] },
    { type: "WebSocket", origin: ws, path: "/", by: ["/@vite/client"] },
  ]);
});

test(
  "the built example, under the policy, loads, pans, and zooms without a violation or a request of Comb's",
  { tag: "@built" },
  async ({ page }) => {
    // Verifies: Q-6, ADR-0019, ADR-0020
    const { policy, made } = await loadPanZoom(page);
    expect(policy).toBe(POLICY);
    // The bundler puts Comb's code in the example's entry chunk, so a script does not tell whose
    // code made a request; the requests themselves do. Beyond the document, the chunks the page
    // imports and preloads, and the stylesheet, all from the page's origin, there is the one
    // request of the engine file, made by the entry chunk.
    const origin = new URL(page.url()).origin;
    const entry = new URL(
      await page.locator("script[type=module]").getAttribute("src").then(String),
      page.url(),
    ).pathname;
    const engine = new URL(await page.evaluate(() => window.engineUrl), page.url()).pathname;
    expect(made.filter((request) => request.origin !== origin)).toEqual([]);
    const served = ["Document", "Script", "Stylesheet"];
    expect(made.filter((request) => !served.includes(request.type))).toEqual([
      { type: "Fetch", origin, path: engine, by: [entry] },
    ]);
  },
);
