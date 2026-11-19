// A load of random trees of regions through the snapshot and the columns `columns.ts` writes,
// into the engine: names, lines, and sizes cross unchanged, and a value of another type anywhere
// in a tree, however deep, is refused by its field (API-bridge-columns-carry-nesting,
// ARCH-regions-are-container-slots).
import { beforeAll, expect, test } from "bun:test";
import { createBridgeSync, type Bridge } from ".";
import { listsOf, snapshotOf } from "../api/snapshot";

let bridge: Bridge;

beforeAll(async () => {
  const bytes = await Bun.file(new URL("../../wasm/engine_bg.wasm", import.meta.url)).arrayBuffer();
  bridge = createBridgeSync(bytes);
});

const limits = {
  text: 1000,
  id: 256,
  idBudget: 64_000_000,
  contentBudget: 1e9,
  rows: 8,
  columns: 6,
  segments: 8,
  labels: 8,
};

/** A small deterministic generator, so that a failure repeats. */
function lcg(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

type Tree = {
  id: string;
  name?: string;
  size: number;
  line: "solid" | [number, number];
  divide?: "across" | "down";
  regions?: Tree[];
};

/** A random tree of regions of at most `budget` regions, `depth` levels deep, its regions
 *  numbered from `next`, flattened into `flat` in the order the engine takes them. */
function treeOf(random: () => number, depth: number, flat: Tree[], count: { next: number }) {
  const regions: Tree[] = [];
  const many = 1 + Math.floor(random() * 3);
  for (let i = 0; i < many; i++) {
    const region: Tree = {
      id: `r${count.next++}`,
      size: Math.round(1 + random() * 150),
      line: random() < 0.5 ? "solid" : [Math.round(1 + random() * 8), Math.round(random() * 8)],
    };
    if (random() < 0.5) region.name = `name ${count.next}`;
    flat.push(region);
    if (depth > 0 && random() < 0.4) {
      region.divide = random() < 0.5 ? "across" : "down";
      region.regions = treeOf(random, depth - 1, flat, count);
    }
    regions.push(region);
  }
  return regions;
}

/** The activity divided across into `regions`. */
const activity = (regions: Tree[]) => ({
  id: "act",
  x: 0,
  y: 0,
  width: 100,
  content: [],
  divide: "across",
  regions,
});

test("a load of random trees of regions crosses their names, lines, and sizes unchanged through the columns, and refuses a value of another type at any depth", () => {
  // Verifies: API-bridge-columns-carry-nesting, ARCH-regions-are-container-slots
  const random = lcg(5);
  let [crossed, refused] = [0, 0];
  for (let round = 0; round < 300; round++) {
    const flat: Tree[] = [];
    const regions = treeOf(random, 4, flat, { next: 0 });
    const spoil = random() < 0.3 ? flat[Math.floor(random() * flat.length)] : undefined;
    if (spoil) (spoil as unknown as { size: unknown }).size = "wide";
    const { kept, snapshot } = snapshotOf(
      listsOf({ nodes: [activity(regions)], edges: [] } as never),
      limits,
    );
    if (spoil) {
      expect(() => bridge.loadGraph(snapshot)).toThrow(
        expect.objectContaining({ kind: "invalidField", field: "regions" }),
      );
      refused++;
      continue;
    }
    expect(bridge.loadGraph(snapshot)).toBe(1 + flat.length);
    // The store's views: each region's name and line as given, in the order of the slots.
    const views = kept.nodes.slice(1);
    expect(views.map(({ id, region }) => [id, region?.name, region?.line])).toEqual(
      flat.map(({ id, name, line }) => [id, name, line]),
    );
    // The engine's slots, in the same order, each at least its size along its division.
    expect([...bridge.regionsOf(0)]).toEqual(flat.map((_, k) => k + 1));
    const { sizes } = bridge.nodeBuffers();
    flat.forEach((region, k) => {
      const across = views[k]!.region!.axis === "across";
      expect(sizes[(k + 1) * 2 + (across ? 0 : 1)]!).toBeGreaterThanOrEqual(region.size);
    });
    crossed++;
  }
  expect(crossed).toBeGreaterThan(150);
  expect(refused).toBeGreaterThan(50);
});
