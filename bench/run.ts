// The benchmark of Q-1 and Q-2 (ADR-0008): the example at 50,000 nodes and 50,000 edges, served
// from its production build. It measures the time from handing the graph to Comb until its first
// frame is drawn, and the p95 frame time while a node on screen is dragged, the viewport panned,
// and zoomed in and out, while the graph is edited one edit a frame, a node and an edge added and
// removed again (ADR-0022), and while the viewport is panned at the scale where the near and the
// middle level of detail begin. Only frames in which Comb rendered count; each action is checked for its
// effect, so a gesture that missed fails the run instead of measuring idle frames. Before the
// gestures it times the reference workload of bench/reference.ts in the same page, by which
// bench/compare.ts tells whether the runner is in the state its kind's baseline was taken in; the
// CPU model it records names the runner's kind, and each gesture records the steps it sent and
// the frames Comb rendered. The numbers go to bench-results/latest.json and are printed beside
// the targets.
//
//   bun run bench                   headless Chromium, software WebGL
//   BENCH_HEADED=1 bun run bench    a visible window, which uses the machine's GPU
//   BENCH_COPIES=100 bun run bench  another size
//   BENCH_ACTION_MS=60000           the time one action may take (default 30 s)
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import type { LoadReport } from "../examples/metric-tree/src/main";
import { chromiumEnv } from "./chromium";
import { gestures, type Run } from "./compare";
import { PARTS, referenceWorkload } from "./reference";

const PORT = 4173;
const COPIES = Number(process.env.BENCH_COPIES ?? 3334);
const HEADED = Boolean(process.env.BENCH_HEADED);
const STEPS = 120;
const ACTION_BUDGET_MS = Number(process.env.BENCH_ACTION_MS ?? 30_000);
const LOAD_TIMEOUT_MS = 300_000;
const TARGET_FRAME_MS = 16.7;
const TARGET_FIRST_FRAME_MS = 1000;

type Point = { x: number; y: number };

interface Measure {
  /** Gesture steps sent, of STEPS. */
  steps: number;
  /** True when the action budget ran out before every step was sent. */
  truncated: boolean;
  /** Frame intervals in which Comb rendered. */
  frames: number;
  p50: number;
  p95: number;
  max: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? NaN;
}

/** Runs `act` while the page records, for every frame, its interval and whether Comb rendered.
 *  Recording starts once every earlier change is drawn, so no render of an earlier gesture counts. */
