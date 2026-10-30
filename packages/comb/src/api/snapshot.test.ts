// The snapshot hands over a string with a lone surrogate as `false`, which the bridge refuses, and
// every other string as it is, a well-formed surrogate pair among them (ADR-0028).
import { expect, test } from "bun:test";
import { edgeSnapshotOf, listsOf, nodeSnapshotOf, snapshotOf } from "./snapshot";

const limits = {
  text: 1000,
  id: 256,
  idBudget: 64_000_000,
  contentBudget: 1e9,
  rows: 8,
  columns: 6,
};

const cases: [name: string, value: string, read: string | false][] = [
  ["a lone high surrogate at the end", "ab\uD83D", false],
  ["a lone low surrogate at the start", "\uDE00ab", false],
  ["a well-formed pair", "a😀b", "a😀b"],
  ["no surrogate", "ab", "ab"],
];

for (const [name, value, read] of cases) {
  test(`the snapshot reads an identifier and a text with ${name}`, () => {
    // Verifies: ADR-0028
    const content = [[{ kind: "text", role: "title", text: value }]];
    const node = nodeSnapshotOf({ id: value, x: 0, y: 0, width: 1, content }, limits);
    const title = { kind: "text", role: "title", text: read };
    expect(node.snapshot).toMatchObject({ id: read, content: [[title]] });
    const edge = edgeSnapshotOf(
      { id: value, source: "a", target: "b", label: { text: value, t: 0.5, offset: 0 } },
      limits,
    );
    expect(edge.snapshot).toMatchObject({ id: read, label: { text: read } });
  });
}

test("the snapshot of a load stops reading once its texts of content pass the budget", () => {
  // Verifies: ADR-0034, Q-7
  // A budget of 5 code units: node n0's texts of 2 and 3 hold it, n1's of 1 passes it, and n2 is
  // not read at all.
  const text = (value: string) => ({ kind: "text", role: "title", text: value });
  const nodes = [
    { id: "n0", x: 0, y: 0, width: 1, content: [[text("aa"), text("aaa")]] },
    { id: "n1", x: 0, y: 0, width: 1, content: [[text("b")]] },
    {
      id: "n2",
      x: 0,
      y: 0,
      width: 1,
      get content(): never {
        throw new Error("read past the budget");
      },
    },
  ];
  const { kept, content } = snapshotOf(listsOf({ nodes, edges: [] } as never), {
    ...limits,
    contentBudget: 5,
  });
  expect(kept.nodes.map((node) => node && node.id)).toEqual(["n0", "n1"]);
  expect(content).toEqual({ units: 6, past: "n1" });
  // Within it, reading goes on.
  const within = snapshotOf(listsOf({ nodes: nodes.slice(0, 2), edges: [] } as never), {
    ...limits,
    contentBudget: 6,
  });
  expect(within.content).toEqual({ units: 6, past: undefined });
});
