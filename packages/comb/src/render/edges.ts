// The edges layer (ADR-0012): every edge the query found, drawn as one mesh from the triangles
// the engine computes, with each edge's colour, dash pattern, and arrowhead (G-11). A small
// shader leaves out the gaps of a dash pattern by the distance along the path. On the Canvas 2D
// renderer a host application opts into (ADR-0018), which runs no shader, `EdgeFill` in
// `edges-canvas.ts` draws the layer instead.
import { Container, Geometry, Mesh, Shader } from "pixi.js";
import type { EdgeMesh } from "../bridge";
import type { EdgeData } from "../store";

/** The colour of an edge the host application gives none. */
export const EDGE_COLOR = 0x9aa1ad;

/** The arrow of an edge the host application gives none: an arrowhead at its end. */
export const EDGE_ARROW: NonNullable<EdgeData["arrow"]> = "end";

/** The colour an edge is drawn in: its own, or the default. */
export function edgeColor(edge: { readonly color?: number }): number {
  return edge.color ?? EDGE_COLOR;
}

const vertex = `
in vec2 aPosition;
in float aDistance;
in vec4 aColor;
in vec2 aDash;
out float vDistance;
out vec4 vColor;
out vec2 vDash;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vDistance = aDistance;
  vColor = aColor;
  vDash = aDash;
}`;

// High precision: distances along long paths exceed what mediump floats hold exactly.
const fragment = `precision highp float;
in float vDistance;
in vec4 vColor;
in vec2 vDash;
out vec4 finalColor;
void main() {
  if (vDash.x > 0.0 && mod(vDistance, vDash.x + vDash.y) >= vDash.x) discard;
  finalColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`;

/** The vertex attributes of the mesh: their name in the shader, and per vertex how many values
 *  of which buffer of the engine's mesh. */
const ATTRIBUTES = [
  { name: "aPosition", from: "positions", values: 2, format: "float32x2" },
  { name: "aDistance", from: "distances", values: 1, format: "float32" },
  { name: "aColor", from: "colors", values: 1, format: "unorm8x4" },
  { name: "aDash", from: "dashes", values: 2, format: "float32x2" },
] as const;

/** A mesh an edges layer draws: a query's, which names the edges it found and where each one's
 *  indices start, or the moving layer's of a drag and of edits, which names its edges but not
 *  where their indices start, since nothing is hidden in it (ADR-0027). */
export interface DrawnMesh {
  mesh: EdgeMesh;
  edges?: Uint32Array;
  edgeStarts?: Uint32Array;
}

/** An edges layer, the mesh on WebGL2 or the fill on Canvas 2D (ADR-0018), as the scene and the
 *  moving layer draw it. */
export interface EdgeLayer extends Container {
  /** Draws `drawn`, read before the engine's next call. */
  sync(drawn: DrawnMesh): void;
  /** Leaves the edges in `hidden` out of what the last sync drew (ADR-0027). */
  hide(hidden: ReadonlySet<number>): void;
  /** Whether the mesh the last sync drew names the edge in `slot`. */
  names(slot: number): boolean;
  /** What the layer drew last. */
  size(): MeshSize;
  /** How many triangles the layer drew last. */
  triangles(): number;
}

/** The ranges of indices, `[start, end)` each, of those of `edges` in `hidden`, each starting at
 *  its place in `starts` and ending where the next begins, the last at `count`, the mesh's
 *  indices; none where the mesh holds no edge, as `starts` then says. */
export function hiddenRanges(
  edges: Uint32Array,
  starts: Uint32Array,
  count: number,
  hidden: ReadonlySet<number>,
): [number, number][] {
  if (starts.length !== edges.length) return [];
  const ranges: [number, number][] = [];
  edges.forEach((slot, i) => {
    if (hidden.has(slot)) ranges.push([starts[i]!, starts[i + 1] ?? count]);
  });
  return ranges;
}

/** A geometry of the mesh's attributes, its buffers empty. */
export function meshGeometry(): Geometry {
  return new Geometry({
    attributes: Object.fromEntries(
      ATTRIBUTES.map(({ name, format }) => [name, { buffer: new Float32Array(0), format }]),
    ),
    indexBuffer: new Uint32Array(0),
  });
}

/** Whether `slots`, in ascending order as the engine names a mesh's edges, holds `slot`: found by
 *  halving, so that the far view's edges are not scanned. */
export function holds(slots: Uint32Array, slot: number): boolean {
  let [low, high] = [0, slots.length];
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (slots[middle]! < slot) low = middle + 1;
    else high = middle;
  }
  return slots[low] === slot;
}

/** The capacity a mesh of `size` grows to: the next power of two, so it grows rarely. */
function grown(size: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(size, 1024)));
}

/** The arrays the GPU buffers upload from. They keep their capacity, so that a mesh that fits is
 *  copied in and its used part uploaded, and only a mesh that outgrows them reallocates. The
 *  indices past the used ones are 0, which draws empty triangles. Exported for its test. */
export class MeshBuffers {
  vertices = 0;
  indices = 0;
  /** How many indices the `set`s since the mesh was last drawn marked for upload, 0 once it was:
   *  WebGL uploads at the draw by the last range marked, so a `set` before that draw marks what
   *  the earlier ones marked too, and a `hide` keeps this mark instead of marking its own span
   *  (ADR-0027). */
  private wholeMarked = 0;
  private arrays = {
    positions: new Float32Array(0),
    distances: new Float32Array(0),
    colors: new Uint32Array(0),
    dashes: new Float32Array(0),
    indices: new Uint32Array(0),
  };

