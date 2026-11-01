// The snapshot of the host application's graph data (ADR-0028): every value read once, in
// JavaScript, into plain data whose every field is a primitive of the type the field expects, so
// that the bridge checks it and the store keeps it, and no value of the host application, nor any
// of its code, reaches the engine; a load's nodes and edges are handed over as columns besides
// (ADR-0034). A value of another type is replaced by `false`, which the bridge refuses naming the
// node or edge and the field; a text of content, a label text, and the arrow are handed over no
// longer than one code unit beyond the bridge's limit for texts, an identifier no longer than one
// beyond its limit for identifiers, and a node's content no more rows, nor a row more columns, nor
// a progress bar more segments, than one beyond the bridge's limits, so that a value of any size
// costs at most that much to check. The code units of all identifiers are counted while they are
// read, and reading stops once they exceed the bridge's budget, whose check then refuses the load.
// What cannot be read at all throws an `UnreadableError`.
import {
  edgeColumns,
  nodeColumns,
  PIECE_BOUND,
  type NodeColumnWriter,
  type EdgeSnapshot,
  type GraphSnapshot,
  type NodeSnapshot,
  type PlainEdgePatch,
  type PlainPatch,
} from "../bridge";
import { EDGE_ARROW, edgeColor } from "../render/edges";
import type { GraphData, KeptGraph } from "../store";

/** The errors this module throws, told from what the host application throws without reading
 *  the thrown value, which may run its code. */
const own = new WeakSet<object>();

/** Graph data that cannot be read into a snapshot: a list that is no array or has a hole, or a
 *  patch that is no plain object. */
export class UnreadableError extends Error {
  constructor(message: string) {
    super(`comb: ${message}`);
    this.name = "UnreadableError";
    own.add(this);
  }
}

/** Whether `error` is an `UnreadableError` of this module, told without reading it. */
export function isUnreadable(error: unknown): error is UnreadableError {
  return (typeof error === "object" || typeof error === "function") && error !== null
    ? own.has(error)
    : false;
}

type Fields = Record<PropertyKey, unknown>;

/** The bridge's limits the snapshot cuts by: the most code units of a text and of an
 *  identifier, and of all identifiers of one load together, and the most rows of a node's
 *  content, columns of a row, and segments of a progress bar. */
export interface Limits {
  text: number;
  id: number;
  idBudget: number;
  contentBudget: number;
  rows: number;
  columns: number;
  segments: number;
}

/** What a field expects: a number, a text, an identifier, or a node's content, each of its type
 *  or absent. */
interface Reader {
  number(value: unknown): unknown;
  text(value: unknown): unknown;
  id(value: unknown): unknown;
  content(value: unknown): unknown;
  /** The most code units of a text. */
  textLimit: number;
  /** The code units of the identifiers read so far. */
  idUnits: number;
  /** The code units of the texts of content of a load read so far, and the identifier of the
   *  node whose text passed the content budget, once one has. */
  contentUnits: number;
  contentPast: string | undefined;
}

/** A UTF-16 code unit of a surrogate pair without its other half. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A string no longer than one code unit beyond `limit`, or `false` for one within it that holds
 *  a lone surrogate, which the bridge would read as U+FFFD and so check another string than the
 *  store keeps. A string cut is refused for its length whatever its last code unit. */
function cut(value: string, limit: number): string | false {
  if (value.length > limit) return value.slice(0, limit + 1);
  return LONE_SURROGATE.test(value) ? false : value;
}

/** The readers by `limits`: each hands over a value of its type, null or undefined as they are,
 *  and `false` for any other value, decided by `typeof` alone. */
function readerOf(limits: Limits): Reader {
  const absent = (value: unknown) => value === undefined || value === null;
  const reader: Reader = {
    number: (value) => (typeof value === "number" || absent(value) ? value : false),
    text: (value) =>
      typeof value === "string" ? cut(value, limits.text) : absent(value) ? value : false,
    id: (value) => {
      if (typeof value !== "string") return absent(value) ? value : false;
      const id = cut(value, limits.id);
      if (id !== false) reader.idUnits += id.length;
      return id;
    },
    content: (value) => plainContentOf(reader, value, limits),
    textLimit: limits.text,
    idUnits: 0,
    contentUnits: 0,
    contentPast: undefined,
  };
  return reader;
}

