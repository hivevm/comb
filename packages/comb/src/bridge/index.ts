// The one module that imports the WebAssembly package (ADR-0028). Structured data crosses as
// generated types through serde-wasm-bindgen, but for a load's nodes and edges, which cross as
// columns of one string or one typed array each; node positions and the results of a viewport
// query are read through views on the engine's buffers, created anew on every read because
// growing memory detaches older views (ADR-0033).
import init, {
  ArrowCode,
  checkGraphSize,
  checkIdBudget,
  checkNodePatch,
  DetailLevel,
  EdgeField,
  idBudget,
  idLimit,
  textLimit,
  Engine,
  initSync,
  MeshDetail,
  NodeField,
  SideCode,
  type Arrow,
  type InitOutput,
  type CheckedPatch,
  type EdgeInput,
  type EdgePatch,
  type Hit,
  type GraphDataProblem,
  type NodeInput,
  type NodePatch,
  type NumberError,
  type Side,
  type SlotError,
} from "../../wasm/engine.js";

export type {
  CheckedPatch,
  EdgeField,
  GraphDataProblem,
  NodeField,
  Hit,
  NodeInput,
  NodePatch,
  NumberError,
  SlotError,
};

/** The refusal of `translate`'s delta, under the name it had before `NumberError` held it. */
export type TranslateError = NumberError;

/** The mark of plain data `api/snapshot.ts` read once from the host application's value
 *  (ADR-0028). It is exported nowhere, so that handing the bridge a value of the host
 *  application, which may hold a getter or a Proxy, takes a cast a reviewer sees. */
declare const read: unique symbol;

/** The nodes of a load as the engine's `loadGraph` takes them (ADR-0033), each column in slot
 *  order: the identifiers and the titles each as one string, the values concatenated, with their
 *  boundaries in UTF-16 code units, one more than there are nodes, a refused value empty; per
 *  title whether it is a text, 1 or 0; the numbers as the host application handed them; and the
 *  first value the engine's first pass refuses by its type, the index of its node and its field,
 *  `item` for a node that is no object. */
export interface NodeColumns {
  readonly ids: string;
  readonly idBounds: Uint32Array;
  readonly titles: string;
  readonly titleBounds: Uint32Array;
  readonly titleTexts: Uint8Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly width: Float64Array;
  readonly height: Float64Array;
  readonly refused: { readonly index: number; readonly field: NodeField } | undefined;
}

/** What writes the columns of a load's nodes, one node after another in slot order. */
export interface NodeColumnWriter {
  /** The next node, from the primitives `api/snapshot.ts` read of it: an identifier or a title
   *  that is a string is one, a number that is a number is one, and any other value is refused by
   *  its type, the first of them named, a title at its rule. */
  node(id: unknown, title: unknown, x: unknown, y: unknown, width: unknown, height: unknown): void;
  /** The next node, which is no object, refused as malformed unless a value before it was. */
  noObject(): void;
  /** The columns of the nodes written so far. */
  columns(): NodeColumns;
}

/** A column of at most `count` strings: the values concatenated, and their boundaries in UTF-16
 *  code units, one more than there are values. */
function stringColumn(count: number) {
  const values: string[] = [];
  const bounds = new Uint32Array(count + 1);
  let units = 0;
  return {
    /** Ends the value at `at` with `value` where it is a string, else empty; returns whether it
     *  is one. */
    add(at: number, value: unknown): boolean {
      const text = typeof value === "string";
      if (text) {
        values.push(value);
        units += value.length;
      }
      bounds[at + 1] = units;
      return text;
    },
    joined: () => values.join(""),
    bounds: (written: number) => bounds.subarray(0, written + 1),
  };
}

/** A writer of the columns of at most `count` nodes. It looks at a value by `typeof` and at a
 *  string's length only, so that no value it is handed runs code. */
