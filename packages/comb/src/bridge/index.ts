// The facade of the engine, in the bridge, the one module that imports the WebAssembly package
// (ADR-0028), beside the writers of a load's columns in `columns.ts`. Structured data crosses as
// generated types through serde-wasm-bindgen, but for a load's nodes and edges, which cross as
// columns of strings in pieces or one typed array each; node positions and the results of a
// viewport query are read through views on the engine's buffers, created anew on every read
// because growing memory detaches older views (ADR-0034).
import init, {
  checkGraphSize,
  checkContentBudget,
  badgePaddingX,
  badgePaddingY,
  checkIdBudget,
  columnLimit,
  contentBudget,
  DetailLevel,
  EdgeField,
  idBudget,
  idLimit,
  rowLimit,
  segmentLimit,
  textLimit,
  Engine,
  initSync,
  MeshDetail,
  NodeField,
  type ContentElement,
  type InitOutput,
  type EdgeInput,
  type EdgePatch,
  type ElementHit,
  type ElementKind,
  type Hit,
  type GraphDataProblem,
  type NodeContent,
  type NodeInput,
  type NodePatch,
  type NumberError,
  type SlotError,
  type TextRole,
} from "../../wasm/engine.js";
import { ROLES, type EdgeColumns, type NodeColumns } from "./columns";

export type {
  ContentElement,
  EdgeField,
  ElementHit,
  ElementKind,
  GraphDataProblem,
  NodeContent,
  NodeField,
  Hit,
  NodeInput,
  NodePatch,
  NumberError,
  SlotError,
  TextRole,
};

export {
  edgeColumns,
  KIND_NAMES,
  nodeColumns,
  PIECE_BOUND,
  ROLE_NAMES,
  type ContentColumns,
  type EdgeColumns,
  type EdgeColumnWriter,
  type NodeColumns,
  type NodeColumnWriter,
} from "./columns";

/** The refusal of `translate`'s delta, under the name it had before `NumberError` held it. */
export type TranslateError = NumberError;

/** The mark of plain data `api/snapshot.ts` read once from the host application's value
 *  (ADR-0028). It is exported nowhere, so that handing the bridge a value of the host
 *  application, which may hold a getter or a Proxy, takes a cast a reviewer sees. */
declare const read: unique symbol;

/** The snapshot of a load: what `snapshotOf` hands the bridge, its nodes and its edges as
 *  columns. */
export type GraphSnapshot = { readonly nodes: NodeColumns; readonly edges: EdgeColumns } & {
  readonly [read]: "graph";
};

/** The node of `addNode` read once: what `nodeSnapshotOf` returns, and the node the bridge
 *  takes. */
export type NodeSnapshot = NodeInput & { readonly [read]: "node" };

/** The plain patch of `updateNode`: what `patchOf` returns, and the patch the bridge takes. */
export type PlainPatch = NodePatch & { readonly [read]: "patch" };

/** The edge of `addEdge` read once: what `edgeSnapshotOf` returns, and the edge the bridge
 *  takes. */
export type EdgeSnapshot = EdgeInput & { readonly [read]: "edge" };

/** The plain patch of `updateEdge`: what `edgePatchOf` returns, and the patch the bridge takes. */
export type PlainEdgePatch = EdgePatch & { readonly [read]: "edgePatch" };

/** A rectangle in world coordinates. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The triangles of the found edges: per vertex its position `x, y`, its distance along its
 *  path, its colour as RGBA bytes, and its dash pattern `dash, gap` (0, 0 for solid); three
 *  vertex indices per triangle. */
export interface EdgeMesh {
  positions: Float32Array;
  distances: Float32Array;
  colors: Uint32Array;
  dashes: Float32Array;
  indices: Uint32Array;
}

/** The detail of a query's edge mesh (ADR-0027): complete, or coarsened where an edge was drawn
 *  as its chord, or left out, for the mesh budget or for memory. */
export type Detail = "complete" | "coarsened";

const DETAILS: Record<MeshDetail, Detail> = {
  [MeshDetail.Complete]: "complete",
  [MeshDetail.Coarsened]: "coarsened",
};