/** `value` where it stands for a field left out, null or undefined, else `false`. */
const falseOr = (value: unknown) => (value === undefined || value === null ? value : false);

/** A metric's trend as `walkContent` reads it: its text read as a text is, its direction and its
 *  colour as given and as a number; or `false` where it is no object, a list among them. */
interface Trend {
  text: unknown;
  direction: unknown;
  color: unknown;
}

/** What `walkContent` hands what it read of a node's content, each value read once, in the order
 *  of the columns: an element's kind, role, weight, and a trend's direction as given, which each
 *  sink names or codes by its own rule, its texts, an action's identifier, and an icon's name as
 *  `Reader.text` reads them, and a badge's colour and a segment's numbers as `Reader.number` does.
 *  A row's last element ends it; a progress bar's segments follow it before `endRow` ends its
 *  row where it is the last. */
interface ContentSink {
  /** The content is no list: `value` as it was given. */
  noContent(value: unknown): void;
  /** The row is no list. */
  noRow(): void;
  /** Ends a row of no elements, or one whose last element was handed over without ending it. */
  endRow(): void;
  /** The next element is no object, a list among them. */
  noElement(endsRow: boolean): void;
  /** The next element, of any kind but a metric: a progress bar's role, colour, text, and `id`
   *  none, an icon's name as `id`, an action's identifier as `id`, a badge's colour. */
  element(
    kind: unknown,
    role: unknown,
    weight: unknown,
    color: unknown,
    text: unknown,
    id: unknown,
    endsRow: boolean,
  ): void;
  /** The next element, a metric. */
  metric(
    weight: unknown,
    caption: unknown,
    value: unknown,
    trend: Trend | false,
    endsRow: boolean,
  ): void;
  /** The next segment of the progress bar handed over last. */
  segment(fraction: unknown, color: unknown): void;
  /** The progress bar handed over last has segments that are no list. */
  noSegments(): void;
  /** The next segment of the progress bar handed over last is no object. */
  noSegment(): void;
}

/** Reads `content`, a node's content, once by `read` and hands it to `sink`: at most one row
 *  beyond `limits.rows`, each at most one element beyond `limits.columns`, and a progress bar at
 *  most one segment beyond `limits.segments`, so that content of any size costs at most that much
 *  to check. The one walk of content both crossings of ADR-0034 read it by: a load hands the
 *  sink that writes its columns, `addNode` and `updateNode` the one that builds plain data. */
function walkContent(read: Reader, content: unknown, sink: ContentSink, limits: Limits): void {
  if (!Array.isArray(content)) {
    sink.noContent(content);
    return;
  }
  const rows = Math.min(content.length, limits.rows + 1);
  for (let r = 0; r < rows; r++) {
    const row: unknown = content[r];
    if (!Array.isArray(row)) sink.noRow();
    else walkRow(read, row, sink, limits);
  }
}

/** Hands the elements of `row`, a list, to `sink`, read once by `read`, at most one beyond
 *  `limits.columns`, the last of them ending the row. */
function walkRow(read: Reader, row: unknown[], sink: ContentSink, limits: Limits): void {
  const count = Math.min(row.length, limits.columns + 1);
  if (count === 0) sink.endRow();
  for (let c = 0; c < count; c++) {
    const value: unknown = row[c];
    const last = c === count - 1;
    if (typeof value !== "object" || value === null || Array.isArray(value)) sink.noElement(last);
    else walkElement(read, value as Fields, sink, limits, last);
  }
}

/** Hands `element`, an object, to `sink`, read once by `read`, ending the row where `last`: a
 *  progress bar shows no text and has no role, and its segments follow it; a metric its caption,
 *  value, and trend; an icon shows no text and has no role, its name read as a text is; any other
 *  kind its role and text, an action's identifier read as a text is, a badge's colour as a number
 *  is, each read of no other kind. */
