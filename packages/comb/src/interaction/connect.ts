// The user connects two nodes (G-3, ADR-0024): a press on a connector begins a connection, which
// follows the pointer and marks the connectors of the node under it compatible where the source
// does not reach that node yet; released over a compatible connector, it proposes the edge to the
// host application's veto, through `connect`, which `api` gives where `canConnect` is set.
import type { Bridge, Hit } from "../bridge";
import type { Connection, GraphStore, Side } from "../store";
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
export function connectionAt(
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
export function endConnection(
  store: GraphStore,
  connection: Connection | null,
  connect: Connect,
): void {
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
