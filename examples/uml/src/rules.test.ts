// The rules of connection of the example's diagrams against the table docs/CONVENTIONS.md records,
// over every pair of node kinds of a diagram and every relationship kind it adds, and over every
// loop. The table is written here from the conventions, not read from the rules.
// Verifies: G-12, G-20
import { expect, test } from "bun:test";
import { allows, refusal, transitionParts, type TransitionPart } from "./rules";
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

test("the node kinds are a class, an interface, an abstract class, a package, and the state diagram's kinds", () => {
  expect([...NODE_KINDS].sort()).toEqual([...CLASSIFIER_KINDS, ...STATE_KINDS].sort());
});

const DIAGRAMS = [
  [CLASSIFIER_KINDS, RELATIONSHIP_KINDS],
  [STATE_KINDS, ["transition", "anchor"]],
] as const;

for (const [nodeKinds, kinds] of DIAGRAMS)
  for (const source of nodeKinds)
    for (const kind of kinds) {
      for (const target of nodeKinds) {
        const refused = REFUSED.has(`${kind} ${source} ${target}`);
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
      });
    }

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