function walkElement(
  read: Reader,
  element: Fields,
  sink: ContentSink,
  limits: Limits,
  last: boolean,
): void {
  const kind = element.kind;
  if (kind === "progress") {
    const { weight, segments } = element;
    sink.element(kind, undefined, weight, undefined, undefined, undefined, false);
    walkSegments(read, segments, sink, limits);
    if (last) sink.endRow();
    return;
  }
  if (kind === "metric") {
    const { weight, caption, value, trend } = element;
    const [shown, valued] = [read.text(caption), read.text(value)];
    sink.metric(weight, shown, valued, trendOf(read, trend), last);
    return;
  }
  if (kind === "icon") {
    const name = read.text(element.name);
    sink.element(kind, undefined, element.weight, undefined, undefined, name, last);
    return;
  }
  const { role, weight, text } = element;
  const shown = read.text(text);
  const id = kind === "action" ? read.text(element.id) : undefined;
  const color = kind === "badge" ? read.number(element.color) : undefined;
  sink.element(kind, role, weight, color, shown, id, last);
}

/** A metric's trend, read once by `read` where it is an object, and `false` where it is not. */
function trendOf(read: Reader, value: unknown): Trend | false {
  const fields = segmentFieldsOf(value);
  if (!fields) return false;
  const { text, direction, color } = fields;
  return { text: read.text(text), direction, color: read.number(color) };
}

/** Hands a progress bar's `segments` to `sink`, their items and fields read once by `read`, at most
 *  one beyond `limits.segments`. */
function walkSegments(read: Reader, segments: unknown, sink: ContentSink, limits: Limits): void {
  if (!Array.isArray(segments)) {
    sink.noSegments();
    return;
  }
  const count = Math.min(segments.length, limits.segments + 1);
  for (let s = 0; s < count; s++) {
    const fields = segmentFieldsOf(segments[s]);
    if (fields) sink.segment(read.number(fields.fraction), read.number(fields.color));
    else sink.noSegment();
  }
}

/** A name of an element's kind or a text's role, which the bridge reads as a code: a string as
 *  `read` reads a text but not searched for a lone surrogate, since a name with one names no
 *  kind or role and is refused as such. */
function nameOf(value: unknown, read: Reader): unknown {
  if (typeof value !== "string") return read.text(value);
  return value.length > read.textLimit ? value.slice(0, read.textLimit + 1) : value;
}

/** A node's content as plain data for serde, walked once by `read`: its rows, each a list of its
 *  elements or `false` where it is no list, each element an object of its kind and the fields of
 *  its kind, a name of a kind, a role, or a direction as `nameOf` hands it over, a weight only
 *  where one is given, or `false` where it is no object; or the content as given where it is null
 *  or undefined, and `false` where it is any other value but a list. */
function plainContentOf(read: Reader, content: unknown, limits: Limits): unknown {
  const rows: unknown[] = [];
  let row: unknown[] | undefined;
  let result: unknown = rows;
  const end = (last: boolean) => {
    if (!last) return;
    rows.push(row ?? []);
    row = undefined;
  };
  const add = (element: unknown, last: boolean) => {
    (row ??= []).push(element);
    end(last);
  };
  const weighted = (element: Record<string, unknown>, weight: unknown) => {
    // No key for a weight left out, which the bridge reads as 1, so that Comb keeps none either.
    if (weight !== undefined && weight !== null) element.weight = read.number(weight);
    return element;
  };
  const latest = () => row![row!.length - 1] as Record<string, unknown>;
  walkContent(
    read,
    content,
    {
      noContent: (value) => (result = falseOr(value)),
      noRow: () => rows.push(false),
      endRow: () => end(true),
      noElement: (last) => add(false, last),
      element(kind, role, weight, color, text, id, last) {
        const element: Record<string, unknown> = { kind: nameOf(kind, read) };
        if (kind === "progress") element.segments = [];
        else if (kind === "icon") element.name = id;
        else {
          element.role = nameOf(role, read);
          element.text = text;
        }
        if (kind === "action") element.id = id;
        if (kind === "badge") element.color = color;
        add(weighted(element, weight), last);
      },
      metric(weight, caption, value, trend, last) {
        const named = trend && { ...trend, direction: nameOf(trend.direction, read) };
        add(weighted({ kind: "metric", caption, value, trend: named }, weight), last);
      },
      segment: (fraction, color) => (latest().segments as unknown[]).push({ fraction, color }),
      noSegments: () => (latest().segments = false),
      noSegment: () => (latest().segments as unknown[]).push(false),
    },
    limits,
  );
  return result;
}

/** A segment's or a trend's fields to read, or `false` where it is no object: a list is none, as
 *  an element is none. */
