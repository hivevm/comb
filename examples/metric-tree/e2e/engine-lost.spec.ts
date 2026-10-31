// A trap loses the engine for the page (ADR-0021): every later call that needs it throws an
// `EngineLostError`, no trap escapes as a page error, and the host application is told through
// `onEngineLost`. The trap is provoked through the test-mode seam of the bridge crate, so that the
// tests do not depend on a trap the checks may close.
import { expect, test, type Page } from "@playwright/test";
import type { Comb } from "comb";
import { open } from "./shared";

declare global {
  interface Window {
    /** How `call` ended: `ok`, or the name of the error it threw, with the message of one that is
     *  not Comb's own. */
    outcome: (call: () => unknown) => string;
    /** A canvas host of its own, for a second Comb. */
    secondHost: () => HTMLElement;
    /** The viewport before input on the lost canvas. */
    viewportBefore: { x: number; y: number; scale: number };
    /** A second Comb, made before its first load. */
    second: Comb;
    /** What `onEngineLost` told the second Comb. */
    heard: string[];
  }
}

/** Opens the example with the helpers of these tests, and collects the page's errors. */
async function openWithErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.evaluate(() => {
    window.outcome = (call) => {
      try {
        call();
        return "ok";
      } catch (error) {
        if (!(error instanceof Error)) return `untyped: ${String(error)}`;
        return error.name.endsWith("Error") && error.name !== "Error"
          ? error.name
          : `untyped: ${error.message}`;
      }
    };
    window.secondHost = () => {
      const host = document.createElement("div");
      host.style.cssText = "position: fixed; left: 0; top: 0; width: 300px; height: 200px";
      document.body.appendChild(host);
      return host;
    };
  });
  return errors;
}

const LOST = "EngineLostError";

/** The methods of `Comb` that need the engine, which throw once it is lost. */
const NEEDS_THE_ENGINE = [
  "load",
  "updateNode",
  "addNode",
  "addEdge",
  "updateEdge",
  "removeNodes",
  "removeEdges",
  "fitView",
  "setViewport",
];

test("after a trap in load, every call that needs the engine throws an EngineLostError", async ({
  page,
}) => {
  // Verifies: ADR-0021, Q-7
  const errors = await openWithErrors(page);
  const outcomes = await page.evaluate(async () => {
    const graph = { nodes: [window.node("a")] };
    const { comb, outcome } = window;
    const selection = comb.onSelectionChange(() => {});
    window.trapNextCall();
    const trap = outcome(() => comb.load({ ...graph, edges: [] }));
    const later = {
      load: outcome(() => comb.load({ ...graph, edges: [] })),
      updateNode: outcome(() => comb.updateNode("n0", { content: graph.nodes[0]!.content })),
      addNode: outcome(() => comb.addNode({ ...graph.nodes[0]!, id: "b" })),
      addEdge: outcome(() => comb.addEdge({ id: "e", source: "a", target: "b" })),
      updateEdge: outcome(() => comb.updateEdge("e", { color: 0 })),
      removeNodes: outcome(() => comb.removeNodes(["a"])),
      removeEdges: outcome(() => comb.removeEdges([])),
      fitView: outcome(() => comb.fitView()),
      setViewport: outcome(() => comb.setViewport({ x: 0, y: 0, scale: 1 })),
    };
    let created = "ok";
    const host = window.secondHost();
    try {
      await window.createComb(host, { engine: fetch(window.engineUrl) });
    } catch (error) {
      created = (error as Error).name;
    }
    const hostChildren = host.childElementCount;
    await comb.whenRendered();
    window.viewportBefore = comb.viewport();
    const kept = {
      viewport: outcome(() => comb.viewport()),
      worldPointAt: outcome(() => comb.worldPointAt(10, 20)),
      onSelectionChange: outcome(() => comb.onSelectionChange(() => {})()),
      unsubscribe: outcome(selection),
    };
    return { trap, later, created, hostChildren, kept };
  });
  // Input over the lost canvas changes nothing and throws nothing.
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(340, 320);
  await page.mouse.up();
  await page.mouse.wheel(0, -200);
  const destroyed = await page.evaluate(async () => {
    const moved = JSON.stringify(window.comb.viewport()) !== JSON.stringify(window.viewportBefore);
    const outcome = window.outcome(() => window.comb.destroy());
    const canvases = document.querySelectorAll("#canvas canvas").length;
    return { moved, outcome, canvases };
  });
  expect(outcomes).toEqual({
    trap: LOST,
    later: Object.fromEntries(NEEDS_THE_ENGINE.map((call) => [call, LOST])),
    created: LOST,
    hostChildren: 0,
    kept: { viewport: "ok", worldPointAt: "ok", onSelectionChange: "ok", unsubscribe: "ok" },
  });
  expect(destroyed).toEqual({ moved: false, outcome: "ok", canvases: 0 });
  expect(errors).toEqual([]);
});

