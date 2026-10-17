import type { Viewport } from "../store";

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;

/** The viewport zoomed by `factor` so that the world point under screen point (px, py) stays
 *  under it (G-8). The scale is clamped to what the canvas can still draw legibly or at all. */
export function zoomAt(viewport: Viewport, px: number, py: number, factor: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor));
  const worldX = (px - viewport.x) / viewport.scale;
  const worldY = (py - viewport.y) / viewport.scale;
  return { x: px - worldX * scale, y: py - worldY * scale, scale };
}

/** A rectangle in world coordinates. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The viewport that shows `bounds` whole and centred in a screen of `width` × `height`, with
 *  `margin` pixels around it, never zoomed in beyond 1. */
export function fitViewport(bounds: Bounds, width: number, height: number, margin = 40): Viewport {
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const fit = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h, 1);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit));
  return {
    x: width / 2 - (bounds.minX + w / 2) * scale,
    y: height / 2 - (bounds.minY + h / 2) * scale,
    scale,
  };
}

/** The viewport moved by a screen-space delta. */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}