/** Where the elements of the content of the nodes a query found lie and what they draw
 *  (ADR-0013), at the near and the middle level: per found node, in their order, the boundaries
 *  of its elements in the other columns, one more than there are found nodes; per element, its
 *  node's elements in the order of its rows and theirs, its rectangle `x, y, width, height`
 *  relative to its node's top-left corner, its kind's code, the role whose font draws its text,
 *  body for an action, a badge, and a progress bar, its colour as `0xRRGGBB`, a badge's pill's and
 *  0 for an element of no colour, and what is drawn of its text, the text or as much of it as fits
 *  followed by an ellipsis, those strings one after another in `texts`, cut by `textBounds`; and
 *  per element the boundaries of the pieces of its bar in `barBounds`, one more than there are
 *  elements, a progress bar's segments and then its track and no piece of another kind, each
 *  piece's rectangle `x, y, width, height` relative to its node in `bars`, and its colour in
 *  `barColors`, a segment's, 0 for the track. A metric's colour is its trend's, its role body's,
 *  and its drawn text its caption's, value's, and trend's text's one after another: per element
 *  the boundaries of its parts in `partBounds`, a metric's three and no part of another kind,
 *  each part's rectangle relative to its node in `parts`, and where its text ends in `texts` in
 *  `partEnds`, each starting where the one before it in its element ends, the first where its
 *  element's text starts; and per element the boundaries of its arrows in `arrowBounds`, a
 *  metric's one where its column holds it, each arrow's triangle as three points `x, y` relative
 *  to its node in `arrows`. An icon's rectangle is its square, and its text in `texts` its
 *  registered name, whole, which the shell draws as the image registered under it. Of each node
 *  it holds the elements drawn at the query's level, at the middle level its texts of role title
 *  alone; at the far level it holds no node. */
export interface Placed {
  bounds: Uint32Array;
  rects: Float32Array;
  kinds: Uint8Array;
  roles: Uint8Array;
  colors: Uint32Array;
  texts: string;
  textBounds: Uint32Array;
  barBounds: Uint32Array;
  bars: Float32Array;
  barColors: Uint32Array;
  partBounds: Uint32Array;
  parts: Float32Array;
  partEnds: Uint32Array;
  arrowBounds: Uint32Array;
  arrows: Float32Array;
  /** The space between a badge's text and its pill's left side and its top, the engine's. */
  badgePadding: { x: number; y: number };
}

/** What a viewport query found: node slots in ascending order, the edge slot and point of each
 *  found edge label, the mesh of the found edges and its detail, where the found nodes' content
 *  lies, and the positions and sizes buffers, all read after the same call. The label points and
 *  the mesh's positions are relative to `origin`, a world point near the query's rectangle, so
 *  that `f32` rounds them by their distance from it (ADR-0034); the positions buffer is not. */
export interface Visible {
  positions: Float32Array;
  sizes: Float32Array;
  nodes: Uint32Array;
  content: Placed;
  labels: Uint32Array;
  labelPoints: Float32Array;
  mesh: EdgeMesh;
  detail: Detail;
  origin: { x: number; y: number };
}

/** The level of detail a query serves (ADR-0027): near with edge labels, middle without, far
 *  with edges as plain lines one pixel wide. */
export type Level = "near" | "middle" | "far";

const LEVELS: Record<Level, DetailLevel> = {
  near: DetailLevel.Near,
  middle: DetailLevel.Middle,
  far: DetailLevel.Far,
};

/** The edges the last query found, by slot, with the point each leaves its source and enters
 *  its target, `x, y` each. */
export interface DrawnEdges {
  slots: Uint32Array;
  ends: Float32Array;
}

/** The metrics of a font the shell draws the texts of a role with, in world units: the advance
 *  of the glyph of each code point of `codes` in `advances`, of every other character
 *  `fallback`, and the height of a line (ADR-0013). */
export interface FontMetrics {
  codes: Uint32Array;
  advances: Float64Array;
  fallback: number;
  lineHeight: number;
}

