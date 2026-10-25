// The example host application: Comb on the canvas, the attribute form in the HTML sidebar.
import {
  createComb,
  type Comb,
  type Deletion,
  type Proposal,
  type EdgeData,
  type EdgePatch,
  type EngineSource,
  type GraphChange,
  type GraphData,
  type Selection,
} from "comb";
import engineUrl from "comb/engine.wasm?url";
import {
  edgeVertices,
  hitKind,
  inspect,
  isDrawn,
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
    /** The veto of the user's deletions a browser test sets; without one, every deletion is
     *  allowed. Its result is handed to Comb as it is. */
    canDelete?: (deletion: Deletion) => unknown;
    /** The veto of the user's connections a browser test sets; without one, the example names
     *  each new edge after its ends. Its result is handed to Comb as it is. */
    canConnect?: (proposal: Proposal) => unknown;
    /** Loads `graph` as the example's own, which its sidebar edits, for a browser test. */
    useGraph: (graph: GraphData) => void;
    /** The example's copy of the graph, kept from what `onChange` tells. */
    exampleGraph: () => GraphData;
    /** What the canvas draws, from comb/testing, for the browser tests and the benchmark. */
    inspect: (other?: Comb) => SceneSnapshot;
    renderCount: () => number;
    viewport: () => SceneSnapshot["viewport"];
    showLayers: (layers: Parameters<typeof showLayers>[1]) => void;
    sceneNumbers: typeof sceneNumbers;
    testMode: typeof testMode;
    trapNextCall: typeof trapNextCall;
    screenPoint: (x: number, y: number) => ReturnType<typeof screenPoint>;
    hitKind: (x: number, y: number) => ReturnType<typeof hitKind>;
    isDrawn: (what: Parameters<typeof isDrawn>[1]) => boolean;
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
/** How many edges the user connected, for the name of the next. */
let connected = 0;
// `?fallback=canvas` lets Comb draw on Canvas 2D where the browser offers no WebGL2.
const fallback = query.get("fallback") === "canvas";
// By default the example hands over the promise of its request, as a host application would.
const comb = await createComb(element("canvas"), {
  engine: form ? await engineAs(form) : fetch(engineUrl),
  allowCanvasFallback: fallback,
  canDelete: (deletion) => (window.canDelete ? window.canDelete(deletion) : true) as boolean,
  // `?connect=none` gives Comb no veto of connections, so that the user connects nothing.
  ...(query.get("connect") === "none"
    ? {}
    : {
        canConnect: (proposal: Proposal) =>
          (window.canConnect
            ? window.canConnect(proposal)
            : `${proposal.source}-${proposal.target}-${(connected += 1)}`) as string | false,
      }),
});
const copies = element<HTMLSelectElement>("copies");
const count = element("count");
const selection = element("selection");
const empty = element("empty");
const title = element<HTMLInputElement>("title");
const edgeSelection = element("edge-selection");
const edgeColor = element<HTMLInputElement>("edge-color");
const edgeDash = element<HTMLSelectElement>("edge-dash");
const edgeArrow = element<HTMLInputElement>("edge-arrow");
const edgeLabel = element<HTMLInputElement>("edge-label");
/** The dash pattern the sidebar gives an edge it makes dashed, as the tree's own dashed edges. */
const DASH = [6, 4] as const;
/** Comb's colour for an edge that names none, which a host application cannot read from it. */
const EDGE_GREY = 0x9aa1ad;

let graph: GraphData = metricTree(1);
let selected: string | null = null;
let selectedEdge: EdgeData | undefined;

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
  selectedEdge =
    next?.kind === "edge" ? graph.edges.find((candidate) => candidate.id === next.id) : undefined;
  selection.hidden = !node;
  edgeSelection.hidden = !selectedEdge;
  empty.hidden = !!node || !!selectedEdge;
  if (node) title.value = node.title;
  if (selectedEdge) showEdge(selectedEdge);
}

/** Fills the sidebar's form of an edge from `edge`. */
function showEdge(edge: EdgeData): void {
  const color = edge.color ?? EDGE_GREY;
  edgeColor.value = `#${color.toString(16).padStart(6, "0")}`;
  edgeDash.value = edge.dash ? "dashed" : "solid";
  edgeArrow.checked = edge.arrow !== "none";
  edgeLabel.value = edge.label?.text ?? "";
}

