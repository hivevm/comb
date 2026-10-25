// The edits of the graph: every method of `Comb` that changes it, and the user's connection and
// deletion, each run through `edit`, which holds their order (Q-7, ADR-0023, ADR-0028). Refuse
// once the engine is lost; read the host's input once, whole, into plain data; refuse what the
// store's map shows, as it stands after the read, since a getter of the input is the host's code
// and may have changed the graph through `Comb`; check the code units of identifiers the graph
// would hold; have the bridge check the plain data and the engine apply it; and have the store
// take the result and record the change, by whom it names.
import { refuseIfLost, type Bridge, type GraphDataProblem, type SlotError } from "../bridge";
import type { Remove } from "../interaction";
import type {
  By,
  EdgeData,
  EdgePatch,
  GraphData,
  GraphState,
  GraphStore,
  NodeData,
  NodeView,
} from "../store";
import {
  edgePatchOf,
  edgeSnapshotOf,
  idListOf,
  idsOf,
  isUnreadable,
  listsOf,
  nodeSnapshotOf,
  patchOf,
  snapshotOf,
  type Limits,
} from "./snapshot";

/** Graph data Comb refused in a method that changes the graph, with what was wrong and where:
 *  `problem`, whose `kind` tells which of the generated `GraphDataProblem`s it is. */
export class GraphDataError extends Error {
  constructor(readonly problem: GraphDataProblem) {
    super(`comb: malformed graph data (${problem.kind})`);
    this.name = "GraphDataError";
  }
}

/** Has the bridge check the lengths of the lists an input holds, before any item is read. */
type Sized = (nodes: number, edges: number) => void;

/** One edit of the graph, by the steps `edit` takes in order. `P` is the plain data the input
 *  is read into, `R` what of it the bridge takes once the map has been asked, and `T` what the
 *  bridge returns. */
interface Edit<P, R, T> {
  /** Reads the host's input once, whole, into plain data; `sized` checks a list's length. */
  read(sized: Sized): P;
  /** Refuses what the map of `state` shows of `plain`, and returns what the bridge takes, or
   *  nothing for an edit that changes nothing and tells nothing. */
  resolve(plain: P, state: GraphState): R | undefined;
  /** The code units of every identifier the graph would hold after the edit, for one that brings
   *  identifiers in. */
  idUnits?(plain: P, state: GraphState): number;
  /** Has the bridge check `resolved` and the engine apply it. */
  engine(resolved: R): T;
  /** Has the store take what the engine applied and record the change. */
  record(state: GraphState, resolved: R, result: T): void;
}

/** Whether `error` is a refusal the bridge produced: a plain object with a `kind`. */
function isRefusal(error: unknown): error is GraphDataProblem | SlotError {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.getPrototypeOf(error) === Object.prototype &&
    typeof (error as { kind?: unknown }).kind === "string"
  );
}

/** Whether a problem of the bridge's is a `SlotError`: a slot the shell named that holds no node
 *  or no edge, a mistake of Comb's own, never one of graph data. */
function isSlotError(error: GraphDataProblem | SlotError): error is SlotError {
  return error.kind === "noNode" || error.kind === "noEdge";
}

/** Calls the bridge with plain data; what it refuses of the data becomes a `GraphDataError`. A
 *  `SlotError` is the shell's mistake and becomes an `Error` naming the slot, as does any other
 *  error, such as the `EngineLostError` of a trap, which is thrown on as it is. */
function checked<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (isRefusal(error)) {
      if (!isSlotError(error)) throw new GraphDataError(error);
      const item = error.kind === "noNode" ? "node" : "edge";
      throw new Error(`comb: the engine holds no ${item} in slot ${error.slot}`, { cause: error });
    }
    throw error instanceof Error ? error : new Error("comb: the engine failed");
  }
}

/** Reads the host's input with `read`, in JavaScript, before the store or the bridge sees it;
 *  what reading throws (graph data that is not an object, nodes that are not a list, a getter
 *  that throws) refuses it as malformed. The message is Comb's own: a value the host application
 *  threw is not read. A length `sized` refuses is thrown on as the bridge's refusal. */
function readOnce<P>(bridge: Bridge, read: (sized: Sized) => P): P {
  let refusal: { error: unknown } | undefined;
  const sized: Sized = (nodes, edges) => {
    try {
      checked(() => bridge.checkGraphSize(nodes, edges));
    } catch (error) {
      refusal = { error };
      throw error;
    }
  };
  try {
    return read(sized);
  } catch (error) {
    if (refusal && error === refusal.error) throw error;
    const message = isUnreadable(error) ? error.message : "comb: graph data could not be read";
    throw new GraphDataError({ kind: "malformed", message });
  }
}

