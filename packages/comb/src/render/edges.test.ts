// The edge mesh's marks for upload, which WebGL takes at the draw by the last range marked.
import { expect, test } from "bun:test";
import { hiddenRanges, holds, MeshBuffers, meshGeometry } from "./edges";

/** A mesh of two edges, in slots 4 and 7, of six indices each. */
const mesh = {
  positions: new Float32Array(16),
  distances: new Float32Array(8),
  colors: new Uint32Array(8),
  dashes: new Float32Array(16),
  indices: new Uint32Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]),
};
const [edges, starts] = [new Uint32Array([4, 7]), new Uint32Array([0, 6])];

test("a hide after a set keeps the set's mark of the whole index buffer until the draw", () => {
  // Verifies: ADR-0027
  const geometry = meshGeometry();
  const buffers = new MeshBuffers(geometry);
  /** The span of the index buffer marked for upload, in indices. */
  const marked = () => {
    const { _updateOffset, _updateSize } = geometry.indexBuffer;
    return { offset: _updateOffset / 4, size: _updateSize / 4 };
  };
  const hide = (slot: number) => buffers.hide(hiddenRanges(edges, starts, 12, new Set([slot])));
  buffers.set(mesh);
  hide(7);
  expect(marked()).toEqual({ offset: 0, size: 12 });
  // The draw uploads what is marked; a hide after it marks the span it hides alone.
  buffers.drawn();
  hide(4);
  expect(marked()).toEqual({ offset: 0, size: 6 });
  hide(7);
  expect(marked()).toEqual({ offset: 6, size: 6 });
});

test("a mesh's ascending edge slots hold a slot by halving, at either end and in between", () => {
  // Verifies: ADR-0027
  const slots = Uint32Array.from([2, 5, 9, 40]);
  expect([0, 2, 3, 5, 9, 39, 40, 41].map((slot) => holds(slots, slot))).toEqual([
    false,
    true,
    false,
    true,
    true,
    false,
    true,
    false,
  ]);
  expect(holds(new Uint32Array(0), 0)).toBe(false);
});