export interface Bridge {
  /** Replaces the graph; node slot `i` is the batch's node `i`, edge slot `i` its edge `i`.
   *  Throws a `GraphDataProblem`. */
  loadGraph(batch: GraphSnapshot): number;
  /** Checks `node` as a load checks a node and adds it, drawn and hit above every other node, and
   *  returns the slot the engine chose for it (ADR-0022). Throws a `GraphDataProblem`, the graph
   *  as it was. */
  addNode(node: NodeSnapshot): number;
  /** The height, in world units, the content of `node` lays out to at its width, checked as
   *  `addNode` checks a node and added to nothing; `api` names it `""` and puts it at the origin
   *  (ADR-0035). Throws a `GraphDataProblem`. */
  heightOf(node: NodeSnapshot): number;
  /** Checks `edge` as a load checks an edge, refuses one from a node to itself, and adds it
   *  between the node slots `source` and `target`, which `api` resolved; returns the slot the
   *  engine chose for it (ADR-0022). Throws a `GraphDataProblem`, and a `SlotError` where a slot
   *  of an end holds no node, the graph as it was. */
  addEdge(edge: EdgeSnapshot, source: number, target: number): number;
  /** Checks the patch of the edge `id` in `slot` as a load checks those fields and gives the edge
   *  its new style and label placement. Throws a `GraphDataProblem`, and a `SlotError` where
   *  `slot` holds no edge, the graph as it was. */
  updateEdge(slot: number, id: string, patch: PlainEdgePatch): void;
  /** Checks the patch of the node `id` in `slot` as a load checks a node's content and gives the
   *  node its new content and the height it lays out to (ADR-0013). Throws a `GraphDataProblem`,
   *  and a `SlotError` where `slot` holds no node, the graph as it was. */
  updateNode(slot: number, id: string, patch: PlainPatch): void;
  /** Hands over the metrics of the font the texts of `role` are drawn with, for every layout
   *  from then on (ADR-0013). Throws a `NumberError` `invalidFont` for metrics the engine cannot
   *  take. */
  setFont(role: TextRole, font: FontMetrics): void;
  /** The most UTF-16 code units of a text of content or a label text the bridge accepts. */
  textLimit(): number;
  /** The most rows of a node's content the bridge accepts. */
  rowLimit(): number;
  /** The most columns of a row the bridge accepts. */
  columnLimit(): number;
  /** The most segments of a progress bar the bridge accepts. */
  segmentLimit(): number;
  /** The most UTF-16 code units of an identifier the bridge accepts. */
  idLimit(): number;
  /** The most UTF-16 code units of all identifiers of one load the bridge accepts. */
  idBudget(): number;
  /** Checks how many UTF-16 code units the identifiers of one load hold. Throws a
   *  `GraphDataProblem`. */
  checkIdBudget(units: number): void;
  /** The most UTF-16 code units of the texts of content of one load the bridge accepts. */
  contentBudget(): number;
  /** Checks how many UTF-16 code units the texts of content of one load hold, the node `node`
   *  the one whose text passed the budget. Throws a `GraphDataProblem`. */
  checkContentBudget(units: number, node: string): void;
  /** Checks how many nodes and edges a graph holds, before any is copied. Throws a
   *  `GraphDataProblem`. */
  checkGraphSize(nodes: number, edges: number): void;
  /** Removes the nodes in `slots` and every edge at them, and returns the slots of those edges in
   *  ascending order (ADR-0022). Throws a `SlotError`, a mistake of the shell's, never one of
   *  graph data, the graph as it was. */
  removeNodes(slots: Uint32Array): Uint32Array;
  /** Records the half width and half height of the pill of the label of the edge in `slot`, in
   *  world units, as the labels layer draws it; a label not measured is not hit (ADR-0013).
   *  Throws a `SlotError`. */
  setLabelSize(slot: number, halfWidth: number, halfHeight: number): void;
  /** The world point of the label of the edge in `slot`, or none where it holds no edge with a
   *  label. */
  labelPoint(slot: number): { x: number; y: number } | undefined;
  /** Places the label of the edge in `slot` at the world point `(x, y)`: at the path parameter
   *  nearest it and its distance along the normal there, which it returns (G-6). Throws a
   *  `SlotError`, and a `NumberError` `nonFinitePoint` for a point that is not finite, before
   *  anything moves (ADR-0031). */
  moveLabel(slot: number, x: number, y: number): { t: number; offset: number };
  /** The slots of the edges at the nodes in `slots`, in ascending order, as a removal of them
   *  would take along, named before anything is removed (ADR-0022). Throws a `SlotError`. */
  edgesAt(slots: Uint32Array): Uint32Array;
  /** Removes the edges in `slots`. Throws a `SlotError`, the graph as it was. */
  removeEdges(slots: Uint32Array): void;
  /** Moves the nodes in `slots`, their edges with them. Throws a `SlotError` for a slot that
   *  holds no node and a `NumberError` `nonFiniteDelta` for a delta that is not finite, mistakes
   *  of the shell's, never of graph data (ADR-0031). */
  translate(slots: Uint32Array, dx: number, dy: number): void;
  /** A fresh view on the positions buffer, `x, y` per slot. Do not keep it across calls. */
  positions(): Float32Array;
  /** The content of the node in `slot`, built when asked, since the shell keeps none (ADR-0013).
   *  Throws a `SlotError` where `slot` holds no node. */
  content(slot: number): NodeContent;
  /** Fresh views on the positions buffer and on the sizes buffer, `width, height` per slot, the
   *  height each node's content lays out to (ADR-0013), both read after the same call. Do not
   *  keep them across calls. */
  nodeBuffers(): { positions: Float32Array; sizes: Float32Array };
  /** The nodes and edges that meet `rect` and the mesh of the edges for `level`, where a screen
   *  pixel is `pixel` world units, within the engine's mesh budget, and the mesh's detail; at the
   *  near and the middle level where the found nodes' content lies; at the near level also the
   *  edge labels whose point lies within `labelReach` of it. Fresh views; do
   *  not keep them across calls. Throws a `NumberError` `invalidPixel` for a pixel that is not a
   *  finite number above zero (ADR-0031). */
  query(rect: Rect, level: Level, pixel: number, labelReach: number): Visible;
  /** The edges the last query found, with their ends as they lie now, which after a move and
   *  before the next query are already moved: for inspection, not for drawing. Fresh views; do
   *  not keep them across calls. */
  drawnEdges(): DrawnEdges;
  /** What a press at the world point `(x, y)` hits where a screen pixel is `pixel` world units,
   *  at `level`: where `connectors` asks for them, at the near and middle level, a connector
   *  within 8 screen pixels, of the node drawn on top; else the node drawn on top there, else the
   *  edge drawn on top within 4 screen pixels of its path as the stroke flattens it, else nothing
   *  (ADR-0013). Throws a `NumberError`, `invalidPixel` for a pixel that is not a finite number
   *  above zero and `nonFinitePoint` for a point that is not finite (ADR-0031). */
  hit(x: number, y: number, pixel: number, level: Level, connectors: boolean): Hit;
}

