// The types of what Comb's errors carry, as a host application imports them from `comb` (Q-3):
// the kinds of `GraphDataProblem` are those `load`, `updateNode`, and `addNode` throw, and only
// those, so that a `switch` on `problem.kind` without a `default` covers them. The type check
// decides it: the table below holds one handler per kind, each handed the fields of its kind, and
// it lacks one for a kind the union gains and holds one for a kind it loses, which the type check
// refuses either way. A `switch` of a case per kind would decide the same but lies beyond the lint's
// bound on complexity. The browser test of every kind shows that each is thrown.
// Verifies: Q-3, ADR-0010
import { describe, expect, test } from "bun:test";
import {
  EngineSourceError,
  GraphDataError,
  type EngineSourceProblem,
  type GraphDataProblem,
} from ".";

type Kind = GraphDataProblem["kind"];

/** The problem of kind `K`, with the fields of its kind. */
type Of<K extends Kind> = Extract<GraphDataProblem, { kind: K }>;

/** What a host application tells its user, by kind. */
const DESCRIBE: { [K in Kind]: (problem: Of<K>) => string } = {
  malformed: (p) => p.message,
  invalidField: (p) => `${p.list} ${p.index} ${p.id ?? "-"} ${p.field}: ${p.expected}`,
  nonFiniteCoordinate: (p) => p.node,
  invalidSize: (p) => p.node,
  invalidTitle: (p) => p.node,
  titleTooLong: (p) => `${p.node} ${p.limit}`,
  unknownPatchField: (p) => `${p.node} ${p.field}`,
  duplicateNode: (p) => p.node,
  duplicateEdge: (p) => p.edge,
  missingNode: (p) => `${p.edge} ${p.node}`,
  nonFiniteLabel: (p) => p.edge,
  invalidLabelText: (p) => p.edge,
  labelTextTooLong: (p) => `${p.edge} ${p.limit}`,
  invalidBackground: (p) => p.edge,
  invalidColor: (p) => p.edge,
  invalidDash: (p) => p.edge,
  tooMany: (p) => `${p.list} ${p.limit}`,
  idTooLong: (p) => `${p.list} ${p.index} ${p.field} ${p.limit}`,
  idBudgetExceeded: (p) => `${p.limit}`,
  unknownNode: (p) => p.node,
  unknownEdge: (p) => p.edge,
  selfEdge: (p) => p.edge,
  unknownEdgePatchField: (p) => `${p.edge} ${p.field}`,
};

/** `problem` described by the handler of its kind. */
function describeProblem<K extends Kind>(problem: Of<K>): string {
  return (DESCRIBE[problem.kind as K] as (problem: Of<K>) => string)(problem);
}

/** What a host application tells its user, for every reason to refuse an engine: a `switch`
 *  without a `default`, which the type check refuses where a reason is missing. */
function describeReason(reason: EngineSourceProblem): string {
  switch (reason) {
    case "missing":
      return "no engine";
    case "fetchable":
      return "an engine to fetch";
    case "invalid":
      return "no engine to instantiate";
  }
}

describe("the types of Comb's errors", () => {
  test("a host application handles every kind of the problem of a GraphDataError", () => {
    const unknown = new GraphDataError({ kind: "unknownNode", node: "a" });
    expect(describeProblem(unknown.problem)).toBe("a");
    const field = new GraphDataError({
      kind: "invalidField",
      list: "nodes",
      index: 0,
      field: "id",
      expected: "a string",
    });
    expect(describeProblem(field.problem)).toBe("nodes 0 - id: a string");
  });

  test("a host application switches on the reason of an EngineSourceError without a default", () => {
    expect(describeReason(new EngineSourceError("fetchable").reason)).toBe("an engine to fetch");
  });
});