/** Runs the edit `step` on `store` through `bridge`, in the order Q-7 rests on: the input is read
 *  whole before the map is asked, so that the map shows every change a getter made. */
function edit<P, R, T>(store: GraphStore, bridge: Bridge, step: Edit<P, R, T>): void {
  refuseIfLost();
  const plain = readOnce(bridge, (sized) => step.read(sized));
  const state = store.getState();
  const resolved = step.resolve(plain, state);
  if (resolved === undefined) return;
  if (step.idUnits) {
    const units = step.idUnits(plain, state);
    checked(() => bridge.checkIdBudget(units));
  }
  const result = checked(() => step.engine(resolved));
  step.record(store.getState(), resolved, result);
}

/** What one Comb's edits need: its store, its bridge, and the bridge's limits. */
interface Editing {
  readonly store: GraphStore;
  readonly bridge: Bridge;
  readonly limits: Limits;
}

/** `load`: the graph data read once, its lists' lengths checked before any item is, and handed
 *  to the engine; the store takes it with the code units its snapshot counted. */
function load({ store, bridge, limits }: Editing, graph: GraphData): void {
  edit(store, bridge, {
    read(sized) {
      const lists = listsOf(graph);
      sized(lists.nodeCount, lists.edgeCount);
      return snapshotOf(lists, limits);
    },
    resolve: (plain) => plain,
    idUnits: (plain) => plain.idUnits,
    engine: ({ snapshot }) => bridge.loadGraph(snapshot),
    record: (state, { snapshot, idUnits }) => state.load(snapshot, idUnits),
  });
}

/** `updateNode`: a node the graph does not hold refused, and only the fields the bridge returns
 *  as checked merged. */
function updateNode({ store, bridge, limits }: Editing, id: string, patch: unknown): void {
  edit(store, bridge, {
    read: () => patchOf(patch, limits),
    resolve(plain, state) {
      if (!state.slots.has(id)) throw new GraphDataError({ kind: "unknownNode", node: id });
      return plain;
    },
    engine: (plain) => bridge.checkNodePatch(id, plain),
    record: (state, _, fields) => state.updateNode(id, fields),
  });
}

/** `addNode`: an identifier the map holds already refused; the engine chooses the slot the store
 *  keeps the node in (ADR-0022). */
function addNode({ store, bridge, limits }: Editing, node: unknown): void {
  edit(store, bridge, {
    read: () => nodeSnapshotOf(node, limits),
    resolve(plain, state) {
      const { id } = plain.snapshot as { id?: unknown };
      if (typeof id === "string" && state.slots.has(id))
        throw new GraphDataError({ kind: "duplicateNode", node: id });
      return plain;
    },
    idUnits: (plain, state) => state.idUnits + plain.idUnits,
    engine: ({ snapshot }) => bridge.addNode(snapshot),
    // The bridge took the node, so each field holds a value of its type.
    record: (state, { snapshot }, slot) => state.addNode(snapshot as unknown as NodeData, slot),
  });
}

/** The slots of the ends of the edge `snapshot` names in the map of `state`, refusing an
 *  identifier the map holds already and an end it does not hold. An identifier, source, or target
 *  that is no string, or longer than the limit, the bridge refuses before the map is asked, as a
 *  load refuses it before any end is resolved. */
function endsOf(snapshot: unknown, state: GraphState, limits: Limits): [number, number] {
  const { id, source, target } = snapshot as { id?: unknown; source?: unknown; target?: unknown };
  const named = (value: unknown): value is string =>
    typeof value === "string" && value.length <= limits.id;
  if (!(named(id) && named(source) && named(target))) return [0, 0];
  if (state.edgeSlots.has(id)) throw new GraphDataError({ kind: "duplicateEdge", edge: id });
  const end = (node: string) => {
    const slot = state.slots.get(node);
    if (slot === undefined) throw new GraphDataError({ kind: "missingNode", edge: id, node });
    return slot;
  };
  return [end(source), end(target)];
}

/** `addEdge`, and the user's connection, as `by` makes it: the edge added between the slots of
 *  its ends (ADR-0022). */
