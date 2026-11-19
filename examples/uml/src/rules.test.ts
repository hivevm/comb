// The rules of connection of the example's diagrams against the table docs/CONVENTIONS.md records,
// over every pair of node kinds of a diagram and every relationship kind it adds, and over every
// loop. The table is written here from the conventions, not read from the rules; the constraints
// of UML 2.5.1 it names were read in the OCL of the metamodel, UML.xmi of 2016-11-01.
// Verifies: G-12, G-20
import { expect, test } from "bun:test";
import { allows, flowBetween, refusal, transitionParts, type TransitionPart } from "./rules";
import { NODE_KINDS } from "./shared";

const RELATIONSHIP_KINDS = [
  "association",
  "directed-association",
  "generalization",
  "realization",
  "dependency",
  "aggregation",
  "composition",
] as const;

const CLASSIFIER_KINDS = ["class", "interface", "abstract-class", "package"] as const;

/** The states of UML 2.5.1 among the state diagram's kinds: a state, a composite state, a
 *  submachine state, a state list, which stands for states, and a final state. */
const STATES = ["state", "composite", "submachine", "state-list", "final"] as const;
/** Its pseudostates, the points and the connection point references among them. */
const PSEUDOSTATES = [
  ...["initial", "terminate", "choice", "junction", "fork", "join"],
  ...["shallow-history", "deep-history", "entry-point", "exit-point"],
  ...["entry-reference", "exit-reference"],
] as const;
/** The send and receive signal symbols, which stand on a transition, and the comment and the
 *  frame, which are no vertex. */
const STATE_KINDS = [
  ...STATES,
  ...PSEUDOSTATES,
  "send-signal",
  "receive-signal",
  "comment",
  "frame",
] as const;

/** The conventions' table, each refused pair as "kind source target": between a class, an
 *  interface, an abstract class, and a package, in either direction, none; between the state
 *  diagram's kinds, a transition at a comment or the frame, into an initial pseudostate, out of a
 *  final state or a terminate pseudostate, out of a fork into anything but a state or a signal
 *  symbol, into a join out of anything but a state or a signal symbol, and, since a receive signal
 *  symbol is its transition's trigger, out of a pseudostate into a receive signal symbol and out
 *  of one into a join (UML 2.5.1, Transition: outgoing_pseudostates, fork_segment_guards,
 *  join_segment_guards; Pseudostate: outgoing_from_initial). */
const REFUSED_TRANSITIONS: ReadonlySet<string> = new Set(
  STATE_KINDS.flatMap((other) => [
    ...["comment", "frame"].flatMap((no) => [
      `transition ${no} ${other}`,
      `transition ${other} ${no}`,
    ]),
    `transition ${other} initial`,
    `transition final ${other}`,
    `transition terminate ${other}`,
  ]).concat(
    PSEUDOSTATES.flatMap((pseudostate) => [
      `transition fork ${pseudostate}`,
      `transition ${pseudostate} join`,
      `transition ${pseudostate} receive-signal`,
    ]),
    ["transition receive-signal join"],
  ),
);

/** The anchors the conventions refuse: every anchor but one from a comment to a state or a
 *  pseudostate. */
const VERTICES: readonly string[] = [...STATES, ...PSEUDOSTATES];
const REFUSED: ReadonlySet<string> = new Set([
  ...REFUSED_TRANSITIONS,
  ...STATE_KINDS.flatMap((source) =>
    STATE_KINDS.filter((target) => source !== "comment" || !VERTICES.includes(target)).map(
      (target) => `anchor ${source} ${target}`,
    ),
  ),
]);

/** The activity diagram's executable nodes, the actions, the expansion region, and the
 *  structured, conditional, and loop nodes; its object nodes; its control nodes and the connector;
 *  and what is no node of it: the interruptible region, a group, a parameter set, a comment, and
 *  the frame. */
const ACTIONS = [
  ...["action", "call-behavior-action", "send-signal-action", "accept-event-action"],
  ...["accept-time-event-action", "expansion-region"],
  ...["structured-node", "conditional-node", "loop-node"],
] as const;
const OBJECT_NODES = [
  ...["object-node", "input-pin", "output-pin", "data-store", "central-buffer"],
  ...["expansion-node", "input-parameter", "output-parameter", "value-pin"],
] as const;
const CONTROL_NODES = [
  ...["decision-node", "fork-node", "join-node", "connector"],
  ...["initial-node", "activity-final", "flow-final", "merge-node"],
] as const;
const NO_NODES = [
  ...["interruptible-region", "parameter-set", "activity-comment", "activity-frame"],
] as const;
const ACTIVITY_KINDS = [...ACTIONS, ...OBJECT_NODES, ...CONTROL_NODES, ...NO_NODES] as const;