function segmentFieldsOf(value: unknown): Fields | false {
  const fields = objectOf(value);
  return fields && !Array.isArray(value) ? fields : false;
}

/** `value` as an object to read fields of, or none where it is no object. */
function objectOf(value: unknown): Fields | undefined {
  return typeof value === "object" && value !== null ? (value as Fields) : undefined;
}

/** The node and edge lists of `graph` and their lengths, each read once, before any of their
 *  items are: the lengths go to the bridge first, so that a list too long is never copied. */
export interface Lists {
  nodes: readonly unknown[];
  edges: readonly unknown[];
  nodeCount: number;
  edgeCount: number;
}

function listOf(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new UnreadableError(`${name} is not a list`);
  return value;
}

export function listsOf(graph: GraphData): Lists {
  const fields = objectOf(graph);
  if (!fields) throw new UnreadableError("graph data is not an object");
  const nodes = listOf(fields.nodes, "nodes");
  const edges = listOf(fields.edges, "edges");
  const count = (list: readonly unknown[]) => {
    const length = list.length;
    return typeof length === "number" ? length : Number.NaN;
  };
  return { nodes, edges, nodeCount: count(nodes), edgeCount: count(edges) };
}

/** The first `count` items of `list`, each copied by `copy`, `false` for one that is no object,
 *  by index; never through a method of the list, and refused at the first hole. */
function copied<T>(
  list: readonly unknown[],
  count: number,
  name: string,
  copy: (item: Fields | undefined) => T | false,
  done: () => boolean,
) {
  const items: (T | false)[] = [];
  for (let i = 0; i < count && !done(); i++) {
    if (!(i in list)) throw new UnreadableError(`${name} has no item ${i}`);
    items.push(copy(objectOf(list[i])));
  }
  return items;
}

function nodeOf(read: Reader, node: Fields) {
  const { id, x, y, width, content } = node;
  return {
    id: read.id(id),
    x: read.number(x),
    y: read.number(y),
    width: read.number(width),
    content: read.content(content),
  };
}

/** Writes the node `node` into `columns`, read once by `read`, its content walked straight into
 *  its columns, and returns what the store keeps of it: its identifier and its width, no copy of
 *  its content (ADR-0013). */
function written(read: Reader, node: Fields, columns: NodeColumnWriter, limits: Limits) {
  const { id, x, y, width, content } = node;
  const kept = { id: read.id(id), width: read.number(width) };
  columns.node(kept.id, read.number(x), read.number(y), kept.width);
  walkContent(read, content, columnSink(read, columns, limits, kept.id), limits);
  return kept;
}

/** Counts `units` more code units of the texts of content of a load, of the node `node`, and
 *  names that node where they pass the bridge's budget, after which reading stops. */
function counted(read: Reader, units: number, node: unknown, limits: Limits) {
  read.contentUnits += units;
  if (read.contentUnits > limits.contentBudget && read.contentPast === undefined)
    read.contentPast = typeof node === "string" ? node : "";
}

/** The sink of a load's content: each value handed to `columns`, which takes the kind, the role,
 *  the weight, and a trend's direction by `typeof` and by comparing a string with a name, and each
 *  string of content, a text, an action's identifier, and an icon's name among the names, counted
 *  against the budget for the node `node`. */
function columnSink(
  read: Reader,
  columns: NodeColumnWriter,
  limits: Limits,
  node: unknown,
): ContentSink {
  const count = (...strings: unknown[]) => {
    for (const string of strings)
      if (typeof string === "string") counted(read, string.length, node, limits);
  };
  return {
    noContent: () => columns.noContent(),
    noRow: () => columns.noRow(),
    endRow: () => columns.endRow(),
    noElement: (last) => columns.noElement(last),
    element(kind, role, weight, color, text, id, last) {
      columns.element(kind, role, weight, color, text, id, last);
      count(text, id);
    },
    metric(weight, caption, value, trend, last) {
      const { text, direction, color } = trend || {};
      columns.metric(weight, caption, value, direction, color, text, last);
      count(caption, value, text);
    },
    segment: (fraction, color) => columns.segment(fraction, color),
    noSegments: () => columns.noSegments(),
    noSegment: () => columns.noSegment(),
  };
}

