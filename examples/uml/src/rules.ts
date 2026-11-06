// The rules of connection of the class diagram (G-12), a pure function of the kinds of the two
// nodes and the kind of the relationship, read from a table that docs/CONVENTIONS.md records.
// The veto of a connection asks it. No edge joins a node with itself: the diagram refuses one
// before it asks the rules, so they need no case for it.
import type { RelationshipKind } from "./relationships";

/** The kinds of node: those of the class diagram, and the package of the package diagram. */
export const NODE_KINDS = ["class", "interface", "abstract-class", "package"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** A relationship of `kind` from a node of kind `source` to one of kind `target`. */
export interface Proposed {
  source: NodeKind;
  target: NodeKind;
  kind: RelationshipKind;
}

/** The relationships the rules refuse, each as "source target kind": none. A class and a package
 *  never share a diagram, and the diagram refuses every edge of a node with itself. */
const REFUSED: ReadonlySet<string> = new Set();

/** Whether the rules allow the relationship `proposed`. */
export function allows({ source, target, kind }: Proposed): boolean {
  return !REFUSED.has(`${source} ${target} ${kind}`);
}