async function frameTimes(page: Page, act: () => Promise<number>): Promise<Measure> {
  await page.evaluate(() => window.comb.whenRendered());
  await page.evaluate(() => {
    const w = window as unknown as { samples: [number, boolean][]; recording: boolean };
    w.samples = [];
    w.recording = true;
    let last = performance.now();
    let renders = window.renderCount();
    const tick = (now: number) => {
      const count = window.renderCount();
      w.samples.push([now - last, count > renders]);
      last = now;
      renders = count;
      if (w.recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const sent = await act();
  const samples = await page.evaluate(() => {
    const w = window as unknown as { samples: [number, boolean][]; recording: boolean };
    w.recording = false;
    return w.samples.slice(1);
  });
  const sorted = samples
    .filter(([, rendered]) => rendered)
    .map(([interval]) => interval)
    .sort((a, b) => a - b);
  return {
    steps: sent,
    truncated: sent < STEPS,
    frames: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? NaN,
  };
}

/** Sends up to STEPS steps, a frame apart, within the action budget; returns how many it sent. */
async function steps(page: Page, step: (i: number) => Promise<void>): Promise<number> {
  const start = performance.now();
  let i = 0;
  while (i < STEPS && performance.now() - start < ACTION_BUDGET_MS) {
    await step(++i);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  return i;
}

async function drag(page: Page, from: Point, dx: number, dy: number): Promise<number> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const sent = await steps(page, (i) =>
    page.mouse.move(from.x + (dx * i) / STEPS, from.y + (dy * i) / STEPS),
  );
  await page.mouse.up();
  return sent;
}

/** Zooms in for the first half of the steps and out for the second; `scales` collects the scale
 *  after each step, so the caller can tell that the gesture zoomed. */
async function zoom(page: Page, at: Point, scales: number[]): Promise<number> {
  await page.mouse.move(at.x, at.y);
  return steps(page, async (i) => {
    await page.mouse.wheel(0, i <= STEPS / 2 ? -40 : 40);
    scales.push(await page.evaluate(() => window.viewport().scale));
  });
}

/** The drawn node whose centre lies nearest the canvas centre, with that centre on screen. */
async function nodeNearCentre(page: Page): Promise<{ id: string; at: Point }> {
  return page.evaluate(() => {
    const snapshot = window.inspect();
    const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
    const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    let best: { id: string; at: { x: number; y: number }; d: number } | null = null;
    for (const node of snapshot.nodes) {
      const local = window.screenPoint(node.x + node.width / 2, node.y + node.height / 2);
      const at = { x: rect.left + local.x, y: rect.top + local.y };
      const d = Math.hypot(at.x - centre.x, at.y - centre.y);
      if (!best || d < best.d) best = { id: node.id, at, d };
    }
    if (!best) throw new Error("no node is drawn");
    const { at } = best;
    if (at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom) {
      throw new Error(`node ${best.id} is not on screen`);
    }
    return { id: best.id, at };
  });
}

async function drawnNode(page: Page, id: string) {
  return page.evaluate((id) => window.inspect().nodes.find((node) => node.id === id)!, id);
}

async function viewport(page: Page) {
  return page.evaluate(() => window.viewport());
}

function expectEffect(ok: boolean, what: string): void {
  if (!ok) throw new Error(`the ${what} had no effect; the measurement would be of idle frames`);
}

/** Edits the graph, one edit a frame: adds a node beside `near` and an edge from `near` to it,
 *  and removes the edge and the node again, as many times over as the steps allow (ADR-0022);
 *  returns how many edits it made. */
async function edits(page: Page, near: string): Promise<number> {
  const at = await drawnNode(page, near);
  return steps(page, (i) =>
    page.evaluate(
      ({ i, near, at }) => {
        const { comb } = window;
        const round = Math.floor((i - 1) / 4);
        const [node, edge] = [`bench-node-${round}`, `bench-edge-${round}`];
        switch ((i - 1) % 4) {
          case 0:
            comb.addNode({
              id: node,
              title: "edit",
              x: at.x + 40,
              y: at.y + 90,
              width: 160,
              height: 48,
            });
            break;
          case 1: {
            const w = window as unknown as { drawnAdds: number };
            if (window.inspect().nodes.some(({ id }) => id === node)) w.drawnAdds += 1;
            comb.addEdge({ id: edge, source: near, target: node });
            break;
          }
          case 2:
            comb.removeEdges([edge]);
            break;
          default:
            comb.removeNodes([node]);
        }
      },
      { i, near, at: { x: at.x, y: at.y } },
    ),
  );
}

/** The zoom gesture around `at`, checked for having changed the scale. */
async function zoomGesture(page: Page, at: Point): Promise<Measure> {
  const zoomFrom = await viewport(page);
  const scales: number[] = [];
  const zoomed = await frameTimes(page, () => zoom(page, at, scales));
  expectEffect(
    scales.some((scale) => scale !== zoomFrom.scale),
    "zoom",
  );
  console.log(`zoom: ${zoomed.frames} frames, p95 ${zoomed.p95.toFixed(1)} ms`);
  return zoomed;
}

/** The edit gesture, beside the node nearest the centre of the view: each edit is told, each node
 *  added is drawn before its edge is added, and none is drawn at the end. */
async function editGesture(page: Page): Promise<Measure> {
  await page.evaluate(() => {
    const w = window as unknown as { told: number; drawnAdds: number };
    [w.told, w.drawnAdds] = [0, 0];
    window.comb.onChange(() => (w.told += 1));
  });
  const beside = await nodeNearCentre(page);
  const edited = await frameTimes(page, () => edits(page, beside.id));
  const checked = await page.evaluate(async () => {
    await window.comb.whenRendered();
    const w = window as unknown as { told: number; drawnAdds: number };
    const left = window.inspect().nodes.some(({ id }) => id.startsWith("bench-node-"));
    return { told: w.told, drawnAdds: w.drawnAdds, left };
  });
  const rounds = Math.ceil(edited.steps / 4);
  expectEffect(
    checked.told === edited.steps && checked.drawnAdds === rounds && !checked.left,
    "edits",
  );
  console.log(`edit: ${edited.frames} frames, p95 ${edited.p95.toFixed(1)} ms`);
  return edited;
}

/** Pans at the scale where a level of detail begins, the least scale it draws at and so the most
 *  it binds, centred in the graph; the pan leaves the culling margin, so the scene queries. */
async function panAt(page: Page, scale: number): Promise<Measure> {
  const box = (await page.locator("#canvas canvas").boundingBox())!;
  await page.evaluate(
    async ({ scale, width, height }) => {
      const nodes = window.inspect().nodes;
      const xs = nodes.map((node) => node.x);
      const ys = nodes.map((node) => node.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      window.comb.setViewport({ x: width / 2 - cx * scale, y: height / 2 - cy * scale, scale });
      await window.comb.whenRendered();
    },
    { scale, width: box.width, height: box.height },
  );
  const start = await emptyPoint(page);
  const from = await viewport(page);
  const pan = await frameTimes(page, () => drag(page, start, 400, 200));
  const to = await viewport(page);
  expectEffect(to.x !== from.x || to.y !== from.y, `pan at scale ${scale}`);
  return pan;
}

/** A point on the canvas, near its top left, where a press hits neither a node nor an edge and
 *  so pans (ADR-0025). */
async function emptyPoint(page: Page): Promise<Point> {
  return page.evaluate(() => {
    const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
    for (let py = 4; py < rect.height / 2; py += 3) {
      for (let px = 4; px < rect.width / 2; px += 3) {
        // The example lets the user connect, so a press near a connector would begin a connection.
        if (window.hitKind(px, py, true) === "none") return { x: rect.left + px, y: rect.top + py };
      }
    }
    throw new Error("no empty point to pan from");
  });
}

async function measure(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://localhost:${PORT}/?copies=${COPIES}`, { timeout: LOAD_TIMEOUT_MS });
  // The example sets loadReport after a top-level await, which the load event does not wait for.
  await page.waitForFunction(() => "loadReport" in window, null, { timeout: LOAD_TIMEOUT_MS });
  const load: LoadReport = await page.evaluate(() => window.loadReport);
  if (errors.length) throw new Error(`the example failed: ${errors.join("; ")}`);
  console.log(
    `Loaded ${load.nodes} nodes in ${load.firstFrameMs.toFixed(1)} ms to the first frame.`,
  );
  const renderer = await page.evaluate(() => window.inspect().renderer);
  if (renderer !== "webgl")
    throw new Error(`Comb draws with ${renderer}, not WebGL; no number holds`);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });

  const reference = await referenceWorkload(page);
  const each = PARTS.filter(([, key]) => key !== "ms")
    .map(([name, key]) => `${name} ${reference[key].toFixed(1)}`)
    .join(", ");
  console.log(`reference: ${reference.ms.toFixed(1)} ms (${each})`);

  const node = await nodeNearCentre(page);
  const before = await drawnNode(page, node.id);
  const dragged = await frameTimes(page, () => drag(page, node.at, 0, 120));
  const after = await drawnNode(page, node.id);
  expectEffect(after.y !== before.y, `drag of node ${node.id}`);
  console.log(`drag: ${dragged.frames} frames, p95 ${dragged.p95.toFixed(1)} ms`);

  const box = (await page.locator("#canvas canvas").boundingBox())!;
  const panFrom = await viewport(page);
  const pan = await frameTimes(page, () => drag(page, { x: box.x + 4, y: box.y + 4 }, 200, 100));
  const panTo = await viewport(page);
  expectEffect(panTo.x !== panFrom.x || panTo.y !== panFrom.y, "pan");
  console.log(`pan: ${pan.frames} frames, p95 ${pan.p95.toFixed(1)} ms`);

  const zoomed = await zoomGesture(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

  const edited = await editGesture(page);

  const begins = await page.evaluate(() => window.sceneNumbers());
  const near = await panAt(page, begins.near);
  const middle = await panAt(page, begins.far);
  if (errors.length) throw new Error(`the example failed: ${errors.join("; ")}`);
  const levels = {
    near: { scale: begins.near, pan: near },
    middle: { scale: begins.far, pan: middle },
  };
  return {
    load,
    gpu,
    reference,
    node: node.id,
    drag: dragged,
    pan,
    zoom: zoomed,
    levels,
    edit: edited,
  };
}

/** Compared at the precision printed, so that a frame of 16.67 ms at 60 Hz meets 16.7. */
function verdict(value: number, target: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded <= target ? "ok" : `misses by ${(rounded - target).toFixed(1)}`;
}

function report(result: Awaited<ReturnType<typeof measure>>): void {
  const rows: [string, number, number, Measure | null][] = [
    ["first frame (ms)", result.load.firstFrameMs, TARGET_FIRST_FRAME_MS, null],
    ...gestures(result).map(
      ([name, gesture]) =>
        [`${name} p95 (ms)`, gesture.p95, TARGET_FRAME_MS, gesture] as [
          string,
          number,
          number,
          Measure,
        ],
    ),
  ];
  console.log(`${result.load.nodes} nodes, ${result.load.edges} edges — GPU: ${result.gpu}`);
  console.log(
    `pan near at scale ${result.levels.near.scale}, pan middle at ${result.levels.middle.scale}`,
  );
  for (const [name, value, target, m] of rows) {
    const note = m?.truncated
      ? `  (truncated: ${m.steps} of ${STEPS} steps, ${m.frames} frames)`
      : "";
    console.log(
      `${name.padEnd(26)} ${value.toFixed(1).padStart(9)}  target ${target}  ${verdict(value, target)}${note}`,
    );
  }
}

async function serving(): Promise<boolean> {
  return fetch(`http://localhost:${PORT}/`).then(
    (response) => response.ok,
    () => false,
  );
}

if (await serving()) throw new Error(`port ${PORT} is in use; the benchmark would measure it`);
const server = Bun.spawn(
  ["bunx", "--bun", "vite", "preview", "--port", String(PORT), "--strictPort"],
  { cwd: "examples/metric-tree", stdout: "ignore", stderr: "inherit" },
);
try {
  for (let i = 0; i < 100 && !(await serving()); i++) await Bun.sleep(100);
  if (!(await serving())) throw new Error("the preview server did not start");
  const browser = await chromium.launch({
    headless: !HEADED,
    env: chromiumEnv(HEADED),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const result = await measure(page);
    const commit = (await Bun.$`git describe --always --dirty`.nothrow().text()).trim();
    const record = {
      date: new Date().toISOString(),
      commit,
      headed: HEADED,
      cpu: cpus()[0]?.model,
      copies: COPIES,
      steps: STEPS,
      ...result,
      // Every field of `Run` present, an optional one too, so that one misnamed is refused rather
      // than read as missing, as a run of an older shape would be.
    } satisfies Run & { [K in keyof Run]-?: unknown } & {
      date: string;
      commit: string;
      steps: number;
    };
    mkdirSync("bench-results", { recursive: true });
    writeFileSync("bench-results/latest.json", JSON.stringify(record, null, 2) + "\n");
    report(result);
    console.log("Written to bench-results/latest.json.");
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
