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

/** Why the state diagram refuses a transition, an anchor, or a loop, as docs/CONVENTIONS.md words
 *  each reason. */
const STATE_WHY = {
  comment: "A comment is attached by its anchor; no transition starts or ends on it.",
  frame: "The frame of the state machine is no vertex; no transition starts or ends on it.",
  initial: "An initial pseudostate starts its region; no transition enters it.",
  final: "UML 2.5.1 lets no transition leave a final state (no_outgoing_transitions).",
  terminate: "A terminate pseudostate ends the state machine; no transition leaves it.",
  forkState: "UML 2.5.1 lets a fork's transitions enter states only (fork_segment_state).",
  joinState: "UML 2.5.1 lets only transitions from states enter a join (join_segment_state).",
  forkTrigger:
    "UML 2.5.1 gives a fork's transition no trigger, and a receive signal is one (fork_segment_guards).",
  joinTrigger:
    "UML 2.5.1 gives a transition into a join no trigger, and a receive signal is one (join_segment_guards).",
  initialTrigger:
    "UML 2.5.1 gives an initial pseudostate's transition no trigger, and a receive signal is one (outgoing_from_initial).",
  pseudostateTrigger:
    "UML 2.5.1 gives a transition out of a pseudostate no trigger, and a receive signal is one (outgoing_pseudostates).",
  anchorFrom: "An anchor starts at a comment.",
  anchorOn: "A comment is anchored on a state or a pseudostate.",
  loop: "Only a state's transition leads back to it; no other relationship of a node with itself is drawn.",
} as const;

const isPseudostate = (kind: string) => (PSEUDOSTATES as readonly string[]).includes(kind);
/** The states and the pseudostates, which an anchor may end on. */
const VERTICES: readonly string[] = [...STATES, ...PSEUDOSTATES];

/** A rule of a table: whether it refuses a relationship from `source` to `target`, and why. */
type Rule = readonly [(source: string, target: string) => boolean, string];

/** The reason of the first of `rules` that holds from `source` to `target`, none where none
 *  does. */
const firstHolding = (rules: readonly Rule[], source: string, target: string) =>
  rules.find(([holds]) => holds(source, target))?.[1];

const STATE_TRANSITION: readonly Rule[] = [
  [(source, target) => source === "comment" || target === "comment", STATE_WHY.comment],
  [(source, target) => source === "frame" || target === "frame", STATE_WHY.frame],
  [(_, target) => target === "initial", STATE_WHY.initial],
  [(source) => source === "final", STATE_WHY.final],
  [(source) => source === "terminate", STATE_WHY.terminate],
  [(source, target) => source === "fork" && isPseudostate(target), STATE_WHY.forkState],
  [(source, target) => target === "join" && isPseudostate(source), STATE_WHY.joinState],
  [(source, target) => source === "fork" && target === "receive-signal", STATE_WHY.forkTrigger],
  [(source, target) => source === "receive-signal" && target === "join", STATE_WHY.joinTrigger],
  [
    (source, target) => source === "initial" && target === "receive-signal",
    STATE_WHY.initialTrigger,
  ],
  [
    (source, target) => isPseudostate(source) && target === "receive-signal",
    STATE_WHY.pseudostateTrigger,
  ],
];
const STATE_ANCHOR: readonly Rule[] = [
  [(source) => source !== "comment", STATE_WHY.anchorFrom],
  [(_, target) => !VERTICES.includes(target), STATE_WHY.anchorOn],
];

/** Why the conventions' table refuses a transition or an anchor from `source` to `target`, the
 *  first reason that holds, none where it allows it: a transition at a comment or the frame, into
 *  an initial pseudostate, out of a final state or a terminate pseudostate, out of a fork into a
 *  pseudostate, into a join out of a pseudostate, and, since a receive signal symbol is its
 *  transition's trigger, out of a fork into one, out of one into a join, and out of a pseudostate
 *  into one (UML 2.5.1, Transition: fork_segment_state, join_segment_state, outgoing_pseudostates,
 *  fork_segment_guards, join_segment_guards; Pseudostate: outgoing_from_initial); an anchor but
 *  from a comment to a state or a pseudostate. */
