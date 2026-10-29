// The snapshot hands over a string with a lone surrogate as `false`, which the bridge refuses, and
// every other string as it is, a well-formed surrogate pair among them (ADR-0028): the cheap test
// for any surrogate before the search for a lone one changes neither.
import { expect, test } from "bun:test";
import { edgeSnapshotOf, nodeSnapshotOf } from "./snapshot";

const limits = { text: 1000, id: 256, idBudget: 64_000_000 };

const cases: [name: string, value: string, read: string | false][] = [
  ["a lone high surrogate at the end", "ab\uD83D", false],
  ["a lone low surrogate at the start", "\uDE00ab", false],
  ["a well-formed pair", "a😀b", "a😀b"],
  ["no surrogate", "ab", "ab"],
];

for (const [name, value, read] of cases) {
  test(`the snapshot reads an identifier and a text with ${name}`, () => {
    // Verifies: ADR-0028
    const node = nodeSnapshotOf(
      { id: value, title: value, x: 0, y: 0, width: 1, height: 1 },
      limits,
    );
    expect(node.snapshot).toMatchObject({ id: read, title: read });
    const edge = edgeSnapshotOf(
      { id: value, source: "a", target: "b", label: { text: value, t: 0.5, offset: 0 } },
      limits,
    );
    expect(edge.snapshot).toMatchObject({ id: read, label: { text: read } });
  });
}
