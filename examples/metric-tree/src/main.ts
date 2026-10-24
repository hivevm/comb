// The example host application: Comb on the canvas, the attribute form in the HTML sidebar.
import { createComb, type Comb, type EngineSource, type GraphData, type Selection } from "comb";
import engineUrl from "comb/engine.wasm?url";
import {
  edgeVertices,
  inspect,
  renderCount,
  sceneNumbers,
  screenPoint,
  showLayers,
  testMode,
  trapNextCall,
  viewport,
  visibleRect,
  work,
  type SceneSnapshot,
} from "comb/testing";
import { metricTree, NODE_HEIGHT, NODE_WIDTH } from "./graph";

/** The type of the data a palette item carries in a drag. */
const PALETTE_TYPE = "application/x-metric-tree-kind";

/** How the last load went: what the benchmark and the browser tests read. */
export interface LoadReport {
  copies: number;
  nodes: number;
  edges: number;
  /** Milliseconds from handing the graph to Comb until its first frame was drawn. */
  firstFrameMs: number;
}

declare global {
  interface Window {
    comb: Comb;
    /** Comb's factory, so that a browser test can watch the document while a second Comb is made. */
    createComb: typeof createComb;
    /** The URL of the engine file Vite emits, for a browser test that hands a second Comb its
     *  engine. */
    engineUrl: string;
    loadReport: Promise<LoadReport>;
    /** What the canvas draws, from comb/testing, for the browser tests and the benchmark. */
    inspect: (other?: Comb) => SceneSnapshot;
    renderCount: () => number;
    viewport: () => SceneSnapshot["viewport"];
    showLayers: (layers: Parameters<typeof showLayers>[1]) => void;
    sceneNumbers: typeof sceneNumbers;
    testMode: typeof testMode;
    trapNextCall: typeof trapNextCall;
    screenPoint: (x: number, y: number) => ReturnType<typeof screenPoint>;
    visibleRect: (margin?: number) => ReturnType<typeof visibleRect>;
    work: () => ReturnType<typeof work>;
    edgeVertices: () => ReturnType<typeof edgeVertices>;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const query = new URLSearchParams(location.search);

/** The engine in the form `?engine=response`, `module`, `bytes`, or `view` asks for: the response
 *  to the example's own request for the file Vite emits, the module compiled from it, its bytes,
 *  or a view on them inside a larger buffer, so that the browser tests cover every form a host
 *  application may hand over (ADR-0019). */
async function engineAs(form: string): Promise<EngineSource> {
  const response = fetch(engineUrl);
  if (form === "module") return WebAssembly.compileStreaming(response);
  if (form === "bytes") return (await response).arrayBuffer();
  if (form === "view") {
    const bytes = new Uint8Array(await (await response).arrayBuffer());
    const padded = new Uint8Array(bytes.length + 16);
    padded.set(bytes, 8);
    return padded.subarray(8, 8 + bytes.length);
  }
  return response;
}

const form = query.get("engine");
// `?fallback=canvas` lets Comb draw on Canvas 2D where the browser offers no WebGL2.
const fallback = query.get("fallback") === "canvas";
// By default the example hands over the promise of its request, as a host application would.
const comb = await createComb(element("canvas"), {
  engine: form ? await engineAs(form) : fetch(engineUrl),
  allowCanvasFallback: fallback,
});
const copies = element<HTMLSelectElement>("copies");
const count = element("count");
const selection = element("selection");
const empty = element("empty");
const title = element<HTMLInputElement>("title");

let graph: GraphData = metricTree(1);
let selected: string | null = null;

/** Selects the copies the query string asks for, adding the option where it is missing. */
function copiesFromQuery(): void {
  const asked = Number(query.get("copies"));
  if (!Number.isInteger(asked) || asked < 1) return;
  if (![...copies.options].some((option) => option.value === String(asked))) {
    copies.add(new Option(String(asked), String(asked)));
  }
  copies.value = String(asked);
}

/** Shows the size of the graph the example holds. */
function counted(): void {
  count.textContent = `${graph.nodes.length} nodes, ${graph.edges.length} edges`;
}

async function load(): Promise<LoadReport> {
  graph = metricTree(Number(copies.value));
  counted();
  const start = performance.now();
  comb.load(graph);
  comb.fitView();
  await comb.whenRendered();
  const firstFrameMs = performance.now() - start;
  return {
    copies: Number(copies.value),
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    firstFrameMs,
  };
}

function show(next: Selection): void {
  selected = next?.kind === "node" ? next.id : null;
  const node = graph.nodes.find((candidate) => candidate.id === selected);
  selection.hidden = !node;
  empty.hidden = !!node;
  if (node) title.value = node.title;
}

/** The title a node dropped from the palette starts with, by its kind. */
const PALETTE: Record<string, string> = {
  bet: "New bet",
  epic: "New epic",
  metric: "New input metric",
  kpi: "New KPI",
};
let dropped = 0;

/** Adds a node of the palette's `kind`, centred on the world point under the drop at
 *  (`clientX`, `clientY`) of the page (G-1). */
function drop(kind: string, clientX: number, clientY: number): void {
  const title = PALETTE[kind];
  if (!title) return;
  const { x, y } = comb.worldPointAt(clientX, clientY);
  dropped += 1;
  try {
    comb.addNode({
      id: `${kind}-${dropped}`,
      title,
      x: x - NODE_WIDTH / 2,
      y: y - NODE_HEIGHT / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  } catch (error) {
    // A lost engine, or a node past the limits of a load: the drop adds nothing.
    console.warn("metric tree: the dropped node was not added", error);
  }
}

for (const item of document.querySelectorAll<HTMLElement>("#palette [data-kind]")) {
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData(PALETTE_TYPE, item.dataset.kind ?? "");
  });
}
const canvas = element("canvas");
canvas.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes(PALETTE_TYPE)) event.preventDefault();
});
canvas.addEventListener("drop", (event) => {
  event.preventDefault();
  drop(event.dataTransfer?.getData(PALETTE_TYPE) ?? "", event.clientX, event.clientY);
});
// The example keeps its own copy of the graph for the sidebar, from what Comb tells it.
comb.onChange((change) => {
  if (change.kind !== "nodeAdded") return;
  graph.nodes.push({ ...change.node });
  counted();
});
comb.onSelectionChange(show);
copies.addEventListener("change", () => {
  window.loadReport = load();
});
title.addEventListener("input", () => {
  const node = graph.nodes.find((candidate) => candidate.id === selected);
  if (!node) return;
  node.title = title.value;
  comb.updateNode(node.id, { title: title.value });
});
copiesFromQuery();
window.comb = comb;
window.createComb = createComb;
window.engineUrl = engineUrl;
window.inspect = (other = comb) => inspect(other);
window.renderCount = () => renderCount(comb);
window.viewport = () => viewport(comb);
window.showLayers = (layers) => showLayers(comb, layers);
window.sceneNumbers = sceneNumbers;
window.testMode = testMode;
window.trapNextCall = trapNextCall;
window.screenPoint = (x, y) => screenPoint(comb, x, y);
window.visibleRect = (margin) => visibleRect(comb, margin);
window.work = () => work(comb);
window.edgeVertices = () => edgeVertices(comb);
window.loadReport = load();
