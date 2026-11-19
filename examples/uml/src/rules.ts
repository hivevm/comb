// The rules of connection of the example's diagrams (G-12, G-20), a pure function of the kinds of
// the two nodes, the kind of the relationship, and whether it leads a node back to itself, read
// from a table of what they refuse, each with why, that docs/CONVENTIONS.md records. The veto of a
// connection asks it, and the sidebar says why where it refuses.
import type { RelationshipKind } from "./relationships";
import { STATE_KINDS, type NodeKind, type StateKind } from "./shared";

/** A relationship of `kind` from a node of kind `source` to one of kind `target`, a loop where
 *  `loop` says that the two are one node. */
export interface Proposed {
  source: NodeKind;
  target: NodeKind;
  kind: RelationshipKind;
  loop?: boolean;
}

/** The pseudostates of the state diagram, which UML 2.5.1 tells from its states: a fork leads only
 *  to states, and only states lead to a join. The signal symbols stand on a transition, and so
 *  pass for the state they lead from or to. */
const PSEUDOSTATES: readonly StateKind[] = [
  ...["initial", "terminate", "choice", "junction", "fork", "join"],
  ...["shallow-history", "deep-history", "entry-point", "exit-point"],
  ...["entry-reference", "exit-reference"],
] as StateKind[];

/** The states of the state diagram, a state list standing for states. */
const STATES: readonly StateKind[] = ["state", "composite", "submachine", "state-list", "final"];

/** The transitions the state diagram refuses, each by the kinds of its source and target, with
 *  why in the user's words; the first that holds says why. */
const TRANSITION_RULES: readonly [(source: StateKind, target: StateKind) => boolean, string][] = [
  [
    (source, target) => source === "comment" || target === "comment",
    "A comment is attached by its anchor; no transition starts or ends on it.",
  ],
  [
    (source, target) => source === "frame" || target === "frame",
    "The frame of the state machine is no vertex; no transition starts or ends on it.",
  ],
  [
    (_, target) => target === "initial",
    "An initial pseudostate starts its region; no transition enters it.",
  ],
  [
    (source) => source === "final",
    "UML 2.5.1 lets no transition leave a final state (no_outgoing_transitions).",
  ],
  [
    (source) => source === "terminate",
    "A terminate pseudostate ends the state machine; no transition leaves it.",
  ],
  [
    (source, target) => source === "fork" && PSEUDOSTATES.includes(target),
    "UML 2.5.1 lets a fork's transitions enter states only (fork_segment_state).",
  ],
  [
    (source, target) => target === "join" && PSEUDOSTATES.includes(source),
    "UML 2.5.1 lets only transitions from states enter a join (join_segment_state).",
  ],
  // A receive signal symbol is its transition's trigger.
  [
    (source, target) => source === "fork" && target === "receive-signal",
    "UML 2.5.1 gives a fork's transition no trigger, and a receive signal is one (fork_segment_guards).",
  ],
  [
    (source, target) => source === "receive-signal" && target === "join",
    "UML 2.5.1 gives a transition into a join no trigger, and a receive signal is one (join_segment_guards).",
  ],
  [
    (source, target) => source === "initial" && target === "receive-signal",
    "UML 2.5.1 gives an initial pseudostate's transition no trigger, and a receive signal is one (outgoing_from_initial).",
  ],
  [
    (source, target) => target === "receive-signal" && PSEUDOSTATES.includes(source),
    "UML 2.5.1 gives a transition out of a pseudostate no trigger, and a receive signal is one (outgoing_pseudostates).",
  ],
];

/** A part of a transition its label shows. */
export type TransitionPart = "trigger" | "guard" | "effect";

/** The parts a transition from a node of kind `source` to one of kind `target` may have: no
 *  trigger out of a pseudostate, nor into a join, and no guard out of an initial pseudostate or a
 *  fork, or into a join (UML 2.5.1, Transition: outgoing_pseudostates, fork_segment_guards,
 *  join_segment_guards; Pseudostate: outgoing_from_initial); an effect always. */
export function transitionParts(source: NodeKind, target: NodeKind): TransitionPart[] {
  const segment = source === "fork" || target === "join";
  const fromPseudostate = PSEUDOSTATES.includes(source as StateKind);
  return [
    ...(fromPseudostate || segment ? [] : (["trigger"] as const)),
    ...(segment || source === "initial" ? [] : (["guard"] as const)),
    "effect",
  ];
}

/** Why a loop is refused that is no state's transition. */
const NO_LOOP =
  "Only a state's transition leads back to it; no other relationship of a node with itself is drawn.";

/** The anchors the state diagram refuses, as `TRANSITION_RULES` the transitions: an anchor attaches
 *  a comment to a state or a pseudostate, and to nothing else. */
const ANCHOR_RULES: readonly [(source: StateKind, target: StateKind) => boolean, string][] = [
  [(source) => source !== "comment", "An anchor starts at a comment."],
  [
    (_, target) => !STATES.includes(target) && !PSEUDOSTATES.includes(target),
    "A comment is anchored on a state or a pseudostate.",
  ],
];

/** The relationships the rules refuse, each as "source target kind" with why, from
 *  `TRANSITION_RULES` and `ANCHOR_RULES`. A class, a package, and the state diagram's kinds never
 *  share a diagram, so no case mixes them, and between classifiers nothing is refused. */
const REFUSED: ReadonlyMap<string, string> = new Map(
  (
    [
      ["transition", TRANSITION_RULES],
      ["anchor", ANCHOR_RULES],
    ] as const
  ).flatMap(([kind, rules]) =>
    STATE_KINDS.flatMap((source) =>
      STATE_KINDS.flatMap((target) => {
        const rule = rules.find(([holds]) => holds(source, target));
        return rule ? [[`${source} ${target} ${kind}`, rule[1]] as const] : [];
      }),
    ),
  ),
);

/** The loops the rules allow, each as "node kind": a transition of a state, a composite state, or
 *  a submachine state back to itself; no pseudostate leads back to itself, nor a classifier or a
 *  package. */
const LOOPS: ReadonlySet<string> = new Set([
  "state transition",
  "composite transition",
  "submachine transition",
]);

/** Why the rules refuse the relationship `proposed`, none where they allow it. */
export function refusal({ source, target, kind, loop = false }: Proposed): string | undefined {
  const refused = REFUSED.get(`${source} ${target} ${kind}`);
  if (refused !== undefined) return refused;
  return loop && !LOOPS.has(`${source} ${kind}`) ? NO_LOOP : undefined;
}

/** Whether the rules allow the relationship `proposed`. */
export function allows(proposed: Proposed): boolean {
  return refusal(proposed) === undefined;
}
