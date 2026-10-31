// The benchmark of Q-1 and Q-2 (ADR-0008): the example at 50,000 nodes and 50,000 edges, each
// node with the content of its type (G-9, G-10), served from its production build. It measures
// the time from handing the graph to Comb until its first frame is drawn, and the p95 frame time
// of each gesture: a node on screen dragged, the viewport panned, the viewport zoomed in and out,
// and the graph edited one edit a frame, a node and an edge added and removed again (ADR-0022).
// It times them first at the view the example opens with, the whole graph fitted, as the
// baselines recorded before the levels were measured did, the zoom from there crossing every
// level; then at each level of detail (ADR-0027), centred in the graph, the pans first: near and
// middle at the scale where each begins, the least it draws at and so the most it binds. Where
// the fitted view draws the far level, as at 50,000 nodes, its drag, pan, and edits are far's and
// far adds only its zoom; otherwise every gesture is timed at far as well. The zoom at a level
// stays within it. Only frames in which Comb rendered count; each action is checked for its
// effect, so a gesture that missed fails the run instead of measuring idle frames. Before the
// gestures it times the reference workload of bench/reference.ts in the same page, by which
// bench/compare.ts tells whether the runner is in the state its kind's baseline was taken in; the
// CPU model it records names the runner's kind, the content the example counts names what was
// loaded, and each gesture records the steps it sent and the frames Comb rendered. The numbers go
// to bench-results/latest.json and are printed beside the targets.
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
import { contentOf, gestures, type LEVELS, type Run } from "./compare";
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

/** The wheel's turn of a step of the zoom at the view the example opens with. */
const WHEEL = 40;

/** Zooms in for the first half of the steps and out for the second, by `wheel` a step; `scales`
 *  collects the scale after each step, so the caller can tell that the gesture zoomed. */
