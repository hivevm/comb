// The edges layer (ADR-0012): every edge the query found, drawn as one mesh from the triangles
// the engine computes, with each edge's colour, dash pattern, and arrowhead (G-11). A small
// shader leaves out the gaps of a dash pattern by the distance along the path.
import { Container, Geometry, Mesh, Shader } from "pixi.js";
import type { EdgeMesh, Visible } from "../bridge";
import type { GraphView } from "../store";

/** The colour of an edge the host application gives none. */
export const EDGE_COLOR = 0x9aa1ad;

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

type DrawnEdge = { id: string; source: { x: number; y: number }; target: { x: number; y: number } };

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

/** The edges layer: one mesh for every edge the query found. */
export class EdgesContainer extends Container {
  private readonly geometry = new Geometry({
    attributes: Object.fromEntries(
      ATTRIBUTES.map(({ name, format }) => [name, { buffer: new Float32Array(0), format }]),
    ),
    indexBuffer: new Uint32Array(0),
  });
  private readonly buffers = new MeshBuffers(this.geometry);
  private readonly mesh = new Mesh({
    geometry: this.geometry,
    shader: Shader.from({ gl: { vertex, fragment, name: "comb-edges" }, resources: {} }),
  });
  /** What the last sync drew, copied out of the engine's buffers for inspection. */
  private last = {
    edges: [] as GraphView["edges"],
    slots: new Uint32Array(),
    points: new Float32Array(),
    triangles: 0,
  };

  constructor() {
    super();
    this.addChild(this.mesh);
  }

  sync(state: GraphView, visible: Visible): void {
    this.buffers.set(visible.mesh);
    this.mesh.visible = this.buffers.indices > 0;
    this.last = {
      edges: state.edges,
      slots: visible.edges.slice(),
      points: visible.edgePoints.slice(),
      triangles: this.buffers.indices / 3,
    };
  }

  /** How many triangles the mesh drew last. */
  triangles(): number {
    return this.last.triangles;
  }

  /** The edges the last sync drew, with their ends. */
  drawn(): DrawnEdge[] {
    const { edges, slots, points } = this.last;
    return [...slots].flatMap((slot, i) => {
      const edge = edges[slot];
      if (!edge) return [];
      const [x0, y0, , , , , x3, y3] = points.subarray(i * 8, i * 8 + 8);
      return [{ id: edge.id, source: { x: x0!, y: y0! }, target: { x: x3!, y: y3! } }];
    });
  }
}
