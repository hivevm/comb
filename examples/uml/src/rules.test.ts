// The rules of connection of the class diagram against the table docs/CONVENTIONS.md records,
// over every pair of node kinds and every relationship kind. The table is written here from the
// conventions, not read from the rules.
// Verifies: G-12
import { expect, test } from "bun:test";
import { allows, NODE_KINDS } from "./rules";

const RELATIONSHIP_KINDS = [
  "association",
  "directed-association",
  "generalization",
  "realization",
  "dependency",
  "aggregation",
  "composition",
] as const;

/** The conventions' table: between a class, an interface, and an abstract class, in either
 *  direction, every kind of relationship is allowed; none is refused. */
const REFUSED: readonly string[] = [];

test("the node kinds are a class, an interface, and an abstract class", () => {
  expect([...NODE_KINDS].sort()).toEqual(["abstract-class", "class", "interface"]);
});

for (const source of ["class", "interface", "abstract-class"] as const)
  for (const target of ["class", "interface", "abstract-class"] as const)
    for (const kind of RELATIONSHIP_KINDS) {
      const refused = REFUSED.includes(`${kind} ${source} ${target}`);
      test(`${kind} from ${source} to ${target}: ${refused ? "refused" : "allowed"}`, () => {
        expect(allows({ source, target, kind })).toBe(!refused);
      });
    }
