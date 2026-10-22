// The snapshot of the host application's graph data (ADR-0009): every value read once, in
// JavaScript, into plain data whose every field is a primitive of the type the field expects, so
// that the bridge checks it and the store keeps it, and no value of the host application, nor any
// of its code, reaches the engine. A value of another type is replaced by `false`, which the bridge
// refuses naming the node or edge and the field; a title, a label text, and the arrow are handed
// over no longer than one code unit beyond the bridge's limit for texts, and an identifier no
// longer than one beyond its limit for identifiers, so that a string of any length costs at most
// that much to check. The code units of all identifiers are counted while they are read, and
// reading stops once they exceed the bridge's budget, whose check then refuses the load. What
// cannot be read at all throws an `UnreadableError`.
import type { GraphBatch, NodePatch } from "../bridge";
import { edgeColor } from "../render/edges";
import type { GraphData } from "../store";

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
 *  identifier, and of all identifiers of one load together. */
export interface Limits {
  text: number;
  id: number;
  idBudget: number;
}

/** What a field expects: a number, a text, or an identifier, each of its type or absent. */
interface Reader {
  number(value: unknown): unknown;
  text(value: unknown): unknown;
  id(value: unknown): unknown;
  /** The code units of the identifiers read so far. */
  idUnits: number;
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
    idUnits: 0,
  };
  return reader;
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

/** The first `count` items of `list`, each copied by `copy`, by index; never through a method of
 *  the list, and refused at the first hole. */
function copied<T>(
  list: readonly unknown[],
  count: number,
  name: string,
  copy: (item: Fields) => T,
  done: () => boolean,
) {
  const items: (T | false)[] = [];
  for (let i = 0; i < count && !done(); i++) {
    if (!(i in list)) throw new UnreadableError(`${name} has no item ${i}`);
    const item = objectOf(list[i]);
    items.push(item ? copy(item) : false);
  }
  return items;
}

function nodeOf(read: Reader, node: Fields) {
  const { id, title, x, y, width, height } = node;
  return {
    id: read.id(id),
    title: read.text(title),
    x: read.number(x),
    y: read.number(y),
    width: read.number(width),
    height: read.number(height),
  };
}

/** A label: absent where null or undefined, `false` where no object. */
function labelOf(read: Reader, label: unknown) {
  if (label === undefined || label === null) return undefined;
  const fields = objectOf(label);
  if (!fields) return false;
  const { text, t, offset, background } = fields;
  return {
    text: read.text(text),
    t: read.number(t),
    offset: read.number(offset),
    background: read.number(background),
  };
}

/** A dash pattern: absent where null or undefined, `false` where no list of two. */
function dashOf(read: Reader, dash: unknown) {
  if (dash === undefined || dash === null) return undefined;
  if (!Array.isArray(dash) || dash.length !== 2) return false;
  return [read.number(dash[0]), read.number(dash[1])];
}

function edgeOf(read: Reader, edge: Fields) {
  const { id, source, target, label, color, dash, arrow } = edge;
  return {
    id: read.id(id),
    source: read.id(source),
    target: read.id(target),
    label: labelOf(read, label),
    color: edgeColor({ color: read.number(color) as number | undefined }),
    dash: dashOf(read, dash),
    arrow: read.text(arrow) ?? "end",
  };
}

/** The snapshot of the lists `listsOf` read, with the edge styles' defaults and its strings cut
 *  by `limits`: what the bridge checks and, once it has, the store keeps; and the code units of
 *  its identifiers, for the bridge to check first. Reading stops, the snapshot unfinished, once
 *  they exceed the budget. */
export function snapshotOf(lists: Lists, limits: Limits) {
  const read = readerOf(limits);
  const done = () => read.idUnits > limits.idBudget;
  const nodes = copied(lists.nodes, lists.nodeCount, "nodes", (n) => nodeOf(read, n), done);
  const edges = copied(lists.edges, lists.edgeCount, "edges", (e) => edgeOf(read, e), done);
  const snapshot = { nodes, edges } as unknown as GraphData & GraphBatch;
  return { snapshot, idUnits: read.idUnits };
}

/** The patch of `updateNode` as plain data: the own fields of a plain object, enumerable or not,
 *  up to the first other than `title`, each a primitive, a string one as a text cut by
 *  `limits`. A patch that is no plain object, a `Map` or an array among them, or
 *  that has a key that is no string, cannot be read. */
export function patchOf(patch: unknown, limits: Limits): NodePatch {
  const fields = objectOf(patch);
  if (!fields || Object.getPrototypeOf(fields) !== Object.prototype)
    throw new UnreadableError("the patch is not a plain object");
  const read = readerOf(limits);
  const plain: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== "string") throw new UnreadableError("the patch has a key that is no string");
    if (key !== "title") {
      // The first other field, which the bridge refuses by name: its name cut like a text, its
      // value not read, and no field after it.
      plain[read.text(key) as string] = false;
      break;
    }
    const value = fields[key];
    plain[key] = typeof value === "string" ? read.text(value) : read.number(value);
  }
  return plain as NodePatch;
}
