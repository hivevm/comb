// The type checker refuses every write through GraphView (ADR-0026): each line below is a write
// that must not compile, and `tsc` fails on a `@ts-expect-error` that has no error to expect.
import { expect, test } from "bun:test";
import type { GraphView } from ".";

function writes(state: GraphView): void {
  // @ts-expect-error the node list is read-only
  state.nodes.push({ id: "x", title: "x", width: 1, height: 1 });
  // @ts-expect-error a node is read-only
  state.nodes[0]!.title = "x";
  // @ts-expect-error the edge list is read-only
  state.edges.length = 0;
  // @ts-expect-error an edge label is read-only
  state.edges[0]!.label!.t = 0.5;
  // @ts-expect-error the viewport is read-only
  state.viewport.scale = 2;
  // @ts-expect-error the state itself is read-only
  state.positionsVersion += 1;
  // @ts-expect-error GraphView has no actions
  state.select(null);
}

test("GraphView refuses writes at compile time", () => {
  expect(typeof writes).toBe("function");
});
