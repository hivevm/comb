// The type checker pins `GraphChange` to the table of API-edits-report-nested-changes: exactly
// its kinds, each with the `by` the table gives it. Each assignment below compiles only while the
// types are equal, and `tsc` fails on a `@ts-expect-error` that has no error to expect.
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
  nodeMoved: "user" | "host";
  nodeResized: "user";
  regionsMoved: "user";
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
    const { id, width }: { id: string; width: number } = change.node;
    expect([id, width]).toBeDefined();
  }
  if (change.kind === "nodesRemoved") {
    // @ts-expect-error the identifiers a change lists are read-only
    change.edges.push("e");
  }
  // @ts-expect-error a change is read-only
  change.by = "user";
}

test("GraphChange admits exactly the kinds of API-edits-report-nested-changes's table, each by whom it names", () => {
  // Verifies: API-edits-report-nested-changes
  expect([kinds, by, typeof narrows]).toEqual([true, true, "function"]);
});