/** Whether the bridge runs in test mode: under `bun test`, and in Vite's `test` mode, which the
 *  browser tests serve the example in. Code that imports this source, not the built bundle, under
 *  a tool in mode `test` turns it on; a built bundle settles the mode when it is built, and a
 *  production build replaces it by `production`, so the bundle carries none of it. */
export const TEST_MODE = import.meta.env.MODE === "test" || import.meta.env.NODE_ENV === "test";

/** The mark of each seam of test mode in a bundle that carries it: of `detaching`, a word of its
 *  error's message; of the trap, the name of the engine's export that arms it, which `wrap` looks
 *  up. scripts/check-bundle.sh reads both here, fails a shipped bundle that carries either, and
 *  fails unless it finds both in the library built in test mode and the trap's in the engine. */
const DETACHING_MARK = "comb-test-mode:detaching";
const TRAP_EXPORT = "comb_test_mode_trap";

/** Each call of `bridge` passed through `around`. */
function each(
  bridge: Bridge,
  around: <A extends unknown[], R>(call: (...args: A) => R) => (...args: A) => R,
): Bridge {
  const calls = Object.entries(bridge).map(([name, call]) => [name, around(call)]);
  return Object.fromEntries(calls) as Bridge;
}

/** `bridge` with the engine's memory grown by a page before each of its calls, so that a view
 *  kept across a call is detached and reads empty in tests, not only when memory happens to grow
 *  (ADR-0034). The message of its error carries `DETACHING_MARK`. */
function detaching(bridge: Bridge, memory: WebAssembly.Memory): Bridge {
  return each(bridge, (call) => (...args) => {
    try {
      memory.grow(1);
    } catch (cause) {
      throw new Error(`${DETACHING_MARK}: the engine's memory cannot grow further`, { cause });
    }
    return call(...args);
  });
}

/** The engine trapped, in a call of this Comb or of another on the page, and is lost for the
 *  page (ADR-0021): Comb refuses every later call that needs it, and only loading the page anew
 *  brings it back. `cause` is the trap. */