/** A label: absent where null or undefined, `false` where no object. */
function labelOf(read: Reader, label: unknown) {
  if (label === undefined || label === null) return undefined;
  const fields = objectOf(label);
  if (!fields) return false;
  const { text, t, offset, background } = fields;
  const placed = {
    text: read.text(text),
    t: read.number(t),
    offset: read.number(offset),
    background: read.number(background),
  };
  // No key for a background left out, so that the edge as Comb keeps it holds none.
  if (placed.background === undefined) delete (placed as { background?: unknown }).background;
  return placed;
}

/** A dash pattern: absent where null or undefined, `false` where no list of two. */
function dashOf(read: Reader, dash: unknown) {
  if (dash === undefined || dash === null) return undefined;
  if (!Array.isArray(dash) || dash.length !== 2) return false;
  return [read.number(dash[0]), read.number(dash[1])];
}

function edgeOf(read: Reader, edge: Fields) {
  const { id, source, target, label, color, dash, arrow, sourceSide, targetSide } = edge;
  const snapshot: {
    id: unknown;
    source: unknown;
    target: unknown;
    color: number;
    arrow: unknown;
    sourceSide: unknown;
    targetSide: unknown;
    label?: ReturnType<typeof labelOf>;
    dash?: ReturnType<typeof dashOf>;
  } = {
    id: read.id(id),
    source: read.id(source),
    target: read.id(target),
    color: edgeColor({ color: read.number(color) as number | undefined }),
    arrow: read.text(arrow) ?? EDGE_ARROW,
    sourceSide: read.text(sourceSide) ?? "right",
    targetSide: read.text(targetSide) ?? "left",
  };
  // No key for a label or a dash left out: each set where present, since spreading an object of
  // one key per edge costs a large load milliseconds.
  const placed = labelOf(read, label);
  if (placed !== undefined) snapshot.label = placed;
  const pattern = dashOf(read, dash);
  if (pattern !== undefined) snapshot.dash = pattern;
  return snapshot;
}

/** The snapshot of the lists `listsOf` read, with the edge styles' defaults and its strings cut
 *  by `limits`: `kept`, the graph data the store keeps once the bridge has checked it; `snapshot`,
 *  what the bridge checks, the columns of the same nodes and edges, written while each is read;
 *  and the code units of its identifiers, for the bridge to check first. Reading stops, the
 *  snapshot unfinished, once they exceed the budget. */
export function snapshotOf(lists: Lists, limits: Limits) {
  const read = readerOf(limits);
  // Reading stops once the identifiers or the texts of content pass their budget, which the
  // bridge then refuses, so that a load of shared long strings builds no more than that.
  const done = () => read.idUnits > limits.idBudget || read.contentPast !== undefined;
  const columns = nodeColumns(lists.nodeCount, PIECE_BOUND);
  const nodes = copied(
    lists.nodes,
    lists.nodeCount,
    "nodes",
    (item) => {
      if (!item) {
        columns.noObject();
        return false;
      }
      return written(read, item, columns, limits);
    },
    done,
  );
  const edgeWriter = edgeColumns(lists.edgeCount, PIECE_BOUND);
  const edges = copied(
    lists.edges,
    lists.edgeCount,
    "edges",
    (item) => {
      if (!item) {
        edgeWriter.noObject();
        return false;
      }
      const e = edgeOf(read, item);
      const { id, source, target, label, color, dash, arrow, sourceSide, targetSide } = e;
      edgeWriter.edge(id, source, target, label, color, dash, arrow, sourceSide, targetSide);
      return e;
    },
    done,
  );
  const kept = { nodes, edges } as KeptGraph;
  const snapshot = { nodes: columns.columns(), edges: edgeWriter.columns() } as GraphSnapshot;
  const content = { units: read.contentUnits, past: read.contentPast };
  return { kept, snapshot, idUnits: read.idUnits, content };
}

/** The node of `addNode` read once as a load reads one, its identifier cut by `limits`, or `false`
 *  where it is no object, which the bridge refuses as malformed; and the code units of its
 *  identifier, for the bridge to check against what the graph holds already. */
export function nodeSnapshotOf(node: unknown, limits: Limits) {
  const read = readerOf(limits);
  const fields = objectOf(node);
  const snapshot = (fields ? nodeOf(read, fields) : false) as NodeSnapshot;
  return { snapshot, idUnits: read.idUnits };
}

