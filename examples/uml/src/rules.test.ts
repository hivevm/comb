// The rules of connection of the example's diagrams against the table docs/CONVENTIONS.md records,
// over every pair of node kinds of a diagram and every relationship kind it adds, and over every
// loop. The table is written here from the conventions, not read from the rules.
// Verifies: G-12
import { expect, test } from "bun:test";
import { allows } from "./rules";
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
const STATE_KINDS = ["state", "initial", "final", "choice"] as const;

/** The conventions' table: between a class, an interface, an abstract class, and a package, in
 *  either direction, every kind of relationship is allowed; between the kinds of state, a
 *  transition is refused into an initial state and out of a final state. No case is needed of a
 *  class, a package, and a state together, which never share a diagram. */
const REFUSED: readonly string[] = [
  ...STATE_KINDS.map((source) => `transition ${source} initial`),
  ...STATE_KINDS.map((target) => `transition final ${target}`),
];

/** The loops the conventions allow: a transition of a state back to itself, and no other. */
const LOOPS: readonly string[] = ["transition state"];

test("the node kinds are a class, an interface, an abstract class, a package, and the kinds of state", () => {
  expect([...NODE_KINDS].sort()).toEqual([...CLASSIFIER_KINDS, ...STATE_KINDS].sort());
});

const DIAGRAMS = [
  [CLASSIFIER_KINDS, RELATIONSHIP_KINDS],
  [STATE_KINDS, ["transition"]],
] as const;

for (const [nodeKinds, kinds] of DIAGRAMS)
  for (const source of nodeKinds)
    for (const kind of kinds) {
      for (const target of nodeKinds) {
        const refused = REFUSED.includes(`${kind} ${source} ${target}`);
        test(`${kind} from ${source} to ${target}: ${refused ? "refused" : "allowed"}`, () => {
          expect(allows({ source, target, kind })).toBe(!refused);
        });
      }
      const loop = LOOPS.includes(`${kind} ${source}`);
      test(`${kind} looping on ${source}: ${loop ? "allowed" : "refused"}`, () => {
        expect(allows({ source, target: source, kind, loop: true })).toBe(loop);
      });
    }