/** Changes the selected edge by `patch` through `updateEdge`; the example's graph follows from
 *  the `edgeUpdated` Comb tells. */
function changeEdge(patch: EdgePatch): void {
  if (selectedEdge) comb.updateEdge(selectedEdge.id, patch);
}

const nodeOf = (id: string) => graph.nodes.find((candidate) => candidate.id === id);
const edgeOf = (id: string) => graph.edges.find((candidate) => candidate.id === id);

/** `edge` with `patch` merged, as Comb merges it: `null` clears a dash or a label. */
function patched(edge: EdgeData, patch: EdgePatch): void {
  const { dash, label, ...rest } = patch;
  Object.assign(edge, rest);
  if (dash !== undefined) edge.dash = dash ?? undefined;
  if (label !== undefined) edge.label = label ?? undefined;
}

/** Drops from the copy the nodes and edges a removal names. */
function removed(nodes: readonly string[], edges: readonly string[]): void {
  const [goneNodes, goneEdges] = [new Set(nodes), new Set(edges)];
  graph.nodes = graph.nodes.filter(({ id }) => !goneNodes.has(id));
  graph.edges = graph.edges.filter(({ id }) => !goneEdges.has(id));
}

/** How the example's copy of the graph takes each kind of change, as a host application that
 *  persists keeps its own from `onChange` alone (ADR-0023); the type checker fails it where a
 *  kind is left out. */
const MIRROR: { [K in GraphChange["kind"]]: (change: Extract<GraphChange, { kind: K }>) => void } =
  {
    // `load` and `useGraph` set the copy before they hand it to Comb.
    loaded: () => {},
    nodeAdded: ({ node }) => void graph.nodes.push({ ...node }),
    nodeUpdated: ({ id, patch }) => {
      const node = nodeOf(id);
      if (node) Object.assign(node, patch);
    },
    nodeMoved: ({ id, x, y }) => {
      const node = nodeOf(id);
      if (node) Object.assign(node, { x, y });
    },
    nodesRemoved: ({ nodes, edges }) => removed(nodes, edges),
    edgeAdded: ({ edge }) => void graph.edges.push({ ...edge }),
    edgeUpdated: ({ id, patch }) => {
      const edge = edgeOf(id);
      if (edge) patched(edge, patch);
    },
    edgesRemoved: ({ edges }) => removed([], edges),
    labelMoved: ({ edge: id, t, offset }) => {
      const edge = edgeOf(id);
      if (edge?.label) edge.label = { ...edge.label, t, offset };
    },
  };

/** Takes `change` into the example's copy of the graph. */
function mirror(change: GraphChange): void {
  (MIRROR[change.kind] as (change: GraphChange) => void)(change);
  counted();
}

/** The label the sidebar's text gives the selected edge: its own moved to the new text, a new one
 *  in the middle of the edge, or none for no text. */
function labelFor(text: string): EdgeData["label"] | null {
  if (text === "") return null;
  const color = selectedEdge?.color ?? EDGE_GREY;
  return { t: 0.5, offset: 0, background: color, ...selectedEdge?.label, text };
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
comb.onChange(mirror);
comb.onSelectionChange(show);
copies.addEventListener("change", () => {
  window.loadReport = load();
});
title.addEventListener("input", () => {
  // The copy follows from the `nodeUpdated` Comb tells.
  if (selected !== null && nodeOf(selected)) comb.updateNode(selected, { title: title.value });
});
edgeColor.addEventListener("input", () =>
  changeEdge({ color: Number.parseInt(edgeColor.value.slice(1), 16) }),
);
edgeDash.addEventListener("change", () =>
  changeEdge({ dash: edgeDash.value === "dashed" ? DASH : null }),
);
edgeArrow.addEventListener("change", () =>
  changeEdge({ arrow: edgeArrow.checked ? "end" : "none" }),
);
edgeLabel.addEventListener("input", () => changeEdge({ label: labelFor(edgeLabel.value) }));
copiesFromQuery();
window.comb = comb;
window.exampleGraph = () => structuredClone(graph);
window.useGraph = (next) => {
  graph = next;
  counted();
  comb.load(next);
};
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
window.hitKind = (x, y) => hitKind(comb, x, y);
window.isDrawn = (what) => isDrawn(comb, what);
window.visibleRect = (margin) => visibleRect(comb, margin);
window.work = () => work(comb);
window.edgeVertices = () => edgeVertices(comb);
window.loadReport = load();
