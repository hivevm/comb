// The example's copy of the diagram when Comb refuses a part of a sidebar's edit of a pin: the
// activity node the copy keeps holds what Comb holds, its name where Comb took it and `{stream}`
// only where the node of `{stream}` stands, as Comb told it (API-edits-report-nested-changes).
// Verifies: G-20
import { expect, test } from "bun:test";
import type { Comb, GraphChange, NodeData } from "comb";
import { nodesOf } from "./activity";
import { Diagram } from "./diagram";
import { NOTATION_DIAGRAM } from "./notation-diagram";
import type { ActivityNode } from "./shared";

/** A height for any content, as Comb's least height of a node. */
const heightOf: Comb["heightOf"] = () => 64;

/** A diagram of one action and its input pin `p`, streaming where `stream`, kept by a Comb that
 *  tells each change it takes, as Comb's `onChange` does, and throws on adding the node of
 *  `{stream}` beside the pin. */
function diagramOfPin(stream: boolean): Diagram {
  const action: ActivityNode = { id: "act", kind: "action", name: "Act" };
  const pin: ActivityNode = { id: "p", kind: "input-pin", name: "in", ...(stream && { stream }) };
  const place = { attachedTo: "act", side: "right" as const, offset: 40, length: 120 };
  const nodes: NodeData[] = [
    ...nodesOf(action, { x: 200, y: 200 }, heightOf),
    ...nodesOf(pin, place, heightOf),
  ];
  const tell = (change: Partial<GraphChange>) => diagram.mirror(change as GraphChange);
  const comb = {
    load: () => {},
    heightOf,
    updateNode: (id: string, patch: object) => tell({ kind: "nodeUpdated", id, patch }),
    removeNodes: (ids: string[]) => tell({ kind: "nodesRemoved", nodes: ids, edges: [] }),
    addNode: (node: NodeData) => {
      if (node.id === "p-stream") throw new Error("refused");
      tell({ kind: "nodeAdded", node });
    },
  } as unknown as Comb;
  const diagram = new Diagram(comb, NOTATION_DIAGRAM);
  diagram.load(
    {
      graph: { nodes, edges: [] },
      classifiers: new Map(),
      states: new Map(),
      activities: new Map([action, pin].map((each) => [each.id, each])),
      useCases: new Map(),
      kinds: new Map(),
      transitions: new Map(),
      flows: new Map(),
    },
    NOTATION_DIAGRAM,
  );
  return diagram;
}

test("a pin renamed and checked {stream}, whose {stream} Comb refuses, keeps the new name and does not stream", () => {
  const diagram = diagramOfPin(false);
  const refusal = diagram.editActivity("p", {
    id: "p",
    kind: "input-pin",
    name: "x",
    stream: true,
  });
  expect(refusal).toBeDefined();
  expect(diagram.activities.get("p")).toEqual({ id: "p", kind: "input-pin", name: "x" });
  expect(diagram.node("p-stream")).toBeUndefined();
});

test("a streaming pin whose {stream} Comb removes to place it anew, but refuses to add again, no longer streams", () => {
  const diagram = diagramOfPin(true);
  // The node of `{stream}` stands where it is not wanted, so the edit places it anew.
  diagram.node("p-stream")!.offset = 100;
  const refusal = diagram.editActivity("p", {
    id: "p",
    kind: "input-pin",
    name: "in",
    stream: true,
  });
  expect(refusal).toBeDefined();
  expect(diagram.node("p-stream")).toBeUndefined();
  expect(diagram.activities.get("p")).toEqual({ id: "p", kind: "input-pin", name: "in" });
});