function stateRefusal(kind: string, source: string, target: string): string | undefined {
  return firstHolding(kind === "anchor" ? STATE_ANCHOR : STATE_TRANSITION, source, target);
}

/** The refusals of `why` between every two of `kinds` for each of `relationships`, as
 *  "kind source target" with why. */
function tableOf(
  kinds: readonly string[],
  relationships: readonly string[],
  why: (kind: string, source: string, target: string) => string | undefined,
): ReadonlyMap<string, string> {
  return new Map(
    relationships.flatMap((kind) =>
      kinds.flatMap((source) =>
        kinds.flatMap((target) => {
          const reason = why(kind, source, target);
          return reason === undefined ? [] : [[`${kind} ${source} ${target}`, reason] as const];
        }),
      ),
    ),
  );
}

/** The conventions' table of the state diagram, each refused pair as "kind source target" with
 *  why; between a class, an interface, an abstract class, and a package, in either direction, it
 *  refuses none. */
const REFUSED = tableOf(STATE_KINDS, ["transition", "anchor"], stateRefusal);

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

/** Why the activity diagram refuses a flow, an exception handler, or an anchor, as
 *  docs/CONVENTIONS.md words each reason. */
const ACTIVITY_WHY = {
  comment: "A comment is attached by its anchor; no flow starts or ends on it.",
  frame: "The frame of the activity is no node; no flow starts or ends on it.",
  region: "An interruptible region groups nodes and is none; no flow starts or ends on it.",
  parameterSet:
    "A parameter set groups the parameters of its pins and is no node; no flow starts or ends on it.",
  initialIn: "UML 2.5.1 lets no flow enter an initial node (no_incoming_edges).",
  finalOut:
    "UML 2.5.1 lets no flow leave an activity final or a flow final node (no_outgoing_edges).",
  valuePinIn: "UML 2.5.1 lets no flow enter a value pin (no_incoming_edges).",
  outputPinIn:
    "UML 2.5.1 lets no flow enter an output pin of an action (incoming_edges_structured_only).",
  inputPinOut:
    "UML 2.5.1 lets no flow leave an input pin of an action (outgoing_edges_structured_only).",
  inputParameterIn:
    "UML 2.5.1 lets no flow enter an input activity parameter node (no_edges, no_outgoing_edges).",
  outputParameterOut:
    "UML 2.5.1 lets no flow leave an output activity parameter node (no_edges, no_incoming_edges).",
  objectNodes:
    "UML 2.5.1 lets a control flow touch an object node only of a control type (object_nodes).",
  executableNodes:
    "UML 2.5.1 lets no object flow touch an action or an expansion region; objects pass through their pins or expansion nodes (no_executable_nodes).",
  controlEdges: "UML 2.5.1 lets only control flows leave an initial node (control_edges).",
  handlerFrom: "An exception handler starts at the action it protects; it protects no other node.",
  handlerOn:
    "An exception handler ends on the input pin that takes the exception into its handler's body.",
  anchorFrom: "An anchor starts at a comment.",
  anchorOn: "A comment is anchored on an element of the activity, not on another comment.",
} as const;

/** The object flow or the control flow a connection between `source` and `target` adds, as the
 *  conventions say: an object flow where an end is an object node. */
const flowOf = (source: string, target: string) =>
  [source, target].some((kind) => (OBJECT_NODES as readonly string[]).includes(kind))
    ? "object-flow"
    : "control-flow";

/** Whether `source` or `target` is one of `kinds`. */
const touches = (kinds: readonly string[], source: string, target: string) =>
  kinds.includes(source) || kinds.includes(target);

/** What the conventions refuse of a control and of an object flow alike. */
const FLOW: readonly Rule[] = [
  [(source, target) => touches(["activity-comment"], source, target), ACTIVITY_WHY.comment],
  [(source, target) => touches(["activity-frame"], source, target), ACTIVITY_WHY.frame],
  [(source, target) => touches(["interruptible-region"], source, target), ACTIVITY_WHY.region],
  [(source, target) => touches(["parameter-set"], source, target), ACTIVITY_WHY.parameterSet],
  [(_, target) => target === "initial-node", ACTIVITY_WHY.initialIn],
  [(source) => source === "activity-final" || source === "flow-final", ACTIVITY_WHY.finalOut],
  [(_, target) => target === "value-pin", ACTIVITY_WHY.valuePinIn],
  [(_, target) => target === "output-pin", ACTIVITY_WHY.outputPinIn],
  [(source) => source === "input-pin" || source === "value-pin", ACTIVITY_WHY.inputPinOut],
  [(_, target) => target === "input-parameter", ACTIVITY_WHY.inputParameterIn],
  [(source) => source === "output-parameter", ACTIVITY_WHY.outputParameterOut],
];

