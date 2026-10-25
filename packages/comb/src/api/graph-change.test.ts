// The type checker pins `GraphChange` to the table of ADR-0030: exactly its kinds, each with the
// `by` the table gives it. Each assignment below compiles only while the types are equal, and `tsc`
// fails on a `@ts-expect-error` that has no error to expect.
import { expect, test } from "bun:test";
import type { GraphChange } from "../index";

/** `true` where `A` and `B` are the same type, `false` otherwise. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The table: each kind with who may make it. */
interface Table {
  loaded: "host";
  nodeAdded: "host";
  nodeUpdated: "host";
  nodeMoved: "user";
  nodesRemoved: "user" | "host";
  edgeAdded: "user" | "host";
  edgeUpdated: "host";
  edgesRemoved: "user" | "host";
  labelMoved: "user";
}

type By = { [K in GraphChange["kind"]]: Extract<GraphChange, { kind: K }>["by"] };

const kinds: Equal<GraphChange["kind"], keyof Table> = true;
const by: Equal<By, Table> = true;

function narrows(change: GraphChange): void {
  if (change.kind === "nodeAdded") {
    const { id, x, y }: { id: string; x: number; y: number } = change.node;
    expect([id, x, y]).toBeDefined();
  }
  if (change.kind === "nodesRemoved") {
    // @ts-expect-error the identifiers a change lists are read-only
    change.edges.push("e");
  }
  // @ts-expect-error a change is read-only
  change.by = "user";
}

test("GraphChange admits exactly the kinds of ADR-0030's table, each by whom it names", () => {
  // Verifies: ADR-0030
  expect([kinds, by, typeof narrows]).toEqual([true, true, "function"]);
});