export function nodeColumns(count: number): NodeColumnWriter {
  const ids = stringColumn(count);
  const titles = stringColumn(count);
  const titleTexts = new Uint8Array(count);
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const width = new Float64Array(count);
  const height = new Float64Array(count);
  let at = 0;
  let refused: NodeColumns["refused"];
  const refuse = (field: NodeField) => {
    refused ??= { index: at, field };
  };
  const number = (column: Float64Array, value: unknown, field: NodeField) => {
    if (typeof value === "number") column[at] = value;
    else refuse(field);
  };
  return {
    node(id, title, xOf, yOf, widthOf, heightOf) {
      if (!ids.add(at, id)) refuse(NodeField.Id);
      number(x, xOf, NodeField.X);
      number(y, yOf, NodeField.Y);
      number(width, widthOf, NodeField.Width);
      number(height, heightOf, NodeField.Height);
      titleTexts[at] = Number(titles.add(at, title));
      at++;
    },
    noObject() {
      refuse(NodeField.Item);
      ids.add(at, undefined);
      titles.add(at, undefined);
      at++;
    },
    columns: () => ({
      ids: ids.joined(),
      idBounds: ids.bounds(at),
      titles: titles.joined(),
      titleBounds: titles.bounds(at),
      titleTexts: titleTexts.subarray(0, at),
      x: x.subarray(0, at),
      y: y.subarray(0, at),
      width: width.subarray(0, at),
      height: height.subarray(0, at),
      refused,
    }),
  };
}

/** The edges of a load as the engine's `loadGraph` takes them (ADR-0033), each column in slot
 *  order: the identifiers, sources, targets, and label texts each as one string, the values
 *  concatenated, with their boundaries in UTF-16 code units, one more than there are edges, a
 *  refused or absent value empty; per label text whether it is a text, 1 or 0; whether a label,
 *  its background, and a dash are present, 1 or 0; the numbers as the host application handed
 *  them, a background of another type NaN; the arrowhead and the sides as codes, one for a string
 *  that names none; and the first value the engine's first pass refuses by its type, the index of
 *  its edge and its field, `item` for an edge that is no object. */
export interface EdgeColumns {
  readonly ids: string;
  readonly idBounds: Uint32Array;
  readonly sources: string;
  readonly sourceBounds: Uint32Array;
  readonly targets: string;
  readonly targetBounds: Uint32Array;
  readonly hasLabel: Uint8Array;
  readonly labels: string;
  readonly labelBounds: Uint32Array;
  readonly labelTexts: Uint8Array;
  readonly labelT: Float64Array;
  readonly labelOffset: Float64Array;
  readonly hasBackground: Uint8Array;
  readonly background: Float64Array;
  readonly color: Float64Array;
  readonly hasDash: Uint8Array;
  readonly dash: Float64Array;
  readonly gap: Float64Array;
  readonly arrow: Uint8Array;
  readonly sourceSide: Uint8Array;
  readonly targetSide: Uint8Array;
  readonly refused: { readonly index: number; readonly field: EdgeField } | undefined;
}

/** What writes the columns of a load's edges, one edge after another in slot order. */
export interface EdgeColumnWriter {
  /** The next edge, from the plain data `api/snapshot.ts` read of it: an identifier, a source, or
   *  a target that is a string is one, a number that is a number is one, a label that is an
   *  object and a dash that is a list of two are read for their fields, null or undefined is an
   *  absent label, dash, or background, and an arrowhead or a side that is a string crosses as its
   *  code; any other value is refused by its type, the first of them named, a label text and a
   *  background at their rule. */
  edge(
    id: unknown,
    source: unknown,
    target: unknown,
    label: unknown,
    color: unknown,
    dash: unknown,
    arrow: unknown,
    sourceSide: unknown,
    targetSide: unknown,
  ): void;
  /** The next edge, which is no object, refused as malformed unless a value before it was. */
  noObject(): void;
  /** The columns of the edges written so far. */
  columns(): EdgeColumns;
}

/** The code of each arrowhead and side by its name, typed by the generated names so that one
 *  added in the engine fails here until it has its code. */
const ARROWS: Readonly<Record<Arrow, ArrowCode>> = { end: ArrowCode.End, none: ArrowCode.None };
const SIDES: Readonly<Record<Side, SideCode>> = {
  top: SideCode.Top,
  right: SideCode.Right,
  bottom: SideCode.Bottom,
  left: SideCode.Left,
};

