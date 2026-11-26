// The resize handles of the selected node (API-edits-report-division-moves, *Resizing*): where its
// `resizable` is `true`, eight white squares of 8 by 8 screen pixels outlined in the selection's
// colour, at its four corners and the middles of its four sides, the same size at every scale,
// drawn in the overlay at the near and the middle level, where the engine hits them
// (REN-node-content-and-hits). It reads the store and the engine's buffers, and writes neither
// (ARCH-graph-in-zustand-store, ARCH-one-workspace-per-example).
import { Graphics } from "pixi.js";
import type { ResizeHandle } from "../bridge";
import type { GraphView } from "../store";
import { levelAt, toScreen } from "../store/viewport";
import { SELECTED_STROKE } from "./nodes";

/** The side of a drawn handle, in screen pixels. */
const SIDE = 8;

/** Each handle and where it stands on a node, as fractions of its width and height, clockwise
 *  from the top left corner, the order the engine numbers them in. */
const PLACES: readonly [ResizeHandle, number, number][] = [
  ["topLeft", 0, 0],
  ["top", 0.5, 0],
  ["topRight", 1, 0],
  ["right", 1, 0.5],
  ["bottomRight", 1, 1],
  ["bottom", 0.5, 1],
  ["bottomLeft", 0, 1],
  ["left", 0, 0.5],
];

/** A handle as the overlay draws it, for inspection: its node, which one it is, and its middle in
 *  world units. */
export interface DrawnHandle {
  node: string;
  handle: ResizeHandle;
  x: number;
  y: number;
}

/** The resize handles of the selected node, in the overlay's screen coordinates. */
export class ResizeHandles extends Graphics {
  drawn: DrawnHandle[] = [];

  /** The squares the `Graphics` fills, in screen pixels, read from its fill instructions, for
   *  inspection. */
  squares(): { x: number; y: number; width: number; height: number }[] {
    return this.context.instructions.flatMap((instruction) => {
      if (instruction.action !== "fill") return [];
      const { minX, minY, width, height } = instruction.data.path.bounds;
      return [{ x: minX, y: minY, width, height }];
    });
  }
  /** What the handles were last drawn from, so that a render that changes none of it draws
   *  nothing anew. */
  private from: unknown[] = [];

  /** Draws the handles of the node `state` selects, none where it is not resizable or the scale
   *  is of the far level; the node's box read from `positions` and `sizes`. */
  sync(state: GraphView, positions: Float32Array, sizes: Float32Array): void {
    const { selection, slots, nodes, viewport } = state;
    const slot = selection?.kind === "node" ? slots.get(selection.id) : undefined;
    const node = slot === undefined ? undefined : nodes[slot];
    const shown = node?.resizable === true && levelAt(viewport.scale) !== "far";
    const from = [shown, node, viewport, state.positionsVersion, state.movesVersion];
    if (from.every((value, i) => Object.is(value, this.from[i]))) return;
    this.from = from;
    this.clear();
    this.drawn = [];
    if (!shown || slot === undefined) return;
    const [x, y] = [positions[slot * 2]!, positions[slot * 2 + 1]!];
    const [width, height] = [sizes[slot * 2]!, sizes[slot * 2 + 1]!];
    for (const [handle, across, down] of PLACES) {
      const world = { x: x + across * width, y: y + down * height };
      const at = toScreen(viewport, world.x, world.y);
      this.rect(at.x - SIDE / 2, at.y - SIDE / 2, SIDE, SIDE)
        .fill({ color: 0xffffff })
        .stroke({ color: SELECTED_STROKE, width: 1 });
      this.drawn.push({ node: node.id, handle, ...world });
    }
  }
}
