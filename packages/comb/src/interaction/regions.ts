// Where the regions of a divided node stand, and what a gesture that moves them changed of them
// (ARCH-regions-are-container-slots, API-edits-report-division-moves): the resize of a divided node
// and the drag of a line between its regions read them at the press and compare at the release.
import type { Bridge } from "../bridge";
import type { GraphState } from "../store";

/** Where a region stands: the top left corner of its box, `x, y`, and its size as the engine
 *  holds it apart from its extent. */
export type RegionPlace = readonly [x: number, y: number, size: number];

/** The places of the regions of the divided node in `slot`, by slot, as the engine keeps them
 *  now. */
export function regionPlaces(bridge: Bridge, slot: number): Map<number, RegionPlace> {
  const places = new Map<number, RegionPlace>();
  // Asked before the buffers are read, since a call into the engine may detach their views.
  const regions = bridge.regionsOf(slot);
  const held = Array.from(regions, (region) => bridge.regionSize(region)!);
  const { positions } = bridge.nodeBuffers();
  regions.forEach((region, k) => {
    places.set(region, [positions[region * 2]!, positions[region * 2 + 1]!, held[k]!]);
  });
  return places;
}

/** What changed of the regions whose places were `before`: the regions whose size, as
 *  the engine holds it apart from their extent, changed, and the nodes that lie directly in a
 *  region whose top left corner moved, whose position relative to it changed with it, since they
 *  keep their world position; each by identifier. */
export function regionChanges(
  state: GraphState,
  bridge: Bridge,
  before: ReadonlyMap<number, RegionPlace>,
): { regions: string[]; moved: string[] } {
  const slots = [...before.keys()];
  // Asked before the buffers are read, since a call into the engine may detach their views.
  const held = slots.map((slot) => bridge.regionSize(slot));
  const { positions } = bridge.nodeBuffers();
  const regions: string[] = [];
  const shifted = new Set<string>();
  slots.forEach((slot, k) => {
    const view = state.nodes[slot];
    const [x, y, size] = before.get(slot)!;
    if (!view?.region) return;
    const at = slot * 2;
    if (held[k] !== size) regions.push(view.id);
    if (positions[at] !== x || positions[at + 1] !== y) shifted.add(view.id);
  });
  const moved =
    shifted.size === 0
      ? []
      : state.nodes.flatMap((node) =>
          node && !node.region && shifted.has(node.container ?? "") ? [node.id] : [],
        );
  return { regions, moved };
}
