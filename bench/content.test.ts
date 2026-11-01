// The content the benchmark names as loaded, as the example counts it (G-9, G-10).
import { describe, expect, test } from "bun:test";
import { countContent, metricTree } from "../examples/metric-tree/src/graph";

describe("the content of the metric tree", () => {
  test("one copy holds 15 nodes, counted by type, and their elements by kind", () => {
    // Verifies: G-9, ADR-0008
    const { graph, fields } = metricTree(1);
    expect(graph.nodes).toHaveLength(15);
    const counted = countContent(graph, fields);
    expect(counted).toEqual({
      nodes: { bet: 2, epic: 5, "input-metric": 4, "north-star": 1, kpi: 3 },
      elements: { action: 15, badge: 7, icon: 15, metric: 16, progress: 5, text: 30 },
    });
    // In this order, as a run prints it: the types as the example lists them, the kinds by name.
    expect(Object.keys(counted.nodes)).toEqual([
      "bet",
      "epic",
      "input-metric",
      "north-star",
      "kpi",
    ]);
    expect(Object.keys(counted.elements)).toEqual([
      "action",
      "badge",
      "icon",
      "metric",
      "progress",
      "text",
    ]);
  });
});
