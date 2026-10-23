// The edges layer (ADR-0012): every edge the query found, drawn as one mesh from the triangles
// the engine computes, with each edge's colour, dash pattern, and arrowhead (G-11). A small
// shader leaves out the gaps of a dash pattern by the distance along the path. On the Canvas 2D
// renderer a host application opts into (ADR-0018), which runs no shader, `EdgeFill` in
// `edges-canvas.ts` draws the layer instead.
import { Container, Geometry, Mesh, Shader } from "pixi.js";
import type { EdgeMesh, Visible } from "../bridge";
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

/** The capacity a mesh of `size` grows to: the next power of two, so it grows rarely. */
function grown(size: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(size, 1024)));
}

/** The arrays the GPU buffers upload from. They keep their capacity, so that a mesh that fits is
 *  copied in and its used part uploaded, and only a mesh that outgrows them reallocates. The
 *  indices past the used ones are 0, which draws empty triangles. */
class MeshBuffers {
  vertices = 0;
  indices = 0;
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
    this.geometry.indexBuffer.setDataWithSize(array, Math.max(indices, this.indices), true);
    this.vertices = vertices;
    this.indices = indices;
  }
}

/** What the edges layer drew last, and the room its arrays hold before they reallocate. */
export interface MeshSize {
  vertices: number;
  indices: number;
  capacity: { vertices: number; indices: number };
}

/** The edges layer: one mesh for every edge the query found. */
export class EdgesContainer extends Container {
  /** The mesh's geometry; the testing entry watches its buffers. */
  readonly geometry = new Geometry({
    attributes: Object.fromEntries(
      ATTRIBUTES.map(({ name, format }) => [name, { buffer: new Float32Array(0), format }]),
    ),
    indexBuffer: new Uint32Array(0),
  });
  private readonly buffers = new MeshBuffers(this.geometry);
  /** The mesh; the testing entry reads the transform PixiJS hands its shader. */
  readonly mesh = new Mesh({
    geometry: this.geometry,
    shader: Shader.from({ gl: { vertex, fragment, name: "comb-edges" }, resources: {} }),
  });
  constructor() {
    super();
    this.addChild(this.mesh);
  }

  sync(visible: Visible): void {
    this.buffers.set(visible.mesh);
    this.mesh.visible = this.buffers.indices > 0;
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