  constructor(private readonly geometry: Geometry) {
    this.reserve(1, 1);
  }

  private reserve(vertices: number, indices: number): void {
    if (vertices > this.arrays.distances.length) {
      const n = grown(vertices);
      this.arrays = {
        ...this.arrays,
        positions: new Float32Array(n * 2),
        distances: new Float32Array(n),
        colors: new Uint32Array(n),
        dashes: new Float32Array(n * 2),
      };
      for (const { name, from } of ATTRIBUTES) this.attribute(name).data = this.view(from);
    }
    if (indices > this.arrays.indices.length) {
      this.arrays.indices = new Uint32Array(grown(indices));
      this.geometry.indexBuffer.data = this.arrays.indices;
      this.indices = 0;
    }
  }

  private attribute(name: (typeof ATTRIBUTES)[number]["name"]) {
    return this.geometry.getAttribute(name).buffer;
  }

  /** The array a buffer uploads from: colours as their bytes, for `unorm8x4`. */
  private view(from: (typeof ATTRIBUTES)[number]["from"]) {
    const array = this.arrays[from];
    return from === "colors" ? new Uint8Array(array.buffer) : array;
  }

  /** How many vertices and indices the arrays hold room for. */
  capacity(): { vertices: number; indices: number } {
    return { vertices: this.arrays.distances.length, indices: this.arrays.indices.length };
  }

  /** Copies `mesh` out of the engine's memory, which the next engine call may move, and marks
   *  the used part of every buffer for upload. */
  set(mesh: EdgeMesh): void {
    const vertices = mesh.distances.length;
    const indices = mesh.indices.length;
    this.reserve(vertices, indices);
    for (const { name, from, values } of ATTRIBUTES) {
      this.arrays[from].set(mesh[from]);
      const data = this.view(from);
      const used = from === "colors" ? vertices * 4 : vertices * values;
      this.attribute(name).setDataWithSize(data, used, true);
    }
    const array = this.arrays.indices;
    array.set(mesh.indices);
    if (this.indices > indices) array.fill(0, indices, this.indices);
    this.wholeMarked = Math.max(indices, this.indices, this.wholeMarked);
    this.geometry.indexBuffer.setDataWithSize(array, this.wholeMarked, true);
    this.vertices = vertices;
    this.indices = indices;
  }

  /** Takes up a draw of the mesh, which uploaded what was marked. */
  drawn(): void {
    this.wholeMarked = 0;
  }

  /** Leaves the triangles of `ranges` of the indices out, as empty triangles, and marks the one
   *  span of the index buffer that covers them for upload, nothing else (ADR-0027); where a `set`
   *  marked the whole of it since the last draw, it keeps that mark. */
  hide(ranges: readonly [number, number][]): void {
    if (ranges.length === 0) return;
    const array = this.arrays.indices;
    let [first, last] = [Infinity, 0];
    for (const [start, end] of ranges) {
      array.fill(0, start, end);
      [first, last] = [Math.min(first, start), Math.max(last, end)];
    }
    if (this.wholeMarked > 0) {
      this.geometry.indexBuffer.setDataWithSize(array, this.wholeMarked, true);
      return;
    }
    const bytes = array.BYTES_PER_ELEMENT;
    this.geometry.indexBuffer.update((last - first) * bytes, first * bytes);
  }
}

/** What the edges layer drew last, and the room its arrays hold before they reallocate. */
export interface MeshSize {
  vertices: number;
  indices: number;
  capacity: { vertices: number; indices: number };
}

/** The edges layer: one mesh for every edge the query found. */
export class EdgesContainer extends Container implements EdgeLayer {
  /** The mesh's geometry; the testing entry watches its buffers. */
  readonly geometry = meshGeometry();
  private readonly buffers = new MeshBuffers(this.geometry);
  /** The mesh; the testing entry reads the transform PixiJS hands its shader. */
  readonly mesh = new Mesh({
    geometry: this.geometry,
    shader: Shader.from({ gl: { vertex, fragment, name: "comb-edges" }, resources: {} }),
  });
  constructor() {
    super();
    this.addChild(this.mesh);
    // PixiJS calls this in each render of the stage, before the draw that uploads what is marked;
    // it calls it for a hidden mesh too, which it does not draw, so that one keeps its marks.
    this.mesh.onRender = () => {
      if (this.mesh.visible) this.buffers.drawn();
    };
  }

  /** The edges the last sync drew and where each one's indices start, copied out of the engine's
   *  memory. */
  private found = { edges: new Uint32Array(0), starts: new Uint32Array(0) };

  sync(drawn: DrawnMesh): void {
    this.buffers.set(drawn.mesh);
    this.mesh.visible = this.buffers.indices > 0;
    this.found = {
      edges: Uint32Array.from(drawn.edges ?? []),
      starts: Uint32Array.from(drawn.edgeStarts ?? []),
    };
  }

  /** Leaves the edges in `hidden` out of the mesh the last sync drew, uploading the span of indices
   *  they cover, or all of them where a sync since the last draw marked all (ADR-0027). */
  hide(hidden: ReadonlySet<number>): void {
    const { edges, starts } = this.found;
    this.buffers.hide(hiddenRanges(edges, starts, this.buffers.indices, hidden));
  }

  names(slot: number): boolean {
    return holds(this.found.edges, slot);
  }

  /** What the mesh drew last, and the room its arrays hold before they reallocate. */
  size(): MeshSize {
    const { vertices, indices } = this.buffers;
    return { vertices, indices, capacity: this.buffers.capacity() };
  }

  /** How many triangles the mesh drew last. */
  triangles(): number {
    return this.buffers.indices / 3;
  }
}