test("a createComb whose engine is lost while PixiJS initialises resolves, or leaves its host element without a child", async ({
  page,
}) => {
  // Verifies: ADR-0021
  const errors = await openWithErrors(page);
  const result = await page.evaluate(async () => {
    const { comb, outcome } = window;
    // An engine lost before createComb is refused as the engine is created; only a loss while
    // PixiJS initialises reaches what comes after. No event marks that moment, so a stand-in for
    // document.createElement springs a trap through the Comb already on the page at the first
    // canvas made: this depends on PixiJS making a canvas inside app.init.
    const createElement = document.createElement.bind(document);
    let sprung = false;
    let created = "resolved";
    let host: HTMLElement | undefined;
    let canvasInHost = false;
    let refused = "not called";
    try {
      document.createElement = ((name: string, options?: ElementCreationOptions) => {
        if (name === "canvas" && !sprung) {
          sprung = true;
          window.trapNextCall();
          outcome(() => comb.load({ nodes: [], edges: [] }));
        }
        return createElement(name, options);
      }) as typeof document.createElement;
      host = window.secondHost();
      const second = await window.createComb(host, { engine: fetch(window.engineUrl) });
      canvasInHost =
        host.childElementCount === 1 && host.firstElementChild instanceof HTMLCanvasElement;
      refused = outcome(() => second.load({ nodes: [], edges: [] }));
      second.destroy();
    } catch (error) {
      created = `${(error as Error).name} leaving ${host?.childElementCount} children`;
    } finally {
      document.createElement = createElement;
    }
    return { sprung, created, canvasInHost, refused };
  });
  // The limits are read as the engine is created, before PixiJS initialises, so a loss there lets
  // createComb resolve: that is the order the test guards. A rejection would mean the trap sprang
  // before the limits were read, where it decides nothing, so the test pins "resolved".
  expect(result).toEqual({
    sprung: true,
    created: "resolved",
    canvasInHost: true,
    refused: LOST,
  });
  expect(errors).toEqual([]);
});

test("a trap inside the animation frame stops the renders, resolves whenRendered, and tells the host application", async ({
  page,
}) => {
  // Verifies: ADR-0021, Q-7
  const errors = await openWithErrors(page);
  const result = await page.evaluate(async () => {
    const { comb, outcome } = window;
    const told: string[] = [];
    comb.onEngineLost((error) => told.push(error.name));
    window.trapNextCall();
    // A viewport far from the graph makes the next frame query the engine, which traps.
    comb.setViewport({ x: 1e6, y: 1e6, scale: 1 });
    await comb.whenRendered();
    // What the frame told, before any call of the host's could trap instead.
    const toldByFrame = [...told];
    const renders = window.renderCount();
    // A resize schedules a render without a call the lost engine refuses.
    const host = document.getElementById("canvas")!;
    host.style.width = `${host.clientWidth - 40}px`;
    window.dispatchEvent(new Event("resize"));
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    await frame();
    await frame();
    await comb.whenRendered();
    return {
      toldByFrame,
      rendersAfter: window.renderCount() - renders,
      load: outcome(() => comb.load({ nodes: [], edges: [] })),
      told,
    };
  });
  expect(result).toEqual({
    toldByFrame: ["EngineLostError"],
    rendersAfter: 0,
    load: "EngineLostError",
    told: ["EngineLostError"],
  });
  expect(errors).toEqual([]);
});