function addEdge({ store, bridge, limits }: Editing, edge: unknown, by: By): void {
  edit(store, bridge, {
    read: () => edgeSnapshotOf(edge, limits),
    resolve: (plain, state) => ({ ...plain, ends: endsOf(plain.snapshot, state, limits) }),
    idUnits: (plain, state) => state.idUnits + plain.idUnits,
    engine: ({ snapshot, ends: [from, to] }) => bridge.addEdge(snapshot, from, to),
    // The bridge took the edge, so each field holds a value of its type.
    record: (state, { snapshot }, slot) => state.addEdge(snapshot as unknown as EdgeData, slot, by),
  });
}

/** `updateEdge`: an edge the graph does not hold refused, and the patch merged once the bridge
 *  has checked every field of it; a patch that sets nothing changes and tells nothing. */
function updateEdge({ store, bridge, limits }: Editing, id: string, patch: unknown): void {
  edit(store, bridge, {
    read: () => edgePatchOf(patch, limits),
    resolve(plain, state) {
      const slot = state.edgeSlots.get(id);
      if (slot === undefined) throw new GraphDataError({ kind: "unknownEdge", edge: id });
      return Object.keys(plain).length === 0 ? undefined : { slot, plain };
    },
    engine: ({ slot, plain }) => bridge.updateEdge(slot, id, plain),
    record: (state, { plain }) => state.updateEdge(id, plain as unknown as EdgePatch),
  });
}

/** The slots of `ids` in `map`, each once, in the order first named; refuses, before anything is
 *  removed, an identifier the map does not hold with the problem `unknown` makes of it. */
function slotsOf(
  ids: readonly string[],
  map: ReadonlyMap<string, number>,
  unknown: (id: string) => GraphDataProblem,
): Uint32Array {
  const slots = new Set<number>();
  for (const id of ids) {
    const slot = map.get(id);
    if (slot === undefined) throw new GraphDataError(unknown(id));
    slots.add(slot);
  }
  return Uint32Array.from(slots);
}

/** The one removal: of the nodes `ids` with every edge at them, or of the edges `ids`, as `by`
 *  makes it; `removeNodes`, `removeEdges`, and the user's deletion run through it. The list is
 *  read once, its length checked by the bridge before any identifier is read; an identifier the
 *  graph does not hold is refused, and a list that names none changes and tells nothing. */
function remove(
  { store, bridge, limits }: Editing,
  list: "nodes" | "edges",
  ids: unknown,
  by: By,
): void {
  const name = list === "nodes" ? "node identifiers" : "edge identifiers";
  edit(store, bridge, {
    read(sized) {
      const listed = idListOf(ids, name);
      if (list === "nodes") sized(listed.count, 0);
      else sized(0, listed.count);
      return idsOf(listed.list, listed.count, name, limits);
    },
    resolve(read, state) {
      const slots =
        list === "nodes"
          ? slotsOf(read, state.slots, (node) => ({ kind: "unknownNode", node }))
          : slotsOf(read, state.edgeSlots, (edge) => ({ kind: "unknownEdge", edge }));
      return slots.length === 0 ? undefined : slots;
    },
    engine(slots) {
      if (list === "nodes") return bridge.removeNodes(slots);
      bridge.removeEdges(slots);
      return slots;
    },
    record(state, slots, edges) {
      if (list === "nodes") state.removeNodes([...slots], [...edges], by);
      else state.removeEdges([...slots], by);
    },
  });
}

/** The edits of one Comb on `store` through `bridge`: `host`, the methods of `Comb` that change
 *  the graph, and `user`, the user's connection and deletion, which interaction is handed. */
export function editorsOf(store: GraphStore, bridge: Bridge, limits: Limits) {
  const editing: Editing = { store, bridge, limits };
  const host = {
    load: (graph: GraphData) => load(editing, graph),
    updateNode: (id: string, patch: Partial<Pick<NodeView, "title">>) =>
      updateNode(editing, id, patch),
    addNode: (node: NodeData) => addNode(editing, node),
    addEdge: (edge: EdgeData) => addEdge(editing, edge, "host"),
    updateEdge: (id: string, patch: EdgePatch) => updateEdge(editing, id, patch),
    removeNodes: (ids: readonly string[]) => remove(editing, "nodes", ids, "host"),
    removeEdges: (ids: readonly string[]) => remove(editing, "edges", ids, "host"),
  };
  const user = {
    addEdge: (edge: EdgeData) => addEdge(editing, edge, "user"),
    remove: ((list, ids) => remove(editing, list, ids, "user")) satisfies Remove,
  };
  return { host, user };
}