/** The edge of `addEdge` read once into a snapshot, its style's defaults filled, as a load reads
 *  an edge; and the code units of its identifiers. */
export function edgeSnapshotOf(edge: unknown, limits: Limits) {
  const read = readerOf(limits);
  const fields = objectOf(edge);
  const snapshot = (fields ? edgeOf(read, fields) : false) as EdgeSnapshot;
  return { snapshot, idUnits: read.idUnits };
}

/** The fields a patch of `updateEdge` may set, each read as a load reads it; `null` clears a dash
 *  or a label. */
const EDGE_PATCH: Record<string, (read: Reader, value: unknown) => unknown> = {
  color: (read, value) => read.number(value),
  arrow: (read, value) => read.text(value),
  sourceSide: (read, value) => read.text(value),
  targetSide: (read, value) => read.text(value),
  dash: (read, value) => (value === null ? null : dashOf(read, value)),
  label: (read, value) => (value === null ? null : labelOf(read, value)),
};

/** The patch of `updateEdge` as plain data, read as `patchOf` reads one of `updateNode`: the own
 *  fields of a plain object up to the first it does not know, which the bridge refuses by name; a
 *  field whose value is `undefined` is one the patch does not set. */
export function edgePatchOf(patch: unknown, limits: Limits): PlainEdgePatch {
  const fields = objectOf(patch);
  if (!fields || Object.getPrototypeOf(fields) !== Object.prototype)
    throw new UnreadableError("the patch is not a plain object");
  const read = readerOf(limits);
  const plain: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== "string") throw new UnreadableError("the patch has a key that is no string");
    const field = Object.hasOwn(EDGE_PATCH, key) ? EDGE_PATCH[key] : undefined;
    if (!field) {
      plain[key.slice(0, limits.text + 1)] = false;
      break;
    }
    const value = fields[key];
    if (value !== undefined) plain[key] = field(read, value);
  }
  return plain as PlainEdgePatch;
}

/** The patch of `updateNode` as plain data: the own fields of a plain object, enumerable or not,
 *  up to the first other than `content`, its content read as a load reads a node's, and the name
 *  of that other field no longer than one code unit beyond the limit for texts. A patch that is
 *  no plain object, a `Map` or an array among them, or that has a key that is no string, cannot
 *  be read. */
export function patchOf(patch: unknown, limits: Limits): PlainPatch {
  const fields = objectOf(patch);
  if (!fields || Object.getPrototypeOf(fields) !== Object.prototype)
    throw new UnreadableError("the patch is not a plain object");
  const read = readerOf(limits);
  const plain: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== "string") throw new UnreadableError("the patch has a key that is no string");
    if (key !== "content") {
      // The first other field, which the bridge refuses by name: its name cut like a text but
      // otherwise as written, a lone surrogate too, which the bridge names as U+FFFD; its value
      // not read, and no field after it.
      plain[key.slice(0, limits.text + 1)] = false;
      break;
    }
    plain[key] = read.content(fields[key]);
  }
  return plain as PlainPatch;
}

/** The list of identifiers `removeNodes` or `removeEdges` names, and its length, read once: a
 *  list that is no array, or whose length is no number, is unreadable. The length goes to the
 *  bridge first, so that a list too long is never read. */
export function idListOf(ids: unknown, name: string): { list: readonly unknown[]; count: number } {
  const list = listOf(ids, name);
  const count = list.length;
  if (typeof count !== "number") throw new UnreadableError(`${name} has no length`);
  return { list, count };
}

/** The first `count` identifiers of `list`, read once by index into strings no longer than one
 *  code unit beyond the bridge's limit, which no identifier the graph holds is: a hole, or an
 *  item that is no string, is unreadable. */
export function idsOf(list: readonly unknown[], count: number, name: string, limits: Limits) {
  const read: string[] = [];
  for (let i = 0; i < count; i++) {
    if (!(i in list)) throw new UnreadableError(`${name} has no item ${i}`);
    const id = list[i];
    if (typeof id !== "string") throw new UnreadableError(`${name} item ${i} is not a string`);
    read.push(id.length > limits.id ? id.slice(0, limits.id + 1) : id);
  }
  return read;
}
