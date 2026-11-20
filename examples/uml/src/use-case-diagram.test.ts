// The use case diagram's building blocks, the veto of a move into the subject, the kind a
// connection adds, the content of a use case, and the multiplicities of an association, against
// what ticket 13 of uml-diagrams settled with the human on 2026-11-18, written here from those
// decisions and docs/CONVENTIONS.md, not read from the example.
// Verifies: G-20
import { expect, test } from "bun:test";
import type { NodeShape } from "comb";
import { multiplicitiesIn, multiplicityLabelsOf, styleOf } from "./relationships";
import { canMoveInto, connectedOf, contentOf, USE_CASE_SHAPES } from "./use-case-diagram";

/** Each kind's node shape, whether it holds nodes, and whether it stands outside the subject: an
 *  actor an `actor` on the canvas, a use case an `ellipse`, the subject a rectangular container,
 *  a comment a `note`. */
const BLOCKS: Record<string, { shape: NodeShape; holds?: true; outside?: true }> = {
  actor: { shape: "actor", outside: true },
  "use-case": { shape: "ellipse" },
  subject: { shape: "rectangle", holds: true },
  "use-case-comment": { shape: "note" },
};

test("each kind of the use case diagram takes the building block settled for it", () => {
  expect(Object.keys(USE_CASE_SHAPES).sort()).toEqual(Object.keys(BLOCKS).sort());
  for (const [kind, block] of Object.entries(BLOCKS)) {
    const { shape, holds, outside } = USE_CASE_SHAPES[kind as keyof typeof USE_CASE_SHAPES];
    expect({ kind, shape, holds, outside }).toEqual({
      kind,
      shape: block.shape,
      holds: block.holds,
      outside: block.outside,
    });
  }
});

test("the example refuses an actor moved into the subject, and allows every other move", () => {
  // Verifies: API-edits-report-nested-changes
  expect(canMoveInto({ node: "user", container: "comb" }, "actor")).toBe(false);
  expect(canMoveInto({ node: "user", container: null }, "actor")).toBe(true);
  expect(canMoveInto({ node: "select", container: "comb" }, "use-case")).toBe(true);
  expect(canMoveInto({ node: "select", container: null }, "use-case")).toBe(true);
  expect(canMoveInto({ node: "note", container: "comb" }, "use-case-comment")).toBe(true);
});

test("a connection adds an anchor from a comment, an association between an actor and a use case, a generalization between two actors, and an include between two use cases", () => {
  expect(connectedOf("use-case-comment", "use-case")).toBe("anchor");
  expect(connectedOf("actor", "use-case")).toBe("association");
  expect(connectedOf("use-case", "actor")).toBe("association");
  expect(connectedOf("actor", "actor")).toBe("use-case-generalization");
  expect(connectedOf("use-case", "use-case")).toBe("include");
  // What the table refuses adds an association, which it refuses at the subject or a comment.
  expect(connectedOf("subject", "use-case")).toBe("association");
  expect(connectedOf("use-case", "use-case-comment")).toBe("association");
});

test("a use case shows its name, and its extension points below a separator", () => {
  const title = (text: string) => [{ kind: "text", role: "title", text } as const];
  expect(contentOf({ id: "a", kind: "use-case", name: "Pan and zoom" })).toEqual([
    title("Pan and zoom"),
  ]);
  expect(
    contentOf({ id: "b", kind: "use-case", name: "Select", points: ["Delete pressed"] }),
  ).toEqual([
    title("Select"),
    "separator",
    [{ kind: "text", role: "caption", text: "extension points" } as const],
    [{ kind: "text", role: "body", text: "Delete pressed" } as const],
  ]);
  // Comb lays out at most eight rows: five extension points, or four and a row of "…".
  const six = ["a", "b", "c", "d", "e", "f"];
  const rows = contentOf({ id: "e", kind: "use-case", name: "Many", points: six });
  expect(rows.length).toBe(8);
  expect(rows.at(-1)).toEqual([{ kind: "text", role: "body", text: "…" }]);
  expect(contentOf({ id: "c", kind: "actor", name: "User" })).toEqual([title("User")]);
  expect(contentOf({ id: "d", kind: "subject", name: "Comb" })).toEqual([title("Comb")]);
});

test("include and extend are dashed with an open arrowhead and their keyword, a generalization solid with a hollow triangle, an association solid without an arrowhead", () => {
  const grey = 0x6b7280;
  for (const [kind, keyword] of [
    ["include", "«include»"],
    ["extend", "«extend»"],
  ] as const)
    expect(styleOf(kind)).toMatchObject({
      color: grey,
      dash: [6, 4],
      arrow: "open",
      labels: [{ text: keyword }],
    });
  expect(styleOf("use-case-generalization")).toEqual({ color: 0x1d4ed8, arrow: "hollow" });
  expect(styleOf("association")).toEqual({ color: grey, arrow: "none" });
});

test("an association's multiplicities stand at the path parameters 0.1 and 0.9, and are read back from its labels", () => {
  const labels = multiplicityLabelsOf({ source: "1", target: "0..*" });
  expect(labels).toEqual([
    { id: "source-multiplicity", text: "1", t: 0.1, offset: 0 },
    { id: "target-multiplicity", text: "0..*", t: 0.9, offset: 0 },
  ]);
  expect(multiplicitiesIn({ labels })).toEqual({ source: "1", target: "0..*" });
  // A multiplicity left empty has no label; one the user moved keeps its place.
  const moved = [{ id: "target-multiplicity", text: "0..*", t: 0.8, offset: 12 }];
  expect(multiplicityLabelsOf({ target: "*" }, moved)).toEqual([
    { id: "target-multiplicity", text: "*", t: 0.8, offset: 12 },
  ]);
  expect(multiplicitiesIn({})).toEqual({});
});
