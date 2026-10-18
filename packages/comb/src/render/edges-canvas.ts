// The edges layer on PixiJS's Canvas 2D renderer, where the host application opts in (ADR-0018):
// the triangles of the engine's edge mesh filled into one drawing of the layer, never one per
// edge (ADR-0012). Canvas 2D runs no shader, so dash patterns draw solid; and no WebGL mesh is
// built, so nothing is copied for upload.
import { Container, Graphics } from "pixi.js";
import type { Visible } from "../bridge";
import type { MeshSize } from "./edges";

/** The colour and alpha of a vertex colour of the engine's mesh, whose bytes are R, G, B, A in
 *  memory order. */
export function fillOf(rgba: number): { color: number; alpha: number } {
  const r = rgba & 0xff;
  const g = (rgba >>> 8) & 0xff;
  const b = (rgba >>> 16) & 0xff;
  return { color: (r << 16) | (g << 8) | b, alpha: (rgba >>> 24) / 255 };
}

/** The edges layer on Canvas 2D: every triangle in the colour of its first vertex, one fill for
 *  each run of consecutive triangles of one colour, which the engine emits edge by edge. */
export class EdgeFill extends Container {
  /** The one drawing every triangle is filled into. */
  readonly drawing = new Graphics();
  private drawn = { vertices: 0, indices: 0 };

  constructor() {
    super();
    this.addChild(this.drawing);
  }

  /** Fills the triangles of the mesh `visible` holds, read before the engine's next call. */
  sync(visible: Visible): void {
    const { positions, colors, indices } = visible.mesh;
    const count = indices.length - (indices.length % 3);
    this.drawing.clear();
    for (let i = 0; i < count; i += 3) {
      const corners = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
      this.drawing.poly(corners.flatMap((v) => [positions[v * 2]!, positions[v * 2 + 1]!]));
      // The run ends where the next triangle's first vertex has another colour, or at the end.
      const color = colors[corners[0]!]!;
      if (i + 3 >= count || colors[indices[i + 3]!] !== color) this.drawing.fill(fillOf(color));
    }
    this.drawn = { vertices: colors.length, indices: count };
  }

  /** What the fill drew last; it holds no arrays of its own. */
  size(): MeshSize {
    return { ...this.drawn, capacity: { vertices: 0, indices: 0 } };
  }

  /** How many triangles the fill drew last. */
  triangles(): number {
    return this.drawn.indices / 3;
  }
}
