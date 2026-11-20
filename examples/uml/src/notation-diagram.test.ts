// G-20's list of the elements an activity diagram of the example shows, one entry per element,
// written here from the specification, not read from the example: each appears at least once in
// the activity diagram of a load or in the notation diagram, told by the kind the example gives
// each node and edge, and where the element is a part of one, by that part.
// Verifies: G-20
import { expect, test } from "bun:test";
import type { Comb, RegionData } from "comb";
import { companionsOf } from "./activity";
import { activityDiagram } from "./activity-diagram";
import { notationDiagram } from "./notation-diagram";
import type { DiagramData } from "./shared";

/** A height for any content, as Comb's least height of a node. */
const heightOf: Comb["heightOf"] = () => 64;

/** Whether `data` holds a node of the kind `kind`. */
const node = (kind: string) => (data: DiagramData) =>
  [...data.activities.values()].some((each) => each.kind === kind);

/** Whether `data` holds an edge of the kind `kind`. */
const edge = (kind: string) => (data: DiagramData) =>
  [...data.kinds.values()].some((each) => each === kind);

/** The partitions of the frames of `data`, at any depth, each with its depth. */
function partitionsIn(data: DiagramData): { region: RegionData; depth: number }[] {
  const within = (regions: readonly RegionData[], depth: number): ReturnType<typeof partitionsIn> =>
    regions.flatMap((region) => [{ region, depth }, ...within(region.regions ?? [], depth + 1)]);
  return data.graph.nodes
    .filter(({ id }) => data.activities.get(id)?.kind === "activity-frame")
    .flatMap((frame) => (frame.attachedTo === undefined ? within(frame.regions ?? [], 0) : []));
}

/** G-20's elements of the activity diagram, in its order, each with how a diagram shows it. */
const G20: readonly [string, (data: DiagramData) => boolean][] = [
  ["action", node("action")],
  ["call behavior action", node("call-behavior-action")],
  ["send signal action", node("send-signal-action")],
  ["accept event action", node("accept-event-action")],
  ["accept time event action", node("accept-time-event-action")],
  ["structured activity node", node("structured-node")],
  ["conditional node", node("conditional-node")],
  ["loop node", node("loop-node")],
  ["object node", node("object-node")],
  ["data store", node("data-store")],
  ["central buffer", node("central-buffer")],
  ["pin", (data) => node("input-pin")(data) || node("output-pin")(data)],
  ["value pin", node("value-pin")],
  [
    "activity parameter node",
    (data) => node("input-parameter")(data) || node("output-parameter")(data),
  ],
  ["parameter set", node("parameter-set")],
  ["streaming parameter", (data) => [...data.activities.values()].some((each) => each.stream)],
  ["initial node", node("initial-node")],
  ["activity final node", node("activity-final")],
  ["flow final node", node("flow-final")],
  ["decision node", node("decision-node")],
  ["merge node", node("merge-node")],
  ["fork node", node("fork-node")],
  ["join node", node("join-node")],
  ["control flow", edge("control-flow")],
  ["object flow", edge("object-flow")],
  ["guard", (data) => [...data.flows.values()].some((flow) => flow.guard)],
  ["weight", (data) => [...data.flows.values()].some((flow) => flow.weight)],
  ["activity partition", (data) => partitionsIn(data).length > 0],
  ["nested activity partition", (data) => partitionsIn(data).some(({ depth }) => depth > 0)],
  ["interruptible activity region", node("interruptible-region")],
  ["interrupting edge", edge("interrupting-edge")],
  ["expansion region", node("expansion-region")],
  ["expansion node", node("expansion-node")],
  ["exception handler", edge("exception-handler")],
  ["connector", node("connector")],
  ["frame of the activity", node("activity-frame")],
  ["comment", node("activity-comment")],
  ["comment's anchor", edge("anchor")],
];

const DIAGRAMS = { load: activityDiagram(heightOf), notation: notationDiagram(heightOf) };

for (const [element, shows] of G20)
  test(`the activity diagram of a load or the notation diagram shows a ${element}`, () => {
    const showing = Object.entries(DIAGRAMS)
      .filter(([, data]) => shows(data))
      .map(([name]) => name);
    expect({ element, shown: showing.length > 0 }).toEqual({ element, shown: true });
  });

test("the notation diagram holds the elements of G-20 the load does not", () => {
  const missing = G20.filter(([, shows]) => !shows(DIAGRAMS.load)).map(([element]) => element);
  expect(missing).toEqual([
    "structured activity node",
    "conditional node",
    "loop node",
    "value pin",
    "parameter set",
    "streaming parameter",
    "initial node",
    "activity final node",
    "flow final node",
    "merge node",
    "nested activity partition",
  ]);
  for (const [element, shows] of G20.filter(([name]) => missing.includes(name)))
    expect({ element, shown: shows(DIAGRAMS.notation) }).toEqual({ element, shown: true });
});

test("a streaming pin's name and {stream}, and a value pin's value and its {stream}, go with their pin", () => {
  expect(companionsOf({ id: "p", kind: "output-pin", name: "point", stream: true })).toEqual([
    "p-name",
    "p-stream",
  ]);
  expect(companionsOf({ id: "p", kind: "input-pin", name: "x" })).toEqual(["p-name"]);
  expect(companionsOf({ id: "v", kind: "value-pin", value: "null" })).toEqual(["v-value"]);
  expect(companionsOf({ id: "v", kind: "value-pin", value: "0", stream: true })).toEqual([
    "v-value",
    "v-stream",
  ]);
});