export class EngineLostError extends Error {
  constructor(options?: ErrorOptions) {
    super("comb: the engine trapped and is lost for the page; load the page anew", options);
    this.name = "EngineLostError";
  }
}

/** The trap that lost the engine, once it is lost. The engine is instantiated once per page, so
 *  one trap loses it for every Comb on the page. */
let trapped: { cause: unknown } | undefined;
const lostListeners = new Set<(error: EngineLostError) => void>();

/** Whether `error`, thrown from a call of the engine, is a trap: WebAssembly's own, or the glue's
 *  refusal of an object a trapped call left borrowed, which only a trap no guard saw leaves. Errors
 *  the bridge returns as values are plain objects, never traps (ADR-0034). */
function isTrap(error: unknown): boolean {
  return (
    error instanceof WebAssembly.RuntimeError ||
    (error instanceof Error && error.message.startsWith("recursive use of an object detected"))
  );
}

/** Throws an `EngineLostError` once the engine is lost. */
export function refuseIfLost(): void {
  if (trapped) throw new EngineLostError(trapped);
}

/** Marks the engine lost by the trap `cause`, tells the listeners once, and returns the error. */
function lose(cause: unknown): EngineLostError {
  if (!trapped) {
    trapped = { cause };
    // The glue frees a collected `Engine` through the instance, which is no longer safe to call.
    kept.push(...engines.flatMap((engine) => engine.deref() ?? []));
    const error = new EngineLostError(trapped);
    const listeners = [...lostListeners];
    lostListeners.clear();
    listeners.forEach((listener) => tell(listener, error));
  }
  return new EngineLostError(trapped);
}

/** Calls `listener` with `error`; what it throws is reported on its own, so that every listener
 *  is told and the call that trapped still throws the `EngineLostError`. */
function tell(listener: (error: EngineLostError) => void, error: EngineLostError): void {
  try {
    listener(error);
  } catch (thrown) {
    queueMicrotask(() => {
      throw thrown;
    });
  }
}

/** Every `Engine` the bridges created, held weakly until the engine is lost, and from then on
 *  strongly, so that none is freed through the trapped instance. */
const engines: WeakRef<Engine>[] = [];
const kept: Engine[] = [];

/** A new `Engine`, refused once the engine is lost, and marking it lost on a trap. */
function newEngine(): Engine {
  refuseIfLost();
  try {
    const engine = new Engine();
    engines.push(new WeakRef(engine));
    return engine;
  } catch (error) {
    throw isTrap(error) ? lose(error) : error;
  }
}

/** Calls `listener` once, with the `EngineLostError`, when the engine is lost, or at once where it
 *  is lost already; returns the function that removes it. */
export function onEngineLost(listener: (error: EngineLostError) => void): () => void {
  if (trapped) {
    tell(listener, new EngineLostError(trapped));
    return () => {};
  }
  // A registration of its own, so that one listener registered twice is told twice.
  const registration = (error: EngineLostError) => listener(error);
  lostListeners.add(registration);
  return () => lostListeners.delete(registration);
}

/** `bridge` refusing every call once the engine is lost, and marking it lost on a trap. */
function guarded(bridge: Bridge): Bridge {
  return each(bridge, (call) => (...args) => {
    refuseIfLost();
    try {
      return call(...args);
    } catch (error) {
      throw isTrap(error) ? lose(error) : error;
    }
  });
}

/** The engine's export that arms its trap, in test mode, where the engine carries it. */
let trapExport: (() => void) | undefined;

/** Test mode only: the next call of an `Engine` on the page traps (ADR-0021). The engine the
 *  tests run is built with the feature `test-mode` of the bridge crate, which exports the trap;
 *  the production engine carries none of it. */
export function trapNextCall(): void {
  if (!TEST_MODE) throw new Error("comb: the engine traps on demand in test mode only");
  if (!trapExport) {
    throw new Error("comb: the engine carries no trap in test mode; run `bun run build:engine`");
  }
  trapExport();
}

function wrap(exports: InitOutput): Bridge {
  const { memory } = exports;
  if (TEST_MODE) {
    const trap = (exports as unknown as Record<string, unknown>)[TRAP_EXPORT];
    trapExport = typeof trap === "function" ? (trap as () => void) : undefined;
  }
  const bridge = engineBridge(memory);
  return guarded(TEST_MODE ? detaching(bridge, memory) : bridge);
}

