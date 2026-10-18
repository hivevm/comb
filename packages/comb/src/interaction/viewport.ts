// The viewport's arithmetic: zoom, fit, pan, and the transform between world and screen, in one
// place for interaction, the scene, and the testing entry.
import type { Rect } from "../bridge";
import type { Viewport } from "../store";

const MIN_SCALE = 0.005;
const MAX_SCALE = 4;

/** `scale` clamped to what the canvas can still draw legibly or at all. */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The viewport zoomed by `factor` so that the world point under screen point (px, py) stays
 *  under it (G-8). The scale is clamped to what the canvas can still draw legibly or at all. */
export function zoomAt(viewport: Viewport, px: number, py: number, factor: number): Viewport {
  const scale = clampScale(viewport.scale * factor);
  const world = toWorld(viewport, px, py);
  return { x: px - world.x * scale, y: py - world.y * scale, scale };
}

/** The screen point, relative to the canvas, at which `viewport` shows world point (x, y). */
export function toScreen(viewport: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: viewport.x + x * viewport.scale, y: viewport.y + y * viewport.scale };
}

/** The world point that `viewport` shows at screen point (x, y), relative to the canvas. */
export function toWorld(viewport: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: (x - viewport.x) / viewport.scale, y: (y - viewport.y) / viewport.scale };
}

/** The world rectangle a screen of `width` × `height` shows through `viewport`, grown by
 *  `margin` screen pixels on every side. */
export function worldRect(viewport: Viewport, width: number, height: number, margin = 0): Rect {
  const { x: minX, y: minY } = toWorld(viewport, -margin, -margin);
  const { x: maxX, y: maxY } = toWorld(viewport, width + margin, height + margin);
  return { minX, minY, maxX, maxY };
}

/** The viewport that shows `bounds` whole and centred in a screen of `width` × `height`, with
 *  `margin` pixels around it, never zoomed in beyond 1. */
export function fitViewport(bounds: Rect, width: number, height: number, margin = 40): Viewport {
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const fit = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h, 1);
  const scale = clampScale(fit);
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