/** The rules of the activity diagram by the kind of relationship, an interrupting edge's being
 *  those of the flow between its ends. */
const ACTIVITY_RULES: Record<string, readonly Rule[]> = {
  "control-flow": [
    ...FLOW,
    [(source, target) => touches(OBJECT_NODES, source, target), ACTIVITY_WHY.objectNodes],
  ],
  "object-flow": [
    ...FLOW,
    [(source, target) => touches(ACTIONS, source, target), ACTIVITY_WHY.executableNodes],
    [(source) => source === "initial-node", ACTIVITY_WHY.controlEdges],
  ],
  "exception-handler": [
    [(source) => !(ACTIONS as readonly string[]).includes(source), ACTIVITY_WHY.handlerFrom],
    [(_, target) => target !== "input-pin", ACTIVITY_WHY.handlerOn],
  ],
  anchor: [
    [(source) => source !== "activity-comment", ACTIVITY_WHY.anchorFrom],
    [(_, target) => target === "activity-comment", ACTIVITY_WHY.anchorOn],
  ],
};

/** Why the conventions' table of the activity diagram refuses a relationship of `kind` from
 *  `source` to `target`, the first reason that holds, none where it allows it: a control or an
 *  object flow at a comment, the frame, an interruptible region, or a parameter set, into an
 *  initial node, out of an activity final or a flow final, into a value pin, into an output pin,
 *  out of an input pin or a value pin, into an input parameter node, or out of an output one; a
 *  control flow at an object node (UML 2.5.1, ControlFlow: object_nodes), an object flow at an
 *  action or an expansion region (ObjectFlow: no_executable_nodes) or out of an initial node
 *  (InitialNode: control_edges); an interrupting edge where the flow between its ends is refused,
 *  for the same reason, being that flow interrupting its region; an exception handler but from an
 *  action, which it protects, to an input pin, which takes the exception into its handler's body;
 *  an anchor from anything but a comment, or onto a comment. */
function activityRefusal(kind: string, source: string, target: string): string | undefined {
  if (kind === "interrupting-edge") return activityRefusal(flowOf(source, target), source, target);
  return firstHolding(ACTIVITY_RULES[kind]!, source, target);
}

/** The conventions' table of the activity diagram, each refused pair as "kind source target" with
 *  why. */
const REFUSED_ACTIVITY = tableOf(
  ACTIVITY_KINDS,
  ["control-flow", "object-flow", "interrupting-edge", "exception-handler", "anchor"],
  activityRefusal,
);

test("the flow's kind select offers, of the control flow, the object flow, the interrupting edge, and the exception handler, those the table allows between its ends", () => {
  const FLOW_KINDS = ["control-flow", "object-flow", "interrupting-edge", "exception-handler"];
  const offered = (source: string, target: string) =>
    FLOW_KINDS.filter((kind) => allows({ source, target, kind } as Parameters<typeof allows>[0]));
  expect(offered("action", "send-signal-action")).toEqual(["control-flow", "interrupting-edge"]);
  expect(offered("output-pin", "object-node")).toEqual(["object-flow", "interrupting-edge"]);
  expect(offered("action", "input-pin")).toEqual(["exception-handler"]);
  expect(offered("input-pin", "action")).toEqual([]);
});

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
const REFUSED_USE_CASE = tableOf(USE_CASE_KINDS, USE_CASE_RELATIONSHIPS, useCaseRefusal);

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
  [
    ACTIVITY_KINDS,
    ["control-flow", "object-flow", "interrupting-edge", "exception-handler", "anchor"],
  ],
  [USE_CASE_KINDS, USE_CASE_RELATIONSHIPS],
] as const;