async function zoom(page: Page, at: Point, scales: number[], wheel = WHEEL): Promise<number> {
  await page.mouse.move(at.x, at.y);
  return steps(page, async (i) => {
    await page.mouse.wheel(0, i <= STEPS / 2 ? -wheel : wheel);
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
  return page.evaluate((wanted) => window.inspect().nodes.find((node) => node.id === wanted)!, id);
}

async function viewport(page: Page) {
  return page.evaluate(() => window.viewport());
}

function expectEffect(ok: boolean, what: string): void {
  if (!ok) throw new Error(`the ${what} had no effect; the measurement would be of idle frames`);
}

/** Installs `benchEdit(i)` in the page: edit `i` of the gesture, one of adding a node beside
 *  `near`, adding an edge from `near` to it, removing the edge, and removing the node, over and
 *  over (ADR-0022). Before it edits, it counts in `drawnEdits` whether the canvas drew the edit
 *  before it, by a probe cheap enough not to weigh on the frame it falls in, as `inspect` would at
 *  50,000 nodes; `benchEdit(i + 1, false)` checks edit `i` alone. Every edit is counted in `told`
 *  once it is told. */
async function installEdits(page: Page, near: string): Promise<void> {
  const at = await drawnNode(page, near);
  await page.evaluate(
    ({ near: source, at: corner }) => {
      const w = window as unknown as BenchEdits;
      const ofStep = (i: number) => {
        const round = Math.floor((i - 1) / 4);
        return { kind: (i - 1) % 4, node: `bench-node-${round}`, edge: `bench-edge-${round}` };
      };
      // Whether the canvas shows what edit `i` made: its node or edge drawn, or no longer drawn.
      const shows = (i: number) => {
        const { kind, node, edge } = ofStep(i);
        const drawn = window.isDrawn(kind % 3 === 0 ? { node } : { edge });
        return kind < 2 ? drawn : !drawn;
      };
      [w.told, w.drawnEdits] = [0, 0];
      w.stopTelling = window.comb.onChange(() => (w.told += 1));
      w.benchEdit = (i, edit = true) => {
        if (i > 1 && shows(i - 1)) w.drawnEdits += 1;
        if (!edit) return;
        const { kind, node, edge } = ofStep(i);
        const { comb } = window;
        if (kind === 0)
          comb.addNode({
            id: node,
            x: corner.x + 40,
            y: corner.y + 90,
            width: 160,
            content: [[{ kind: "text", role: "title", text: "edit" }]],
          });
        else if (kind === 1) comb.addEdge({ id: edge, source, target: node });
        else if (kind === 2) comb.removeEdges([edge]);
        else comb.removeNodes([node]);
      };
    },
    { near, at: { x: at.x, y: at.y } },
  );
}

/** What `installEdits` keeps in the page. */
interface BenchEdits {
  told: number;
  drawnEdits: number;
  stopTelling: () => void;
  benchEdit: (i: number, edit?: boolean) => void;
}

/** The zoom gesture around `at`, by `wheel` a step, checked for having changed the scale and,
 *  where `within` is given, for having kept it within those bounds, the lower one included. */
async function zoomGesture(
  page: Page,
  at: Point,
  name = "zoom",
  wheel = WHEEL,
  within?: [number, number],
): Promise<Measure> {
  const zoomFrom = await viewport(page);
  const scales: number[] = [];
  const zoomed = await frameTimes(page, () => zoom(page, at, scales, wheel));
  expectEffect(
    scales.some((scale) => scale !== zoomFrom.scale),
    name,
  );
  if (within && !scales.every((scale) => scale >= within[0] && scale < within[1]))
    throw new Error(`the ${name} left its level, scales ${within[0]} to ${within[1]}`);
  console.log(`${name}: ${zoomed.frames} frames, p95 ${zoomed.p95.toFixed(1)} ms`);
  return zoomed;
}

/** The edit gesture, beside the node nearest the centre of the view: each edit is told and
 *  drawn. A gesture the time budget cuts short of a whole round leaves its node or edge, which is
 *  removed after the timed frames; then no edit is left drawn. */
async function editGesture(page: Page, name = "edit"): Promise<Measure> {
  const beside = await nodeNearCentre(page);
  await installEdits(page, beside.id);
  const edited = await frameTimes(page, () =>
    steps(page, (i) =>
      page.evaluate((edit) => (window as unknown as BenchEdits).benchEdit(edit), i),
    ),
  );
  const checked = await page.evaluate(async (made) => {
    await window.comb.whenRendered();
    const w = window as unknown as BenchEdits;
    w.benchEdit(made + 1, false);
    w.stopTelling();
    const { comb } = window;
    const ids = (prefix: string, of: { id: string }[]) =>
      of.map(({ id }) => id).filter((id) => id.startsWith(prefix));
    comb.removeNodes(ids("bench-node-", window.inspect().nodes));
    await comb.whenRendered();
    const { nodes, edges } = window.inspect();
    const left = ids("bench-node-", nodes).length + ids("bench-edge-", edges).length;
    return { told: w.told, drawnEdits: w.drawnEdits, left };
  }, edited.steps);
  expectEffect(
    checked.told === edited.steps && checked.drawnEdits === edited.steps && checked.left === 0,
    name,
  );
  console.log(`${name}: ${edited.frames} frames, p95 ${edited.p95.toFixed(1)} ms`);
  return edited;
}

/** The middle of the graph, in world coordinates. */
async function graphMiddle(page: Page): Promise<Point> {
  return page.evaluate(() => {
    const nodes = window.inspect().nodes;
    const half = (of: number[]) => (Math.min(...of) + Math.max(...of)) / 2;
    return { x: half(nodes.map((node) => node.x)), y: half(nodes.map((node) => node.y)) };
  });
}

/** Shows `middle` in the middle of the canvas at `scale` and waits until it is drawn. */
async function centreAt(page: Page, middle: Point, scale: number): Promise<void> {
  const box = (await page.locator("#canvas canvas").boundingBox())!;
  await page.evaluate(
    async ({ middle: at, scale: wanted, width, height }) => {
      window.comb.setViewport({
        x: width / 2 - at.x * wanted,
        y: height / 2 - at.y * wanted,
        scale: wanted,
      });
      await window.comb.whenRendered();
    },
    { middle, scale, width: box.width, height: box.height },
  );
}

/** A level of detail as the benchmark times it: the scale its gestures start at, and the bounds
 *  its zoom stays within, the lower one included. */
interface Level {
  name: (typeof LEVELS)[number];
  scale: number;
  within: [number, number];
}

/** The pan from an empty point by 400 and 200 pixels, checked for having moved the viewport; it
 *  leaves the culling margin, so the scene queries. */
async function panGesture(page: Page, name: string): Promise<Measure> {
  const start = await emptyPoint(page);
  const from = await viewport(page);
  const pan = await frameTimes(page, () => drag(page, start, 400, 200));
  const to = await viewport(page);
  expectEffect(to.x !== from.x || to.y !== from.y, name);
  console.log(`${name}: ${pan.frames} frames, p95 ${pan.p95.toFixed(1)} ms`);
  return pan;
}

/** The drag of the node nearest the centre of the view by 120 pixels down, checked for having
 *  moved it. */
async function dragGesture(page: Page, name: string): Promise<Measure> {
  const node = await nodeNearCentre(page);
  const before = await drawnNode(page, node.id);
  const dragged = await frameTimes(page, () => drag(page, node.at, 0, 120));
  const after = await drawnNode(page, node.id);
  expectEffect(after.y !== before.y, `${name} of node ${node.id}`);
  console.log(`${name}: ${dragged.frames} frames, p95 ${dragged.p95.toFixed(1)} ms`);
  return dragged;
}

/** The wheel's turn a step that zooms by `factor` over half the steps, from the zoom of one
 *  wheel event by WHEEL, taken back before the gesture. */
async function wheelFor(page: Page, at: Point, factor: number): Promise<number> {
  const from = (await viewport(page)).scale;
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -WHEEL);
  await page.evaluate(() => window.comb.whenRendered());
  const by = (await viewport(page)).scale / from;
  await page.mouse.wheel(0, WHEEL);
  await page.evaluate(() => window.comb.whenRendered());
  return (WHEEL * Math.log(factor)) / Math.log(by) / (STEPS / 2);
}

/** Shows `middle` at `level`'s scale, checked for drawing that level. */
async function toLevel(page: Page, middle: Point, { name, scale }: Level): Promise<void> {
  await centreAt(page, middle, scale);
  const drawn = await page.evaluate(() => window.inspect().level);
  if (drawn !== name) throw new Error(`at scale ${scale} the scene draws ${drawn}, not ${name}`);
}

/** The pan at `level`, from the level's scale, centred on `middle`. */
async function panAtLevel(page: Page, middle: Point, level: Level): Promise<Measure> {
  await toLevel(page, middle, level);
  return panGesture(page, `pan ${level.name}`);
}

/** The zoom at `level`, in from just above the level's scale towards its upper bound and out
 *  again, around the centre of the canvas, centred on `middle`. */
async function zoomAtLevel(page: Page, middle: Point, level: Level): Promise<Measure> {
  const { name, scale, within } = level;
  await toLevel(page, middle, level);
  // Off the level's lower bound by a hundredth and short of its upper one by a twentieth, so that
  // the rounding of the way in and out again cannot leave the level.
  const from = Math.max(scale, within[0] * 1.01);
  await centreAt(page, middle, from);
  const box = (await page.locator("#canvas canvas").boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const wheel = await wheelFor(page, centre, (within[1] * 0.95) / from);
  return zoomGesture(page, centre, `zoom ${name}`, wheel, within);
}

/** The drag, the zoom, and the edits at `level`, each from the level's scale, centred on
 *  `middle`. */
async function restAtLevel(page: Page, middle: Point, level: Level) {
  await toLevel(page, middle, level);
  const dragged = await dragGesture(page, `drag ${level.name}`);
  const zoomed = await zoomAtLevel(page, middle, level);
  await toLevel(page, middle, level);
  const edited = await editGesture(page, `edit ${level.name}`);
  return { drag: dragged, zoom: zoomed, edit: edited };
}

/** A point on the canvas, near its top left, where a press hits nothing, no connector, label,
 *  node or edge, and so pans (ADR-0013). */
async function emptyPoint(page: Page): Promise<Point> {
  return page.evaluate(() => {
    const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
    for (let py = 4; py < rect.height / 2; py += 3) {
      for (let px = 4; px < rect.width / 2; px += 3) {
        // The example lets the user connect, so the hit test finds connectors, as a press does.
        if (window.hitKind(px, py) === "none") return { x: rect.left + px, y: rect.top + py };
      }
    }
    throw new Error("no empty point to pan from");
  });
}

/** The gestures at the view the example opens with, as the baselines recorded before the levels
 *  timed them: the drag of the node nearest the centre, the pan from the canvas's top left, the
 *  zoom around its centre, and the edits. */
async function atFittedView(page: Page) {
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
  return { node, dragged, pan, zoomed, edited };
}

/** The gestures at each level of detail, centred on `middle`, the pans first, so that the pans at
 *  near and middle follow the gestures at the fitted view, as when their baselines were taken.
 *  Near reaches up to the largest scale Comb zooms to, and four times where it begins stays below
 *  it. Where the fitted view, of scale `fitted`, draws the far level, the gestures at the fitted
 *  view are those of far, and far adds only its zoom, which stays within far; otherwise, for a
 *  graph whose fitted view is nearer, every gesture is timed at far at half where far begins. */
async function atEveryLevel(page: Page, middle: Point, fitted: number) {
  const begins = await page.evaluate(() => window.sceneNumbers());
  const fittedIsFar = fitted < begins.far;
  const farScale = fittedIsFar ? fitted : begins.far / 2;
  const near: Level = { name: "near", scale: begins.near, within: [begins.near, begins.near * 4] };
  const middleLevel: Level = {
    name: "middle",
    scale: begins.far,
    within: [begins.far, begins.near],
  };
  const far: Level = { name: "far", scale: farScale, within: [farScale, begins.far] };
  const pans = {
    near: await panAtLevel(page, middle, near),
    middle: await panAtLevel(page, middle, middleLevel),
    far: fittedIsFar ? undefined : await panAtLevel(page, middle, far),
  };
  const levels = {
    near: { scale: near.scale, pan: pans.near, ...(await restAtLevel(page, middle, near)) },
    middle: {
      scale: middleLevel.scale,
      pan: pans.middle,
      ...(await restAtLevel(page, middle, middleLevel)),
    },
    far: fittedIsFar
      ? { scale: far.scale, zoom: await zoomAtLevel(page, middle, far) }
      : { scale: far.scale, pan: pans.far, ...(await restAtLevel(page, middle, far)) },
  };
  return { fittedIsFar, levels };
}

async function measure(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://localhost:${PORT}/?copies=${COPIES}`, { timeout: LOAD_TIMEOUT_MS });
  // The example sets loadReport after a top-level await, which the load event does not wait for.
  await page.waitForFunction(() => "loadReport" in window, null, { timeout: LOAD_TIMEOUT_MS });
  // A build in test mode grows the engine's memory before every call: no number of it holds.
  if (await page.evaluate(() => window.testMode()))
    throw new Error("the example runs the bridge in test mode; no number holds");
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

  // The view the example opens with, the whole graph fitted, which draws the far level.
  const fitted = await viewport(page);
  const middle = await graphMiddle(page);
  const { node, dragged, pan, zoomed, edited } = await atFittedView(page);
  const { fittedIsFar, levels } = await atEveryLevel(page, middle, fitted.scale);
  if (errors.length) throw new Error(`the example failed: ${errors.join("; ")}`);
  return {
    load,
    gpu,
    // The scale of the fitted view, and the level it draws: far, its drag, pan, and edits those
    // of the far level, or another, for a graph small enough.
    fitted: { scale: fitted.scale, level: fittedIsFar ? "far" : "nearer than far" },
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
  console.log(`content: ${contentOf(result.load.content)}`);
  const { fitted, levels } = result;
  const draws =
    fitted.level === "far" ? "the far level: drag, pan, and edit are far's" : "nearer than far";
  console.log(
    `drag, pan, zoom, and edit at the fitted view, scale ${fitted.scale.toPrecision(3)}, ` +
      `which draws ${draws}; ` +
      `near at scale ${levels.near.scale}, middle at ${levels.middle.scale}, ` +
      `far at ${levels.far.scale.toPrecision(3)}`,
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