/** The conventions' table of the activity diagram, each refused pair as "kind source target": a
 *  control or an object flow at a comment, the frame, an interruptible region, or a parameter set,
 *  into an output pin, an input parameter node, an initial node, or a value pin, out of an input
 *  pin, a value pin, an output parameter node, an activity final, or a flow final; a control flow
 *  at an object node (UML 2.5.1, ControlFlow: object_nodes), an object flow at an action or an
 *  expansion region (ObjectFlow: no_executable_nodes) or out of an initial node (InitialNode:
 *  control_edges); an anchor from anything but a comment, or onto a comment. */
const REFUSED_ACTIVITY: ReadonlySet<string> = new Set(
  ["control-flow", "object-flow"]
    .flatMap((kind) =>
      ACTIVITY_KINDS.flatMap((other) => [
        ...NO_NODES.flatMap((no) => [`${kind} ${no} ${other}`, `${kind} ${other} ${no}`]),
        ...["output-pin", "input-parameter", "initial-node", "value-pin"].map(
          (into) => `${kind} ${other} ${into}`,
        ),
        ...["input-pin", "value-pin", "output-parameter", "activity-final", "flow-final"].map(
          (out) => `${kind} ${out} ${other}`,
        ),
        ...(kind === "control-flow"
          ? OBJECT_NODES.flatMap((object) => [
              `${kind} ${object} ${other}`,
              `${kind} ${other} ${object}`,
            ])
          : [
              ...ACTIONS.flatMap((action) => [
                `${kind} ${action} ${other}`,
                `${kind} ${other} ${action}`,
              ]),
              `${kind} initial-node ${other}`,
            ]),
      ]),
    )
    .concat(
      ACTIVITY_KINDS.flatMap((other) => [
        ...ACTIVITY_KINDS.filter((source) => source !== "activity-comment").map(
          (source) => `anchor ${source} ${other}`,
        ),
        `anchor ${other} activity-comment`,
      ]),
    ),
);

test("an object flow at an action says objects pass through its pins, at an expansion region through its expansion nodes", () => {
  for (const target of ["action", "expansion-region"] as const)
    expect(refusal({ source: "object-node", target, kind: "object-flow" })).toBe(
      "UML 2.5.1 lets no object flow touch an action or an expansion region; objects pass through their pins or expansion nodes (no_executable_nodes).",
    );
});

test("a connection between an object node and any other adds an object flow, else a control flow", () => {
  for (const source of ACTIVITY_KINDS)
    for (const target of ACTIVITY_KINDS) {
      const object = [source, target].some((kind) =>
        (OBJECT_NODES as readonly string[]).includes(kind),
      );
      expect({ source, target, kind: flowBetween(source, target) }).toEqual({
        source,
        target,
        kind: object ? "object-flow" : "control-flow",
      });
    }
});

/** The parts of a transition the sidebar edits, by the kinds of its ends: no trigger out of a
 *  pseudostate, nor into a join, and no guard out of an initial pseudostate or a fork, or into a
 *  join (UML 2.5.1, Transition: outgoing_pseudostates, fork_segment_guards, join_segment_guards;
 *  Pseudostate: outgoing_from_initial). */
function partsOf(source: string, target: string): TransitionPart[] {
  const segment = source === "fork" || target === "join";
  const fromPseudostate = (PSEUDOSTATES as readonly string[]).includes(source);
  const parts: TransitionPart[] = [];
  if (!fromPseudostate && !segment) parts.push("trigger");
  if (!segment && source !== "initial") parts.push("guard");
  return [...parts, "effect"];
}

for (const source of STATE_KINDS)
  for (const target of STATE_KINDS)
    test(`a transition from ${source} to ${target} takes ${partsOf(source, target).join(", ")}`, () => {
      expect(transitionParts(source, target)).toEqual(partsOf(source, target));
    });

/** The loops the conventions allow: a transition of a state, a composite state, or a submachine
 *  state back to itself, and no other. */
const LOOPS: readonly string[] = [
  "transition state",
  "transition composite",
  "transition submachine",
];

