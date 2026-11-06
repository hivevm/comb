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

/** The conventions' table: between a class, an interface, an abstract class, and a package, in
 *  either direction, every kind of relationship is allowed; none is refused. No case is needed of
 *  a node with itself, which `Diagram.allows` refuses before it asks the rules, nor of a class and
 *  a package, which never share a diagram. */
const REFUSED: readonly string[] = [];

const KINDS_OF_NODE = ["class", "interface", "abstract-class", "package"] as const;

test("the node kinds are a class, an interface, an abstract class, and a package", () => {
  expect([...NODE_KINDS].sort()).toEqual([...KINDS_OF_NODE].sort());
});

for (const source of KINDS_OF_NODE)
  for (const target of KINDS_OF_NODE)
    for (const kind of RELATIONSHIP_KINDS) {
      const refused = REFUSED.includes(`${kind} ${source} ${target}`);
      test(`${kind} from ${source} to ${target}: ${refused ? "refused" : "allowed"}`, () => {
        expect(allows({ source, target, kind })).toBe(!refused);
      });
    }
