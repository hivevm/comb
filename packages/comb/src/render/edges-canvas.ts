// The edges layer on PixiJS's Canvas 2D renderer, where the host application opts in (ADR-0018):
// the triangles of the engine's edge mesh filled into one drawing of the layer, never one per
// edge (ADR-0027). Canvas 2D runs no shader, so dash patterns draw solid; and no WebGL mesh is
// built, so nothing is uploaded, but the mesh is kept, so that a drag fills it again without the
// edges it moves (ADR-0040).
import { Container, Graphics } from "pixi.js";
import { hiddenRanges, type DrawnMesh, type MeshSize } from "./edges";

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

  /** A copy of what the last sync drew, so that a drag can fill it again without its edges. */
  private kept = {
    positions: new Float32Array(0),
    colors: new Uint32Array(0),
    indices: new Uint32Array(0),
    edges: new Uint32Array(0),
    starts: new Uint32Array(0),
  };

  /** Fills the triangles of the mesh `drawn` holds, read before the engine's next call. */
  sync(drawn: DrawnMesh): void {
    const { positions, colors, indices } = drawn.mesh;
    this.kept = {
      positions: Float32Array.from(positions),
      colors: Uint32Array.from(colors),
      indices: Uint32Array.from(indices),
      edges: Uint32Array.from(drawn.edges ?? []),
      starts: Uint32Array.from(drawn.edgeStarts ?? []),
    };
    this.fill();
  }

  /** Fills the mesh the last sync drew again without the edges in `hidden` (ADR-0040). */
  hide(hidden: ReadonlySet<number>): void {
    const { indices, edges, starts } = this.kept;
    const ranges = hiddenRanges(edges, starts, indices.length, hidden);
    if (ranges.length === 0) return;
    for (const [start, end] of ranges) indices.fill(0, start, end);
    this.fill();
  }

  private fill(): void {
    const { positions, colors, indices } = this.kept;
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

  /** What the fill drew last. */
  size(): MeshSize {
    return { ...this.drawn, capacity: { vertices: 0, indices: 0 } };
  }

  /** How many triangles the fill drew last. */
  triangles(): number {
    return this.drawn.indices / 3;
  }
}
