// The particles of the far level: a sync colours every particle it binds anew, the selected node's
// and the others', whatever the pooled particle held before.
import { expect, test } from "bun:test";
import type { Particle } from "pixi.js";
import { FAR_NODE_COLOR, FAR_SELECTED_COLOR, NodeParticles } from "./particles";
import type { GraphView } from "../store";

const nodes = [
  { id: "a", width: 100 },
  { id: "b", width: 100 },
] as GraphView["nodes"];
const state = (selected: string | null) =>
  ({
    nodes,
    selection: selected ? { kind: "node", id: selected } : null,
  }) as GraphView;
const slots = Uint32Array.from([0, 1]);
const positions = new Float32Array(4);
const sizes = Float32Array.from([100, 64, 100, 64]);

test("a sync colours a pooled particle anew, once selected, then not, then hidden", () => {
  // Decides no criterion: it pins that a pooled particle takes the colour and the opacity of the
  // sync that binds it, which the far level's selection shows (ADR-0027).
  const particles = new NodeParticles();
  const drawn = () => (particles.particleChildren as Particle[]).map((p) => [p.tint, p.alpha]);
  particles.sync(state("a"), slots, positions, sizes);
  expect(drawn()).toEqual([
    [FAR_SELECTED_COLOR, 1],
    [FAR_NODE_COLOR, 1],
  ]);
  particles.sync(state(null), slots, positions, sizes);
  expect(drawn()).toEqual([
    [FAR_NODE_COLOR, 1],
    [FAR_NODE_COLOR, 1],
  ]);
  particles.hide(new Set([1]));
  expect(drawn()[1]).toEqual([FAR_NODE_COLOR, 0]);
  particles.sync(state("b"), slots, positions, sizes);
  expect(drawn()).toEqual([
    [FAR_NODE_COLOR, 1],
    [FAR_SELECTED_COLOR, 1],
  ]);
});