/** The use case diagram's kinds: an actor, a use case, the subject, and a comment. */
const USE_CASE_KINDS = ["actor", "use-case", "subject", "use-case-comment"] as const;
const USE_CASE_RELATIONSHIPS = [
  "association",
  "include",
  "extend",
  "use-case-generalization",
  "anchor",
] as const;

/** Why the use case diagram refuses a relationship, as docs/CONVENTIONS.md words each reason. */
const WHY = {
  comment:
    "A comment is attached by its anchor; no relationship of the use case diagram starts or ends on it.",
  subject:
    "The subject is the system its use cases belong to; the example draws no relationship to or from it.",
  actors:
    "UML 2.5.1 lets an actor have associations only to use cases, components, and classes (associations).",
  useCases:
    "UML 2.5.1 lets no association join two use cases of the same subject, and the example's use cases are all Comb's (no_association_to_use_case).",
  include:
    "UML 2.5.1 has an include join two use cases, the including one and its addition, and nothing else.",
  extend:
    "UML 2.5.1 has an extend join two use cases, the extending and the extended one, and nothing else.",
  specialize:
    "UML 2.5.1 lets a classifier specialize only one of its own type or a more general one, so an actor an actor and a use case a use case (specialize_type).",
  anchorFrom: "An anchor starts at a comment.",
  anchorOn: "A comment is anchored on an element of the diagram, not on another comment.",
} as const;

/** Why the table refuses a relationship of each kind but an anchor between the ends `ends`, sorted
 *  and joined, from `source` to `target`, once neither is a comment or the subject. */
const BY_KIND: Record<
  string,
  (ends: string, source: string, target: string) => string | undefined
> = {
  association: (ends) =>
    ends === "actor actor" ? WHY.actors : ends === "use-case use-case" ? WHY.useCases : undefined,
  include: (ends) => (ends === "use-case use-case" ? undefined : WHY.include),
  extend: (ends) => (ends === "use-case use-case" ? undefined : WHY.extend),
  "use-case-generalization": (_, source, target) =>
    source === target ? undefined : WHY.specialize,
};

/** Why the table refuses a relationship of `kind` from `source` to `target`, the first reason that
 *  holds, none where it allows it. */
function useCaseRefusal(kind: string, source: string, target: string): string | undefined {
  if (kind === "anchor") {
    if (source !== "use-case-comment") return WHY.anchorFrom;
    return target === "use-case-comment" ? WHY.anchorOn : undefined;
  }
  const ends = [source, target].sort().join(" ");
  if (ends.includes("use-case-comment")) return WHY.comment;
  if (ends.includes("subject")) return WHY.subject;
  return BY_KIND[kind]!(ends, source, target);
}

/** The table of the use case diagram the human settled for ticket 13 of uml-diagrams on
 *  2026-11-18, each refused pair as "kind source target" with why: an association but between an
 *  actor and a use case, in either direction; an include or an extend but between two use cases; a
 *  generalization but from an actor to an actor or from a use case to a use case; an anchor from
 *  anything but a comment, or onto a comment. */
const REFUSED_USE_CASE: ReadonlyMap<string, string> = new Map(
  USE_CASE_RELATIONSHIPS.flatMap((kind) =>
    USE_CASE_KINDS.flatMap((source) =>
      USE_CASE_KINDS.flatMap((target) => {
        const why = useCaseRefusal(kind, source, target);
        return why === undefined ? [] : [[`${kind} ${source} ${target}`, why] as const];
      }),
    ),
  ),
);

/** The loops of the use case diagram and why each is refused, where UML 2.5.1 states it: a use
 *  case that includes itself (UseCase: cannot_include_self) and an actor or a use case that
 *  specializes itself (Classifier: no_cycles_in_generalization); every other loop is the table's
 *  or the example's. */
const USE_CASE_LOOPS: Record<string, string> = {
  "include use-case": "UML 2.5.1 lets no use case include itself (cannot_include_self).",
  "use-case-generalization actor":
    "UML 2.5.1 lets no classifier specialize itself (no_cycles_in_generalization).",
  "use-case-generalization use-case":
    "UML 2.5.1 lets no classifier specialize itself (no_cycles_in_generalization).",
};

test("the node kinds are a class, an interface, an abstract class, a package, and the state, the activity, and the use case diagram's kinds", () => {
  expect([...NODE_KINDS].sort()).toEqual(
    [...CLASSIFIER_KINDS, ...STATE_KINDS, ...ACTIVITY_KINDS, ...USE_CASE_KINDS].sort(),
  );
});