test("a trap in one of two Combs on a page loses the engine for both", async ({ page }) => {
  // Verifies: ADR-0021, Q-7
  const errors = await openWithErrors(page);
  const result = await page.evaluate(async () => {
    const { comb: first, outcome } = window;
    const second = await window.createComb(window.secondHost(), {
      engine: fetch(window.engineUrl),
    });
    const graph = {
      nodes: [window.node("a")],
      edges: [],
    };
    second.load(graph);
    await second.whenRendered();
    const told: string[] = [];
    first.onEngineLost(() => told.push("first"));
    second.onEngineLost(() => told.push("second"));
    window.trapNextCall();
    const trap = outcome(() => first.load(graph));
    const other = {
      load: outcome(() => second.load(graph)),
      updateNode: outcome(() =>
        second.updateNode("a", { content: [[{ kind: "text", role: "title", text: "b" }]] }),
      ),
    };
    await second.whenRendered();
    return { trap, other, told };
  });
  expect(result).toEqual({
    trap: "EngineLostError",
    other: { load: "EngineLostError", updateNode: "EngineLostError" },
    told: ["first", "second"],
  });
  expect(errors).toEqual([]);
});

test("a listener of onEngineLost is called once, also when registered after the loss, and not once removed", async ({
  page,
}) => {
  // Verifies: ADR-0021
  const errors = await openWithErrors(page);
  const told = await page.evaluate(async () => {
    const { comb, outcome } = window;
    const heard: string[] = [];
    comb.onEngineLost((error) => heard.push(`before: ${error.name}`));
    const remove = comb.onEngineLost(() => heard.push("removed"));
    remove();
    window.trapNextCall();
    outcome(() => comb.load({ nodes: [], edges: [] }));
    outcome(() => comb.load({ nodes: [], edges: [] }));
    const later = comb.onEngineLost((error) => heard.push(`after: ${error.name}`));
    heard.push(typeof later);
    later();
    return heard;
  });
  expect(told).toEqual(["before: EngineLostError", "after: EngineLostError", "function"]);
  expect(errors).toEqual([]);
});

test("a Comb before its first load keeps its engine through a viewport, a fit, and a pointer, and then draws its load", async ({
  page,
}) => {
  // Verifies: Q-7
  const errors = await openWithErrors(page);
  const told = await page.evaluate(async () => {
    const second = await window.createComb(window.secondHost(), {
      engine: fetch(window.engineUrl),
    });
    window.second = second;
    const heard: string[] = [];
    second.onEngineLost((error) => heard.push(error.name));
    window.heard = heard;
    // Each schedules a frame that queries the engine, which has never held a graph.
    second.setViewport({ x: 0, y: 0, scale: 1 });
    second.fitView();
    await second.whenRendered();
    return [...heard];
  });
  // A pointer over the second canvas asks the engine what it hits.
  await page.mouse.move(100, 80);
  await page.mouse.move(150, 100);
  await page.mouse.move(200, 120);
  const result = await page.evaluate(async () => {
    const { second, outcome } = window;
    const load = outcome(() => second.load({ nodes: [window.node("a", 20, 20)], edges: [] }));
    await second.whenRendered();
    return {
      load,
      drawn: window.inspect(second).nodes.map((node) => node.id),
      heard: window.heard,
    };
  });
  expect(told).toEqual([]);
  expect(result).toEqual({ load: "ok", drawn: ["a"], heard: [] });
  expect(errors).toEqual([]);
});