/** The code of `name` in `codes`, `unnamed` for a string that names none of them, or none for a
 *  value that is no string. */
function codeOf<C>(codes: Readonly<Record<string, C>>, name: unknown, unnamed: C): C | undefined {
  if (typeof name !== "string") return undefined;
  return Object.hasOwn(codes, name) ? codes[name] : unnamed;
}

/** Whether `value` stands for a field left out: null or undefined. */
const absent = (value: unknown) => value === undefined || value === null;

/** The columns of at most `count` labels: whether each edge has one, its text, `t`, offset, and
 *  background. */
function labelColumns(count: number) {
  const texts = stringColumn(count);
  const hasLabel = new Uint8Array(count);
  const labelTexts = new Uint8Array(count);
  const labelT = new Float64Array(count);
  const labelOffset = new Float64Array(count);
  const hasBackground = new Uint8Array(count);
  const background = new Float64Array(count);
  return {
    /** Writes the label of the edge at `at`, and returns the first of its fields refused by its
     *  type, or none. */
    add(at: number, label: unknown): EdgeField | undefined {
      if (typeof label !== "object" || label === null) {
        texts.add(at, undefined);
        return absent(label) ? undefined : EdgeField.Label;
      }
      const fields = label as Record<string, unknown>;
      hasLabel[at] = 1;
      labelTexts[at] = Number(texts.add(at, fields.text));
      if (!absent(fields.background)) {
        hasBackground[at] = 1;
        background[at] = typeof fields.background === "number" ? fields.background : Number.NaN;
      }
      const { t, offset } = fields;
      if (typeof t === "number") labelT[at] = t;
      if (typeof offset === "number") labelOffset[at] = offset;
      if (typeof t !== "number") return EdgeField.LabelT;
      return typeof offset === "number" ? undefined : EdgeField.LabelOffset;
    },
    columns: (written: number) => ({
      hasLabel: hasLabel.subarray(0, written),
      labels: texts.joined(),
      labelBounds: texts.bounds(written),
      labelTexts: labelTexts.subarray(0, written),
      labelT: labelT.subarray(0, written),
      labelOffset: labelOffset.subarray(0, written),
      hasBackground: hasBackground.subarray(0, written),
      background: background.subarray(0, written),
    }),
  };
}

/** The columns of at most `count` dash patterns: whether each edge has one, its dash, and its
 *  gap. */
function dashColumns(count: number) {
  const hasDash = new Uint8Array(count);
  const dash = new Float64Array(count);
  const gap = new Float64Array(count);
  return {
    /** Writes the dash pattern of the edge at `at`, and returns whether it is refused by its
     *  type: neither left out nor a list of two numbers. */
    add(at: number, pattern: unknown): boolean {
      if (absent(pattern)) return false;
      const [length, space] = Array.isArray(pattern) && pattern.length === 2 ? pattern : [];
      if (typeof length !== "number" || typeof space !== "number") return true;
      hasDash[at] = 1;
      dash[at] = length;
      gap[at] = space;
      return false;
    },
    columns: (written: number) => ({
      hasDash: hasDash.subarray(0, written),
      dash: dash.subarray(0, written),
      gap: gap.subarray(0, written),
    }),
  };
}

/** A column of at most `count` codes of names in `codes`, `unnamed` for a string that names
 *  none. */
function codeColumn<C extends number>(
  count: number,
  codes: Readonly<Record<string, C>>,
  unnamed: C,
) {
  const column = new Uint8Array(count);
  return {
    /** Writes the code of `name` at `at`, and returns whether it is refused by its type: no
     *  string. */
    add(at: number, name: unknown): boolean {
      const code = codeOf(codes, name, unnamed);
      if (code !== undefined) column[at] = code;
      return code === undefined;
    },
    column: (written: number) => column.subarray(0, written),
  };
}

/** A writer of the columns of at most `count` edges. It looks at a value by `typeof` and at a
 *  string's length, and reads the fields of a label and the items of a dash, which are the
 *  snapshot's own plain data, so that no value of the host application it is handed runs code. */
