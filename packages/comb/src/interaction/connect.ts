// The user connects two nodes (G-3, ADR-0024): a press on a connector begins a connection, which
// follows the pointer and marks the connectors of the node under it compatible where the source
// does not reach that node yet; released over a compatible connector, it proposes the edge to the
// host application's veto, through `connect`, which `api` gives where `canConnect` is set. The
// store holds where the connection is, which the render draws; the gesture holds nothing of it
// but the identifier of its source.
import type { Bridge, Hit } from "../bridge";
import type { Connection, GraphStore, Side } from "../store";
import { targetAt, type Context, type Gesture } from "./gesture";
import { toWorld } from "./viewport";

/** A connection the user proposes, by identifiers and sides, as `canConnect` is asked. */
export interface Proposal {
  readonly source: string;
  readonly sourceSide: Side;
  readonly target: string;
  readonly targetSide: Side;
}

/** Proposes the user's connection to the host application's veto, and adds the edge it allows;
 *  an error it throws is thrown on once the gesture has ended (ADR-0023). */
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

/** The connection from the connector `side` of the node in slot `source` with the pointer at the
 *  screen point `(x, y)`, where `hit` says what lies there. */
function connectionAt(
  store: GraphStore,
  bridge: Bridge,
  source: number,
  side: Side,
  x: number,
  y: number,
  hit: Hit,
): Connection {
  const to = toWorld(store.getState().viewport, x, y);
  const over = hit.kind === "connector" || hit.kind === "node" ? hit.slot : null;
  const compatible = over !== null && over !== source && !reaches(store, bridge, source, over);
  const target = compatible && hit.kind === "connector" ? { slot: hit.slot, side: hit.side } : null;
  return { source, side, to, over, compatible, target };
}

/** Ends the connection `connection`, and proposes its edge where it was released over a
 *  compatible connector. */
function endConnection(store: GraphStore, connection: Connection | null, connect: Connect): void {
  store.getState().connect(null);
  const target = connection?.target;
  if (!connection || !target) return;
  const { nodes } = store.getState();
  const [source, over] = [nodes[connection.source], nodes[target.slot]];
  if (!source || !over) return;
  connect({
    source: source.id,
    sourceSide: connection.side,
    target: over.id,
    targetSide: target.side,
  });
}

/** A connection begun by a press on the connector `hit` names, at the screen point `(x, y)`, which
 *  a release proposes through `connect`; none where `hit` names no connector of a node held. */
export function connection(
  context: Context,
  hit: Hit,
  x: number,
  y: number,
  connect: Connect,
): Gesture | undefined {
  const { store, bridge } = context;
  const from = hit.kind === "connector" ? store.getState().nodes[hit.slot] : undefined;
  if (hit.kind !== "connector" || !from) return undefined;
  const { id } = from;
  store.getState().connect(connectionAt(store, bridge, hit.slot, hit.side, x, y, hit));
  return {
    grabs: false,
    move(x, y) {
      const held = store.getState().connection;
      if (!held) return;
      const over = targetAt(context, x, y, true);
      store.getState().connect(connectionAt(store, bridge, held.source, held.side, x, y, over));
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