const DIAGRAMS = [
  [CLASSIFIER_KINDS, RELATIONSHIP_KINDS],
  [STATE_KINDS, ["transition", "anchor"]],
  [ACTIVITY_KINDS, ["control-flow", "object-flow", "anchor"]],
  [USE_CASE_KINDS, USE_CASE_RELATIONSHIPS],
] as const;

for (const [nodeKinds, kinds] of DIAGRAMS)
  for (const source of nodeKinds)
    for (const kind of kinds) {
      for (const target of nodeKinds) {
        const key = `${kind} ${source} ${target}`;
        const refused = REFUSED.has(key) || REFUSED_ACTIVITY.has(key) || REFUSED_USE_CASE.has(key);
        test(`${kind} from ${source} to ${target}: ${refused ? "refused, saying why" : "allowed"}`, () => {
          expect(allows({ source, target, kind })).toBe(!refused);
          const why = refusal({ source, target, kind });
          expect(why === undefined ? undefined : typeof why).toBe(refused ? "string" : undefined);
        });
      }
      const loop = LOOPS.includes(`${kind} ${source}`);
      test(`${kind} looping on ${source}: ${loop ? "allowed" : "refused, saying why"}`, () => {
        expect(allows({ source, target: source, kind, loop: true })).toBe(loop);
        expect(refusal({ source, target: source, kind, loop: true }) === undefined).toBe(loop);
        // A loop the table allows between two ends of its kind says what UML 2.5.1 states of it.
        const stated = USE_CASE_LOOPS[`${kind} ${source}`];
        if (stated) expect(refusal({ source, target: source, kind, loop: true })).toBe(stated);
      });
    }

test("each refusal of the activity diagram says why in a sentence of its own, a reason naming UML 2.5.1 naming its constraints", () => {
  const reasons = new Set<string>();
  for (const key of REFUSED_ACTIVITY) {
    const [kind, source, target] = key.split(" ") as ["anchor", never, never];
    reasons.add(refusal({ source, target, kind })!);
  }
  // A comment, the frame, an interruptible region, a parameter set, an output pin, an input pin, an
  // input and an output parameter node, into an initial node or a value pin, out of a final node,
  // a control flow at an object node, an object flow at an action or out of an initial node, an
  // anchor from no comment, and one onto a comment.
  expect(reasons.size).toBe(16);
  for (const reason of reasons) expect(reason).toMatch(/^[A-Z].*\.$/);
  for (const reason of reasons)
    if (reason.includes("UML 2.5.1")) expect(reason).toMatch(/\((\w+_\w+)(, \w+_\w+)*\)\.$/);
});

test("each refusal says why in a sentence of its own, naming UML 2.5.1 or the example", () => {
  const reasons = new Set<string>();
  for (const key of REFUSED) {
    const [kind, source, target] = key.split(" ") as ["transition" | "anchor", never, never];
    reasons.add(refusal({ source, target, kind })!);
  }
  reasons.add(refusal({ source: "class", target: "class", kind: "association", loop: true })!);
  // A comment, the frame, an initial, a final, a terminate, a fork, a join, a trigger out of an
  // initial pseudostate, out of another pseudostate, on a fork's segment, and on a join's, an
  // anchor from no comment, one to no state or pseudostate, and a loop.
  expect(reasons.size).toBe(14);
  for (const reason of reasons) expect(reason).toMatch(/^[A-Z].*\.$/);
  // A reason that names UML 2.5.1 names the constraint it reads there.
  for (const reason of reasons)
    if (reason.includes("UML 2.5.1")) expect(reason).toMatch(/\(\w+_\w+(_\w+)?\)/);
});

test("each refusal of the use case diagram says the reason of the first rule that holds, a constraint of UML 2.5.1 named only where the reason cites one", () => {
  for (const [key, why] of REFUSED_USE_CASE) {
    const [kind, source, target] = key.split(" ") as ["anchor", never, never];
    expect({ key, why: refusal({ source, target, kind }) }).toEqual({ key, why });
  }
  // A comment, the subject, an association between two actors, one between two use cases, an
  // include and an extend at no use case, a generalization between an actor and a use case, an
  // anchor from no comment, and one onto a comment.
  expect(new Set(REFUSED_USE_CASE.values()).size).toBe(9);
});