export function edgeColumns(count: number): EdgeColumnWriter {
  const [ids, sources, targets] = [stringColumn(count), stringColumn(count), stringColumn(count)];
  const labels = labelColumns(count);
  const color = new Float64Array(count);
  const dashes = dashColumns(count);
  const arrows = codeColumn(count, ARROWS, ArrowCode.Unnamed);
  const sourceSides = codeColumn(count, SIDES, SideCode.Unnamed);
  const targetSides = codeColumn(count, SIDES, SideCode.Unnamed);
  let at = 0;
  let refused: EdgeColumns["refused"];
  const refuse = (field: EdgeField | undefined) => {
    if (field !== undefined) refused ??= { index: at, field };
  };
  return {
    edge(id, source, target, label, colorOf, dash, arrow, sourceSide, targetSide) {
      if (!ids.add(at, id)) refuse(EdgeField.Id);
      if (!sources.add(at, source)) refuse(EdgeField.Source);
      if (!targets.add(at, target)) refuse(EdgeField.Target);
      refuse(labels.add(at, label));
      if (typeof colorOf === "number") color[at] = colorOf;
      else refuse(EdgeField.Color);
      if (dashes.add(at, dash)) refuse(EdgeField.Dash);
      if (arrows.add(at, arrow)) refuse(EdgeField.Arrow);
      if (sourceSides.add(at, sourceSide)) refuse(EdgeField.SourceSide);
      if (targetSides.add(at, targetSide)) refuse(EdgeField.TargetSide);
      at++;
    },
    noObject() {
      refuse(EdgeField.Item);
      for (const column of [ids, sources, targets]) column.add(at, undefined);
      labels.add(at, undefined);
      at++;
    },
    columns: () => ({
      ids: ids.joined(),
      idBounds: ids.bounds(at),
      sources: sources.joined(),
      sourceBounds: sources.bounds(at),
      targets: targets.joined(),
      targetBounds: targets.bounds(at),
      ...labels.columns(at),
      color: color.subarray(0, at),
      ...dashes.columns(at),
      arrow: arrows.column(at),
      sourceSide: sourceSides.column(at),
      targetSide: targetSides.column(at),
      refused,
    }),
  };
}

/** The snapshot of a load: what `snapshotOf` hands the bridge, its nodes and its edges as
 *  columns. */
export type GraphSnapshot = { readonly nodes: NodeColumns; readonly edges: EdgeColumns } & {
  readonly [read]: "graph";
};

/** The node of `addNode` read once: what `nodeSnapshotOf` returns, and the node the bridge takes. */
export type NodeSnapshot = NodeInput & { readonly [read]: "node" };

/** The plain patch of `updateNode`: what `patchOf` returns, and the patch the bridge takes. */
export type PlainPatch = NodePatch & { readonly [read]: "patch" };

/** The edge of `addEdge` read once: what `edgeSnapshotOf` returns, and the edge the bridge takes. */
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

/** What a viewport query found: node slots in ascending order, the edge slot and point of each
 *  found edge label, the mesh of the found edges and its detail, and the positions buffer, all
 *  read after the same call. The label points and the mesh's positions are relative to `origin`,
 *  a world point near the query's rectangle, so that `f32` rounds them by their distance from it
 *  (ADR-0033); the positions buffer is not. */
