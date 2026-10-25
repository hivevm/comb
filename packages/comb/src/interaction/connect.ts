// The user connects two nodes (G-3, ADR-0024): a press on a connector begins a connection, which
// follows the pointer and marks the connectors of the node under it compatible where the source
// does not reach that node yet; released over a compatible connector, it proposes the edge to the
// host application's veto, through `connect`, which `api` gives where `canConnect` is set. The
// store holds what the connection is from and over, which changes rarely; the world point it is
// dragged to, which changes on every move, is the context's `pointer`, which the store's
// `pointerMoved` signals, as a drag of a node signals the positions it moves (ADR-0029). The
// gesture holds nothing of it but the identifier of its source.
import type { Bridge, Hit } from "../bridge";
import type { Connection, GraphStore, Side } from "../store";
import { targetAt, type Context, type Gesture } from "./gesture";
import { toWorld } from "../store/viewport";

/** A connection the user proposes, by identifiers and sides, as `canConnect` is asked. */
export interface Proposal {
  readonly source: string;
  readonly sourceSide: Side;
  readonly target: string;
  readonly targetSide: Side;
}

/** Proposes the user's connection to the host application's veto, and adds the edge it allows;
 *  an error it throws is thrown on once the gesture has ended (ADR-0030). */
export type Connect = (proposal: Proposal) => void;

/** Whether an edge from the node in slot `source` to the node in slot `target` exists, in that
 *  direction, by any sides (ADR-0024). */
function reaches(store: GraphStore, bridge: Bridge, source: number, target: number): boolean {
  const { nodes, edges } = store.getState();
  const [from, to] = [nodes[source]?.id, nodes[target]?.id];
  return [...bridge.edgesAt(Uint32Array.of(source))].some((slot) => {
    const edge = edges[slot];
    return edge !== undefined && edge.source === from && edge.target === to;
  });
}

/** The connection from the connector `side` of the node in slot `source` with the pointer over
 *  what `hit` says. */
function connectionOver(
  store: GraphStore,
  bridge: Bridge,
  source: number,
  side: Side,
  hit: Hit,
): Connection {
  const over = hit.kind === "connector" || hit.kind === "node" ? hit.slot : null;
  const compatible = over !== null && over !== source && !reaches(store, bridge, source, over);
  const target = compatible && hit.kind === "connector" ? { slot: hit.slot, side: hit.side } : null;
  return { source, side, over, compatible, target };
}

/** Whether `a` and `b` are the same connection: from, over, and onto the same. */
function same(a: Connection, b: Connection): boolean {
  return (
    a.source === b.source &&
    a.side === b.side &&
    a.over === b.over &&
    a.compatible === b.compatible &&
    a.target?.slot === b.target?.slot &&
    a.target?.side === b.target?.side
  );
}

/** Keeps the world point under the screen point `(x, y)` as where the connection is dragged to. */
function follow({ store, pointer }: Context, x: number, y: number): void {
  const to = toWorld(store.getState().viewport, x, y);
  [pointer.x, pointer.y] = [to.x, to.y];
}

/** Ends the connection `ended`, and proposes its edge where it was released over a
 *  compatible connector. */
function endConnection(store: GraphStore, ended: Connection | null, connect: Connect): void {
  store.getState().connect(null);
  const target = ended?.target;
  if (!ended || !target) return;
  const { nodes } = store.getState();
  const [source, over] = [nodes[ended.source], nodes[target.slot]];
  if (!source || !over) return;
  connect({
    source: source.id,
    sourceSide: ended.side,
    target: over.id,
    targetSide: target.side,
  });
}

/** A connection begun by a press on the connector `hit` names, at the screen point
 *  `(pressX, pressY)`, which a release proposes through `connect`; none where `hit` names no
 *  connector of a node held. */
export function connection(
  context: Context,
  hit: Hit,
  pressX: number,
  pressY: number,
  connect: Connect,
): Gesture | undefined {
  const { store, bridge } = context;
  const from = hit.kind === "connector" ? store.getState().nodes[hit.slot] : undefined;
  if (hit.kind !== "connector" || !from) return undefined;
  const { id } = from;
  follow(context, pressX, pressY);
  store.getState().connect(connectionOver(store, bridge, hit.slot, hit.side, hit));
  return {
    grabs: false,
    // The store hears of the point once a move, and of the connection only where it changed.
    move(x, y) {
      const held = store.getState().connection;
      if (!held) return;
      follow(context, x, y);
      const next = connectionOver(
        store,
        bridge,
        held.source,
        held.side,
        targetAt(context, x, y, true),
      );
      if (!same(held, next)) store.getState().connect(next);
      store.getState().pointerMoved();
    },
    // One a later press ends, its release never having come, proposes none.
    end(released) {
      if (released) endConnection(store, store.getState().connection, connect);
      else store.getState().connect(null);
    },
    // A load, or a removal of the source, which a node that took its slot does not make good.
    taken: (state) =>
      state.change?.kind === "loaded" ||
      !state.connection ||
      state.nodes[state.connection.source]?.id !== id,
    drop: () => store.getState().connect(null),
  };
}