/** Hands `engine` the load of `snapshot`, a parameter per column. */
function load(engine: Engine, { nodes, edges }: GraphSnapshot): number {
  const { ids, idBounds, x, y, width, content: c, refused } = nodes;
  const columns = [
    ids,
    idBounds,
    x,
    y,
    width,
    c.rowBounds,
    c.elementBounds,
    c.kinds,
    c.weights,
    c.roles,
    c.directions,
    c.colors,
    c.segmentBounds,
    c.fractions,
    c.segmentColors,
    c.texts,
    c.textBounds,
    c.textValid,
    c.names,
    c.nameBounds,
    c.nameValid,
  ] as const;
  const e = edges;
  const edgeColumnValues = [
    e.ids,
    e.idBounds,
    e.sources,
    e.sourceBounds,
    e.targets,
    e.targetBounds,
    e.hasLabel,
    e.labels,
    e.labelBounds,
    e.labelTexts,
    e.labelT,
    e.labelOffset,
    e.hasBackground,
    e.background,
    e.color,
    e.hasDash,
    e.dash,
    e.gap,
    e.arrow,
    e.sourceSide,
    e.targetSide,
  ] as const;
  return engine.loadGraph(
    ...columns,
    refused?.index,
    refused?.field,
    refused?.row,
    refused?.column,
    ...edgeColumnValues,
    e.refused?.index,
    e.refused?.field,
  );
}

/** The results of a query of `engine` for `rect` at `level`, as `Bridge.query` returns them, read
 *  through fresh views on `memory`. */
function queried(
  engine: Engine,
  memory: WebAssembly.Memory,
  rect: Rect,
  level: Level,
  pixel: number,
  labelReach: number,
): Visible {
  const u32 = (ptr: number, len: number) => new Uint32Array(memory.buffer, ptr, len);
  const f32 = (ptr: number, len: number) => new Float32Array(memory.buffer, ptr, len);
  const u8 = (ptr: number, len: number) => new Uint8Array(memory.buffer, ptr, len);
  const detail = DETAILS[engine.query(rect, LEVELS[level], pixel, labelReach)];
  // Read before the views: each is a call into the engine.
  const origin = { x: engine.originX(), y: engine.originY() };
  const badgePadding = { x: badgePaddingX(), y: badgePaddingY() };
  // The texts only where the query placed any, which it does at the near and middle level.
  const texts = engine.contentTextBoundsLen() > 1 ? engine.contentTexts() : "";
  return {
    positions: f32(engine.positionsPtr(), engine.positionsLen()),
    sizes: f32(engine.sizesPtr(), engine.sizesLen()),
    nodes: u32(engine.visibleNodesPtr(), engine.visibleNodesLen()),
    content: {
      bounds: u32(engine.contentBoundsPtr(), engine.contentBoundsLen()),
      rects: f32(engine.contentRectsPtr(), engine.contentRectsLen()),
      kinds: u8(engine.contentKindsPtr(), engine.contentKindsLen()),
      roles: u8(engine.contentRolesPtr(), engine.contentRolesLen()),
      colors: u32(engine.contentColorsPtr(), engine.contentColorsLen()),
      texts,
      textBounds: u32(engine.contentTextBoundsPtr(), engine.contentTextBoundsLen()),
      barBounds: u32(engine.contentBarBoundsPtr(), engine.contentBarBoundsLen()),
      bars: f32(engine.contentBarsPtr(), engine.contentBarsLen()),
      barColors: u32(engine.contentBarColorsPtr(), engine.contentBarColorsLen()),
      partBounds: u32(engine.contentPartBoundsPtr(), engine.contentPartBoundsLen()),
      parts: f32(engine.contentPartsPtr(), engine.contentPartsLen()),
      partEnds: u32(engine.contentPartEndsPtr(), engine.contentPartEndsLen()),
      arrowBounds: u32(engine.contentArrowBoundsPtr(), engine.contentArrowBoundsLen()),
      arrows: f32(engine.contentArrowsPtr(), engine.contentArrowsLen()),
      badgePadding,
    },
    labels: u32(engine.visibleLabelsPtr(), engine.visibleLabelsLen()),
    labelPoints: f32(engine.labelPointsPtr(), engine.labelPointsLen()),
    mesh: {
      positions: f32(engine.meshPositionsPtr(), engine.meshPositionsLen()),
      distances: f32(engine.meshDistancesPtr(), engine.meshDistancesLen()),
      colors: u32(engine.meshColorsPtr(), engine.meshColorsLen()),
      dashes: f32(engine.meshDashesPtr(), engine.meshDashesLen()),
      indices: u32(engine.meshIndicesPtr(), engine.meshIndicesLen()),
    },
    detail,
    origin,
  };
}