export interface Visible {
  positions: Float32Array;
  nodes: Uint32Array;
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

export interface Bridge {
  /** Replaces the graph; node slot `i` is the batch's node `i`, edge slot `i` its edge `i`.
   *  Throws a `GraphDataProblem`. */
  loadGraph(batch: GraphSnapshot): number;
  /** Checks `node` as a load checks a node and adds it, drawn and hit above every other node, and
   *  returns the slot the engine chose for it (ADR-0022). Throws a `GraphDataProblem`, the graph
   *  as it was. */
  addNode(node: NodeSnapshot): number;
  /** Checks `edge` as a load checks an edge, refuses one from a node to itself, and adds it
   *  between the node slots `source` and `target`, which `api` resolved; returns the slot the
   *  engine chose for it (ADR-0022). Throws a `GraphDataProblem`, and a `SlotError` where a slot
   *  of an end holds no node, the graph as it was. */
  addEdge(edge: EdgeSnapshot, source: number, target: number): number;
  /** Checks the patch of the edge `id` in `slot` as a load checks those fields and gives the edge
   *  its new style and label placement. Throws a `GraphDataProblem`, and a `SlotError` where
   *  `slot` holds no edge, the graph as it was. */
  updateEdge(slot: number, id: string, patch: PlainEdgePatch): void;
  /** The most UTF-16 code units of a title or a label text the bridge accepts. */
  textLimit(): number;
  /** The most UTF-16 code units of an identifier the bridge accepts. */
  idLimit(): number;
  /** The most UTF-16 code units of all identifiers of one load the bridge accepts. */
  idBudget(): number;
  /** Checks how many UTF-16 code units the identifiers of one load hold. Throws a
   *  `GraphDataProblem`. */
  checkIdBudget(units: number): void;
  /** Checks how many nodes and edges a graph holds, before any is copied. Throws a
   *  `GraphDataProblem`. */
  checkGraphSize(nodes: number, edges: number): void;
  /** Checks the patch `updateNode` hands over for the node `node`, reading it once, and returns
   *  the fields it changes; the engine keeps nothing of it. Throws a `GraphDataProblem`. */
  checkNodePatch(node: string, patch: PlainPatch): CheckedPatch;
  /** Removes the nodes in `slots` and every edge at them, and returns the slots of those edges in
   *  ascending order (ADR-0022). Throws a `SlotError`, a mistake of the shell's, never one of
   *  graph data, the graph as it was. */
  removeNodes(slots: Uint32Array): Uint32Array;
  /** Records the half width and half height of the pill of the label of the edge in `slot`, in
   *  world units, as the labels layer draws it; a label not measured is not hit (ADR-0025).
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
  /** The nodes and edges that meet `rect` and the mesh of the edges for `level`, where a screen
   *  pixel is `pixel` world units, within the engine's mesh budget, and the mesh's detail; at the
   *  near level also the edge labels whose point lies within `labelReach` of it. Fresh views; do
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
   *  (ADR-0025). Throws a `NumberError`, `invalidPixel` for a pixel that is not a finite number
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
 *  (ADR-0033). The message of its error carries `DETACHING_MARK`. */
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
 *  refusal of an object a trapped call left borrowed, which only a trap no guard saw leaves. Errors the bridge returns as values are
 *  plain objects, never traps (ADR-0033). */
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
  const { ids, idBounds, titles, titleBounds, titleTexts, x, y, width, height, refused } = nodes;
  const columns = [ids, idBounds, titles, titleBounds, titleTexts, x, y, width, height] as const;
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
    ...edgeColumnValues,
    e.refused?.index,
    e.refused?.field,
  );
}

function engineBridge(memory: WebAssembly.Memory): Bridge {
  const engine = newEngine();
  const u32 = (ptr: number, len: number) => new Uint32Array(memory.buffer, ptr, len);
  const f32 = (ptr: number, len: number) => new Float32Array(memory.buffer, ptr, len);
  return {
    loadGraph: (snapshot) => load(engine, snapshot),
    addNode: (node) => engine.addNode(node),
    addEdge: (edge, source, target) => engine.addEdge(edge, source, target),
    updateEdge: (slot, id, patch) => engine.updateEdge(slot, id, patch),
    textLimit,
    idLimit,
    idBudget,
    checkIdBudget,
    checkGraphSize,
    checkNodePatch,
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
    hit: (x, y, pixel, level, connectors) => engine.hit(x, y, pixel, LEVELS[level], connectors),
    drawnEdges() {
      engine.drawnEdges();
      return {
        slots: u32(engine.visibleEdgesPtr(), engine.visibleEdgesLen()),
        ends: f32(engine.edgeEndsPtr(), engine.edgeEndsLen()),
      };
    },
    query(rect, level, pixel, labelReach) {
      const detail = DETAILS[engine.query(rect, LEVELS[level], pixel, labelReach)];
      // Read before the views: each is a call into the engine.
      const origin = { x: engine.originX(), y: engine.originY() };
      return {
        positions: f32(engine.positionsPtr(), engine.positionsLen()),
        nodes: u32(engine.visibleNodesPtr(), engine.visibleNodesLen()),
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
    },
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