/** Why the tables refuse the relationship of `kind` from `source` to `target`, none where they
 *  allow it. */
const tableRefusal = (kind: string, source: string, target: string) => {
  const key = `${kind} ${source} ${target}`;
  return REFUSED.get(key) ?? REFUSED_ACTIVITY.get(key) ?? REFUSED_USE_CASE.get(key);
};

/** Why the conventions refuse a loop of `kind` on `source`, none where they allow it: the table's
 *  reason where it refuses the pair, what UML 2.5.1 states of it where it does, and else the
 *  example's rule that only a state's transition leads back to it. */
const loopRefusal = (kind: string, source: string) =>
  LOOPS.includes(`${kind} ${source}`)
    ? undefined
    : (tableRefusal(kind, source, source) ?? USE_CASE_LOOPS[`${kind} ${source}`] ?? STATE_WHY.loop);

for (const [nodeKinds, kinds] of DIAGRAMS)
  for (const source of nodeKinds)
    for (const kind of kinds) {
      for (const target of nodeKinds) {
        const why = tableRefusal(kind, source, target);
        test(`${kind} from ${source} to ${target}: ${why ? "refused, saying why" : "allowed"}`, () => {
          expect(allows({ source, target, kind })).toBe(why === undefined);
          expect(refusal({ source, target, kind })).toBe(why);
        });
      }
      const why = loopRefusal(kind, source);
      test(`${kind} looping on ${source}: ${why ? "refused, saying why" : "allowed"}`, () => {
        expect(allows({ source, target: source, kind, loop: true })).toBe(why === undefined);
        expect(refusal({ source, target: source, kind, loop: true })).toBe(why);
      });
    }

test("each refusal of the activity diagram says the reason of the first rule that holds, each reason of its table said for some pair, a reason naming UML 2.5.1 naming its constraints", () => {
  for (const [key, why] of REFUSED_ACTIVITY) {
    const [kind, source, target] = key.split(" ") as ["anchor", never, never];
    expect({ key, why: refusal({ source, target, kind }) }).toEqual({ key, why });
  }
  const reasons = Object.values(ACTIVITY_WHY);
  expect(new Set(REFUSED_ACTIVITY.values())).toEqual(new Set(reasons));
  // A comment, the frame, an interruptible region, a parameter set, an output pin, an input pin, an
  // input and an output parameter node, into an initial node or a value pin, out of a final node,
  // a control flow at an object node, an object flow at an action or out of an initial node, an
  // anchor from no comment, one onto a comment, and an exception handler from no action or onto no
  // input pin.
  expect(new Set(reasons).size).toBe(18);
  for (const reason of reasons) expect(reason).toMatch(/^[A-Z].*\.$/);
  for (const reason of reasons)
    if (reason.includes("UML 2.5.1")) expect(reason).toMatch(/\((\w+_\w+)(, \w+_\w+)*\)\.$/);
});

test("each refusal of the state diagram says the reason of the first rule that holds, each reason of its table said for some pair or loop, naming UML 2.5.1 or the example", () => {
  for (const [key, why] of REFUSED) {
    const [kind, source, target] = key.split(" ") as ["transition" | "anchor", never, never];
    expect({ key, why: refusal({ source, target, kind }) }).toEqual({ key, why });
  }
  const loops = STATE_KINDS.flatMap((source) =>
    ["transition", "anchor"].map((kind) => loopRefusal(kind, source)),
  );
  const reasons = Object.values(STATE_WHY);
  expect(new Set([...REFUSED.values(), ...loops.filter((why) => why !== undefined)])).toEqual(
    new Set(reasons),
  );
  // A comment, the frame, an initial, a final, a terminate, a fork, a join, a trigger out of an
  // initial pseudostate, out of another pseudostate, on a fork's segment, and on a join's, an
  // anchor from no comment, one to no state or pseudostate, and a loop.
  expect(new Set(reasons).size).toBe(14);
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
  expect(new Set(REFUSED_USE_CASE.values())).toEqual(new Set(Object.values(WHY)));
  expect(new Set(REFUSED_USE_CASE.values()).size).toBe(9);
});