function engineBridge(memory: WebAssembly.Memory): Bridge {
  const engine = newEngine();
  const u32 = (ptr: number, len: number) => new Uint32Array(memory.buffer, ptr, len);
  const f32 = (ptr: number, len: number) => new Float32Array(memory.buffer, ptr, len);
  return {
    loadGraph: (snapshot) => load(engine, snapshot),
    addNode: (node) => engine.addNode(node),
    heightOf: (node) => engine.heightOf(node),
    updateNode: (slot, id, patch) => engine.updateNode(slot, id, patch),
    content: (slot) => engine.content(slot),
    setFont: (role, { codes, advances, fallback, lineHeight }) =>
      engine.setFont(ROLES[role], codes, advances, fallback, lineHeight),
    addEdge: (edge, source, target) => engine.addEdge(edge, source, target),
    updateEdge: (slot, id, patch) => engine.updateEdge(slot, id, patch),
    textLimit,
    rowLimit,
    segmentLimit,
    columnLimit,
    idLimit,
    idBudget,
    checkIdBudget,
    contentBudget,
    checkContentBudget,
    checkGraphSize,
    removeNodes: (slots) => engine.removeNodes(slots),
    removeEdges: (slots) => engine.removeEdges(slots),
    edgesAt: (slots) => engine.edgesAt(slots),
    setLabelSize: (slot, halfWidth, halfHeight) => engine.setLabelSize(slot, halfWidth, halfHeight),
    labelPoint(slot) {
      const [x, y] = engine.labelPoint(slot);
      return x === undefined || y === undefined ? undefined : { x, y };
    },
    moveLabel(slot, x, y) {
      const [t, offset] = engine.moveLabel(slot, x, y);
      return { t: t!, offset: offset! };
    },
    translate: (slots, dx, dy) => engine.translate(slots, dx, dy),
    positions: () => f32(engine.positionsPtr(), engine.positionsLen()),
    nodeBuffers: () => ({
      positions: f32(engine.positionsPtr(), engine.positionsLen()),
      sizes: f32(engine.sizesPtr(), engine.sizesLen()),
    }),
    hit: (x, y, pixel, level, connectors) => engine.hit(x, y, pixel, LEVELS[level], connectors),
    drawnEdges() {
      engine.drawnEdges();
      return {
        slots: u32(engine.visibleEdgesPtr(), engine.visibleEdgesLen()),
        ends: f32(engine.edgeEndsPtr(), engine.edgeEndsLen()),
      };
    },
    query: (rect, level, pixel, labelReach) =>
      queried(engine, memory, rect, level, pixel, labelReach),
  };
}

/** The top-left corner of the node in `slot`, read from the engine's buffer of positions,
 *  `bridge.positions()`. The render layer reads the buffer by index itself, as it draws every
 *  node of a frame, and makes no object per node. */
export function positionAt(positions: Float32Array, slot: number): { x: number; y: number } {
  return { x: positions[slot * 2]!, y: positions[slot * 2 + 1]! };
}

/** Loads the engine from what the host application handed over: a `Response`, which is compiled
 *  while it streams, a compiled module, or the bytes (ADR-0019). Never a string, `URL`, or
 *  `Request`, which the initialiser would fetch itself; the API refuses those before it gets here,
 *  and the type here keeps them out. */
export async function createBridge(
  engine: Response | WebAssembly.Module | BufferSource,
): Promise<Bridge> {
  refuseIfLost();
  return wrap(await init({ module_or_path: engine }));
}

/** Loads the engine from its bytes, for tests outside a browser. */
export function createBridgeSync(module: BufferSource): Bridge {
  refuseIfLost();
  return wrap(initSync({ module }));
}
