// The snapshot of the host application's graph data (ADR-0028): every value read once, in
// JavaScript, into plain data whose every field is a primitive of the type the field expects, so
// that the bridge checks it and the store keeps it, and no value of the host application, nor any
// of its code, reaches the engine; a load's nodes and edges are handed over as columns besides
// (ADR-0034). A value of another type is replaced by `false`, which the bridge refuses naming the
// node or edge and the field; a text of content, a label text, and the arrow are handed over no
// longer than one code unit beyond the bridge's limit for texts, an identifier no longer than one
// beyond its limit for identifiers, and a node's content no more rows, nor a row more columns,
// than one beyond the bridge's limits, so that a value of any size costs at most that much to
// check. The code units of all identifiers are counted while they are read, and
// reading stops once they exceed the bridge's budget, whose check then refuses the load. What
// cannot be read at all throws an `UnreadableError`.
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
 *  content and columns of a row. */
export interface Limits {
  text: number;
  id: number;
  idBudget: number;
  contentBudget: number;
  rows: number;
  columns: number;
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
    content: (value) => (Array.isArray(value) ? contentOf(reader, value, limits) : falseOr(value)),
    textLimit: limits.text,
    idUnits: 0,
    contentUnits: 0,
    contentPast: undefined,
  };
  return reader;
}

/** `value` where it stands for a field left out, null or undefined, else `false`. */
const falseOr = (value: unknown) => (value === undefined || value === null ? value : false);

/** A node's content as plain data, read by `read`: at most one row beyond `limits.rows`, each a
 *  list of at most one element beyond `limits.columns` or `false`, each element an object of its
 *  kind, role, text, and weight where one is given, or `false` where it is no object. A list is
 *  no object here: an element is a description, never a list. */
function contentOf(read: Reader, rows: readonly unknown[], limits: Limits) {
  const count = Math.min(rows.length, limits.rows + 1);
  const content: unknown[] = [];
  for (let r = 0; r < count; r++) {
    const row: unknown = rows[r];
    if (!Array.isArray(row)) {
      content.push(false);
      continue;
    }
    const columns = Math.min(row.length, limits.columns + 1);
    const elements: unknown[] = [];
    for (let c = 0; c < columns; c++) elements.push(elementOf(read, row[c]));
    content.push(elements);
  }
  return content;
}

/** A name of an element's kind or a text's role, which the bridge reads as a code: a string as
 *  `read` reads a text but not searched for a lone surrogate, since a name with one names no
 *  kind or role and is refused as such. */
function nameOf(value: unknown, read: Reader): unknown {
  if (typeof value !== "string") return read.text(value);
  return value.length > read.textLimit ? value.slice(0, read.textLimit + 1) : value;
}

/** An element of content as plain data, or `false` where it is no object; an action's identifier
 *  read as a text is, and a badge's colour as a number is, each read of no other kind. */
function elementOf(read: Reader, value: unknown) {
  const fields = objectOf(value);
  if (!fields || Array.isArray(value)) return false;
  const { kind, role, text, weight } = fields;
  const element: Record<string, unknown> = {
    kind: nameOf(kind, read),
    role: nameOf(role, read),
    text: read.text(text),
  };
  if (kind === "action") element.id = read.text(fields.id);
  if (kind === "badge") element.color = read.number(fields.color);
  // No key for a weight left out, which the bridge reads as 1, so that Comb keeps none either.
  if (weight !== undefined && weight !== null) element.weight = read.number(weight);
  return element;
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

/** Writes the node `node` into `columns`, read once by `read`, its content straight into its
 *  columns, cut by `limits` as `contentOf` cuts it, and returns what the store keeps of it: its
 *  identifier and its width, no copy of its content (ADR-0013). */
function written(read: Reader, node: Fields, columns: NodeColumnWriter, limits: Limits) {
  const { id, x, y, width, content } = node;
  const kept = { id: read.id(id), width: read.number(width) };
  columns.node(kept.id, read.number(x), read.number(y), kept.width);
  if (!Array.isArray(content)) columns.noContent();
  else {
    const rows = content.length > limits.rows ? limits.rows + 1 : content.length;
    for (let r = 0; r < rows; r++) {
      const row: unknown = content[r];
      if (!Array.isArray(row)) columns.noRow();
      else writeRow(read, row, columns, limits, kept.id);
    }
  }
  return kept;
}

/** Counts `units` more code units of the texts of content of a load, of the node `node`, and
 *  names that node where they pass the bridge's budget, after which reading stops. */
function counted(read: Reader, units: number, node: unknown, limits: Limits) {
  read.contentUnits += units;
  if (read.contentUnits > limits.contentBudget && read.contentPast === undefined)
    read.contentPast = typeof node === "string" ? node : "";
}

/** Writes the elements of `row`, a list, into `columns`, read once by `read`, at most one beyond
 *  `limits.columns`, the last of them ending the row. */
function writeRow(
  read: Reader,
  row: unknown[],
  columns: NodeColumnWriter,
  limits: Limits,
  node: unknown,
) {
  const count = row.length > limits.columns ? limits.columns + 1 : row.length;
  if (count === 0) columns.endRow();
  for (let c = 0; c < count; c++) {
    const value: unknown = row[c];
    const last = c === count - 1;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      columns.noElement(last);
    else writeElement(read, value as Fields, columns, limits, node, last);
  }
}

/** Writes `element`, an object, into `columns`, read once by `read`, ending the row where `last`. */
function writeElement(
  read: Reader,
  element: Fields,
  columns: NodeColumnWriter,
  limits: Limits,
  node: unknown,
  last: boolean,
) {
  const { kind, role, weight, text } = element;
  // The kind, the role, the weight, and a badge's colour cross as codes and numbers, which the
  // writer takes by `typeof` and by comparing a string with a name; an action's identifier is
  // read as a text is, and counted with the texts.
  const shown = read.text(text);
  const id = kind === "action" ? read.text(element.id) : undefined;
  const color = kind === "badge" ? read.number(element.color) : undefined;
  columns.element(kind, role, weight, color, shown, id, last);
  if (typeof shown === "string") counted(read, shown.length, node, limits);
  if (typeof id === "string") counted(read, id.length, node, limits);
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
