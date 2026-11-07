// The rules of connection of the example's diagrams (G-12), a pure function of the kinds of the two
// nodes, the kind of the relationship, and whether it leads a node back to itself, read from a
// table that docs/CONVENTIONS.md records. The veto of a connection asks it.
import type { RelationshipKind } from "./relationships";
import { STATE_KINDS, type NodeKind } from "./shared";

/** A relationship of `kind` from a node of kind `source` to one of kind `target`, a loop where
 *  `loop` says that the two are one node. */
export interface Proposed {
  source: NodeKind;
  target: NodeKind;
  kind: RelationshipKind;
  loop?: boolean;
}

/** The relationships the rules refuse, each as "source target kind": a transition into an
 *  initial state, which a machine only starts from, and out of a final state, where it ends. A
 *  class, a package, and a state never share a diagram, so no case mixes them. */
const REFUSED: ReadonlySet<string> = new Set(
  STATE_KINDS.flatMap((other) => [`${other} initial transition`, `final ${other} transition`]),
);

/** The loops the rules allow, each as "node kind": a transition of a state back to itself; no
 *  pseudostate leads back to itself, nor a classifier or a package. */
const LOOPS: ReadonlySet<string> = new Set(["state transition"]);

/** Whether the rules allow the relationship `proposed`. */
export function allows({ source, target, kind, loop = false }: Proposed): boolean {
  if (loop) return LOOPS.has(`${source} ${kind}`);
  return !REFUSED.has(`${source} ${target} ${kind}`);
}
