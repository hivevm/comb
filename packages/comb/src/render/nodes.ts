// The nodes layer at the near and the middle level (REN-virtualized-nested-scene): a pooled view
// per node in view, its node shape (REN-node-shapes-cover-uml) and its content
// (REN-node-content-and-hits), every text as `BitmapText`. The engine lays the content out and the
// view draws each text where the engine placed it, cut where it was cut, an action's in the link
// colour, a badge's on its pill, each progress bar as the segments and the track the engine cut its
// bar into, and each metric as its caption, its value, and its trend's text and arrow, the last two
// in the trend's colour, and each icon as a sprite of the texture the host application registered
// under its name, fitted into its square. It draws what the query placed, which elements a level of
// detail keeps being the engine's to decide.
import {
  BitmapFontManager,
  BitmapText,
  Container,
  Graphics,
  type Polygon,
  type RoundedRectangle,
  Sprite,
  TextStyle,
  type TextStyleOptions,
} from "pixi.js";
import {
  KIND_NAMES,
  ROLE_NAMES,
  SEPARATOR_KIND,
  type ContentElement,
  type FontMetrics,
  type NodeShape,
  type Outline,
  type Placed,
  type TextRole,
} from "../bridge";
import type { GraphView, NodeView, RegionView } from "../store";
import { Bindings } from "./bindings";
import type { Icons } from "./icons";

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xd0d4dc;
export const SELECTED_STROKE = 0x3b82f6;
const TEXT_COLOR = 0x1f2430;
const CAPTION_COLOR = 0x6b7280;
const LINK_COLOR = 0x2563eb;
/** The radius of a rectangle's corners, the shell's alone: the engine hits a rectangle as its
 *  bounding rectangle, its corners included (REN-node-shapes-cover-uml). */
const RECTANGLE_RADIUS = 6;
/** The radius of a rounded rectangle's corners, the engine's `ROUNDED_RADIUS`, which it hits them
 *  by. */
const ROUNDED_RADIUS = 10;
/** The width of a ringed circle's ring. */
const RING_WIDTH = 2;
/** How far a note's corner is folded down, the engine's `NOTE_FOLD`, at most a quarter of its
 *  width and of its height, as the engine's `fold` holds it. */
const NOTE_FOLD = 12;
/** How far the lower right corner of a frame's tab is cut, the engine's `FRAME_CUT`. */
const FRAME_CUT = 8;
/** The colour of a node shape the engine fills, the near-black of a node's texts. */
const FILLED_COLOR = TEXT_COLOR;
/** How many times as high as wide the drawing of an actor and of an hourglass is, which the shell
 *  draws it in; the engine gives its height as the top of the inner rectangle below it. */
const PROPORTIONS: Partial<Record<NodeShape, number>> = { actor: 2, hourglass: 1.5 };
/** The colour of the rest of a progress bar, past its segments. */
const TRACK_COLOR = 0xe5e7eb;
/** The radius of a progress bar's ends, at most half its height and half its length. */
const BAR_RADIUS = 4;
/** How many points a quarter of a bar's rounded end is drawn with. */
const END_STEPS = 6;

/** The style each role's texts are drawn in; the title's is that of the title before content. */
export const TEXT_STYLES: Readonly<Record<TextRole, TextStyleOptions>> = {
  title: { fontFamily: "Arial", fontSize: 14, fill: TEXT_COLOR },
  body: { fontFamily: "Arial", fontSize: 12, fill: TEXT_COLOR },
  caption: { fontFamily: "Arial", fontSize: 11, fill: CAPTION_COLOR },
};

/** The style an action's text is drawn in: the body's font, which the engine lays it out in, in
 *  the link colour. */
export const ACTION_STYLE: TextStyleOptions = { ...TEXT_STYLES.body, fill: LINK_COLOR };

/** The styles a badge's text is drawn in: the body's font, white or near-black on its pill. */
const BADGE_STYLES: Readonly<Record<number, TextStyleOptions>> = {
  [0xffffff]: { ...TEXT_STYLES.body, fill: 0xffffff },
  [TEXT_COLOR]: { ...TEXT_STYLES.body, fill: TEXT_COLOR },
};

/** The style a metric's trend's text is drawn in: the body's font, its fill set on the pooled
 *  text object's own style to the trend's colour, so that no style is kept per colour. */
const TREND_STYLE: TextStyleOptions = { ...TEXT_STYLES.body };

/** The relative luminance of `color`, `0xRRGGBB`, as WCAG 2 defines it. */
function luminance(color: number): number {
  const channel = (shift: number) => {
    const c = ((color >> shift) & 0xff) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** The colour of a badge's text on a pill of `color`: white or the near-black of the node's texts,
 *  whichever contrasts more with the pill by WCAG's ratio of relative luminances, white where
 *  both contrast alike, as on an edge label's pill (REN-node-content-and-hits). */
export function badgeTextColor(color: number): number {
  const pill = luminance(color) + 0.05;
  const white = (luminance(0xffffff) + 0.05) / pill;
  const dark = pill / (luminance(TEXT_COLOR) + 0.05);
  return dark > white ? TEXT_COLOR : 0xffffff;
}

/** The style of the text `text`. */
const styleOf = ({ kind, role, pill, trend }: DrawnText) =>
  kind === "action"
    ? ACTION_STYLE
    : pill
      ? BADGE_STYLES[pill.textColor]!
      : trend !== undefined
        ? TREND_STYLE
        : TEXT_STYLES[role];

/** The height of a line of each role, which the engine stacks rows by: given here rather than
 *  measured, so that a node's height does not depend on how a machine measures the font. A text
 *  is one line, which `BitmapText` draws from its top whatever the line height. */
export const LINE_HEIGHTS: Readonly<Record<TextRole, number>> = {
  title: 18,
  body: 16,
  caption: 14,
};

/** The character the engine draws after a cut text, whose advance it is handed. */
export const ELLIPSIS = "…";

/** The characters whose advances the engine is handed: printable ASCII, the Latin-1 supplement,
 *  and the ellipsis; every other character advances as the widest of them. */
const MEASURED = (() => {
  let chars = "";
  for (let code = 0x20; code < 0x7f; code++) chars += String.fromCharCode(code);
  for (let code = 0xa0; code <= 0xff; code++) chars += String.fromCharCode(code);
  return chars + ELLIPSIS;
})();

/** Wide characters beyond the measured ones, of the scripts and symbols a node most likely holds,
 *  whose widest the engine takes as the advance of every character it has none for: ideographs,
 *  full-width forms, Hangul, and emoji. */
const WIDE = "漢字ＷＭ한글😀📈🚀🔥💡🎯🧭🌍";

/** The metrics of the font `role`'s texts are drawn in, as the `BitmapText` of PixiJS lays a
 *  line out: each measured glyph's advance at the font's size, the widest for every other
 *  character, and the role's line height (REN-node-content-and-hits). */
export function fontMetricsOf(role: TextRole): FontMetrics {
  const style = TEXT_STYLES[role];
  const font = BitmapFontManager.getFont(MEASURED + WIDE, new TextStyle(style));
  const scale = (style.fontSize as number) / font.baseMeasurementFontSize;
  const advance = (char: string) => (font.chars[char]?.xAdvance ?? 0) * scale;
  const chars = [...MEASURED];
  const codes = Uint32Array.from(chars, (char) => char.codePointAt(0)!);
  const advances = Float64Array.from(chars, advance);
  // Every other character advances as the widest measured one, wide ones among them, so that a
  // text of them is cut too early rather than past its column.
  const fallback = [...MEASURED, ...WIDE].reduce(
    (widest, char) => Math.max(widest, advance(char)),
    0,
  );
  return { codes, advances, fallback, lineHeight: LINE_HEIGHTS[role] };
}

/** One text a view draws: where the engine placed its element in its node, or of a metric its
 *  part, and what of it is drawn, the text or as much of it as fits followed by an ellipsis; of a
 *  badge, the pill the rectangle is, of its colour, the colour its text is drawn in on it, and
 *  where its text lies, inside the engine's padding; of a metric's trend, the trend's colour its
 *  text is drawn in. */
export interface DrawnText {
  kind: ContentElement["kind"];
  role: TextRole;
  drawn: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pill?: { color: number; textColor: number; textX: number; textY: number };
  trend?: number;
}

/** A metric's trend arrow a view draws, as its `Graphics` holds it: its triangle's three points
 *  `x, y` relative to its node, and its colour. */
export interface DrawnArrow {
  points: number[];
  color: number;
}

/** The roles of a metric's three parts: its caption's, its value's, and its trend's text's. */
const METRIC_ROLES: readonly TextRole[] = ["caption", "body", "body"];

/** A pill a view drew, as its `Graphics` holds it: its rectangle in its node and its colour; and
 *  so a piece of a progress bar, a segment or its track. */
export interface DrawnPill {
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}

/** One progress bar a view draws: its pieces as the engine cut its bar, its segments in their
 *  colours and its track, the last, in the track colour, each relative to its node. */
type DrawnBar = DrawnPill[];

/** The bars of the progress bars among the elements `start` to `end` of `placed`. */
function barsOf(placed: Placed, start: number, end: number): DrawnBar[] {
  const bars: DrawnBar[] = [];
  for (let i = start; i < end; i++) {
    const [first, last] = [placed.barBounds[i]!, placed.barBounds[i + 1]!];
    if (first === last || placed.kinds[i] === SEPARATOR_KIND) continue;
    const bar: DrawnBar = [];
    for (let p = first; p < last; p++) {
      const [x, y, width, height] = placed.bars.subarray(p * 4, p * 4 + 4);
      const color = p === last - 1 ? TRACK_COLOR : placed.barColors[p]!;
      bar.push({ x: x!, y: y!, width: width!, height: height!, color });
    }
    bars.push(bar);
  }
  return bars;
}

/** The outline of the piece `piece` of a bar from `left` to `right`, as points `x, y`: the piece's
 *  rectangle within the bar, whose two ends are rounded by `radius`, so that only the bar's outer
 *  ends are round and its pieces abut square. */
export function pieceOutline(piece: DrawnPill, left: number, right: number, radius: number) {
  const { x, y, width, height } = piece;
  const end = x + width;
  // How far the bar's outline lies inside its top and bottom at `at`, by its rounded ends.
  const inset = (at: number) => {
    const reach = Math.min(at - left, right - at);
    if (reach >= radius) return 0;
    const off = radius - Math.max(reach, 0);
    return radius - Math.sqrt(Math.max(radius * radius - off * off, 0));
  };
  const xs = [x];
  for (let k = 1; k < END_STEPS; k++) {
    for (const at of [left + (radius * k) / END_STEPS, right - (radius * k) / END_STEPS])
      if (at > x && at < end) xs.push(at);
  }
  xs.push(end);
  xs.sort((a, b) => a - b);
  const points: number[] = [];
  for (const at of xs) points.push(at, y + inset(at));
  for (const at of xs.reverse()) points.push(at, y + height - inset(at));
  return points;
}

/** The texts of the elements `start` to `end` of `placed`. */
function textsOf(placed: Placed, start: number, end: number): DrawnText[] {
  const texts: DrawnText[] = [];
  for (let i = start; i < end; i++) {
    // A separator shows no text: its line is drawn as a rule (`rulesOf`).
    if (placed.kinds[i] === SEPARATOR_KIND) continue;
    const kind = KIND_NAMES[placed.kinds[i]!]!;
    const role = ROLE_NAMES[placed.roles[i]!]!;
    // A progress bar shows no text: its bar is drawn of its pieces; an icon's text is its name.
    if (kind === "progress" || kind === "icon") continue;
    if (kind === "metric") {
      texts.push(...metricTexts(placed, i));
      continue;
    }
    const drawn = placed.texts.slice(placed.textBounds[i], placed.textBounds[i + 1]);
    const r = placed.rects.subarray(i * 4, i * 4 + 4);
    const text: DrawnText = { kind, role, drawn, x: r[0]!, y: r[1]!, width: r[2]!, height: r[3]! };
    if (kind === "badge") {
      const color = placed.colors[i]!;
      const { x, y } = placed.badgePadding;
      text.pill = { color, textColor: badgeTextColor(color), textX: r[0]! + x, textY: r[1]! + y };
    }
    texts.push(text);
  }
  return texts;
}

/** The texts of the metric at `i` of `placed`: its caption in the caption's role and colour, its
 *  value in the body's, and its trend's text in the body's font and the trend's colour, each where
 *  the engine placed its part. */
function metricTexts(placed: Placed, i: number): DrawnText[] {
  const texts: DrawnText[] = [];
  let start = placed.textBounds[i]!;
  for (let p = placed.partBounds[i]!, k = 0; p < placed.partBounds[i + 1]!; p++, k++) {
    const end = placed.partEnds[p]!;
    const [x, y, width, height] = placed.parts.subarray(p * 4, p * 4 + 4);
    const role = METRIC_ROLES[k]!;
    const text: DrawnText = {
      kind: "metric",
      role,
      drawn: placed.texts.slice(start, end),
      x: x!,
      y: y!,
      width: width!,
      height: height!,
    };
    if (k === 2) text.trend = placed.colors[i]!;
    texts.push(text);
    start = end;
  }
  return texts;
}

/** The lines of the separators among the elements `start` to `end` of `placed`, each the one piece
 *  the engine placed of it, 1 high across the inner rectangle (REN-node-content-and-hits,
 *  *Separator*). */
function rulesOf(placed: Placed, start: number, end: number): DrawnPill[] {
  const rules: DrawnPill[] = [];
  for (let i = start; i < end; i++) {
    if (placed.kinds[i] !== SEPARATOR_KIND) continue;
    const p = placed.barBounds[i]!;
    const [x, y, width, height] = placed.bars.subarray(p * 4, p * 4 + 4);
    rules.push({ x: x!, y: y!, width: width!, height: height!, color: 0 });
  }
  return rules;
}

/** The dash segments of the found node at `found` of `placed`, each `[x0, y0, x1, y1]` relative to
 *  its node, as the engine laid them along its outline; none where its outline is not dashed or
 *  the level draws no node (REN-node-shapes-cover-uml, *Outline*). */
function dashesOf(placed: Placed, found: number): number[][] {
  const { dashBounds, dashes } = placed;
  if (found + 1 >= dashBounds.length) return [];
  const segments: number[][] = [];
  for (let d = dashBounds[found]!; d < dashBounds[found + 1]!; d++)
    segments.push([...dashes.subarray(d * 4, d * 4 + 4)]);
  return segments;
}

/** Whether the dash segments `a` and `b` are the same, segment by segment: a query cuts a node's
 *  dashes to its rectangle, so that another query may lay as many of other ones. */
function sameDashes(a: readonly (readonly number[])[], b: readonly (readonly number[])[]) {
  return a.length === b.length && a.every((s, i) => s.every((value, k) => value === b[i]![k]));
}

/** The arrows of the metrics among the elements `start` to `end` of `placed`. */
function arrowsOf(placed: Placed, start: number, end: number): DrawnArrow[] {
  const arrows: DrawnArrow[] = [];
  for (let i = start; i < end; i++) {
    for (let a = placed.arrowBounds[i]!; a < placed.arrowBounds[i + 1]!; a++) {
      const points = [...placed.arrows.subarray(a * 6, a * 6 + 6)];
      arrows.push({ points, color: placed.colors[i]! });
    }
  }
  return arrows;
}

/** An icon a view draws: the name it is registered under, and the square the engine laid it
 *  out in, relative to its node. */
export interface DrawnIcon {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sprite of an icon a view drew, as the sprite holds it: the name its texture is registered
 *  under, null for a texture no longer registered, and its rectangle relative to its node. */
export interface DrawnSprite {
  texture: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The icons among the elements `start` to `end` of `placed`, each its name and its square. */
function iconsOf(placed: Placed, start: number, end: number): DrawnIcon[] {
  const icons: DrawnIcon[] = [];
  for (let i = start; i < end; i++) {
    if (KIND_NAMES[placed.kinds[i]!] !== "icon") continue;
    const name = placed.texts.slice(placed.textBounds[i], placed.textBounds[i + 1]);
    const [x, y, width, height] = placed.rects.subarray(i * 4, i * 4 + 4);
    icons.push({ name, x: x!, y: y!, width: width!, height: height! });
  }
  return icons;
}

/** The rectangle of an image `imageWidth` × `imageHeight` fitted into `square` with its aspect
 *  kept and centred in it: as large as fits, a non-square image touching two opposite sides. */
export function fitted(
  square: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
) {
  const scale = Math.min(square.width / imageWidth, square.height / imageHeight);
  const [width, height] = [imageWidth * scale, imageHeight * scale];
  const x = square.x + (square.width - width) / 2;
  const y = square.y + (square.height - height) / 2;
  return { x, y, width, height };
}

/** A text object of a node view, with the style it was last given. */
interface PooledText {
  view: BitmapText;
  style: TextStyleOptions;
}

/** The text objects and the sprites the node views of one layer share: a view holds those it
 *  draws while it is bound and returns them here once it draws fewer or is released, so that the
 *  layer makes one only where more are drawn at once than ever before, whichever view draws them
 *  (REN-virtualized-nested-scene). */
class ElementPool {
  readonly texts: PooledText[] = [];
  readonly sprites: Sprite[] = [];
}

/** A rectangle relative to a node. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a view draws a node's outline: `outline` as the node has it, `"solid"` where left out, the
 *  dash segments the engine laid of a dashed one, and the inner rectangle once the engine handed
 *  it over, a frame's tab and the content below an actor's or an hourglass's drawing
 *  (REN-node-shapes-cover-uml). */
interface OutlineDrawing {
  outline: Outline;
  dashes: readonly (readonly number[])[];
  inner: Box | null;
}

/** Draws the node shape `shape` of a node `width` × `height` into `box`, its outline in the node's
 *  rectangle at its origin (REN-node-shapes-cover-uml): a content node shape white with the
 *  border of a node, blue and wider while it is selected, whatever its outline; unselected, its
 *  outline left out where `"none"` and drawn in the engine's dashes where dashed; a note's fold and
 *  a frame's tab inside it where its outline is drawn; a filled one in the near-black of a node's
 *  texts, the ringed circle as a filled circle of half the radius inside an unfilled ring, the
 *  crossed circle as an unfilled ring crossed by an X and the cross as an X alone, and outlined in
 *  blue while it is selected; and an actor's and an hourglass's drawing at the top of the node in
 *  that near-black, unfilled, their content below without a fill or a border, their bounding
 *  rectangle outlined in blue while it is selected. */
function drawShape(
  box: Graphics,
  shape: NodeShape,
  size: readonly [number, number],
  selected: boolean,
  drawing: OutlineDrawing,
): void {
  box.clear();
  const outlined = OUTLINES[shape];
  if (outlined) drawOutlined(box, shape, outlined, size, selected, drawing);
  else if (PROPORTIONS[shape] !== undefined) drawCaptioned(box, shape, size, selected, drawing);
  else drawFilled(box, shape, size, selected);
}

/** Draws the captioned node shape `shape`, `width` × `height`, into `box`, as `drawShape` says: an
 *  actor's head, body, two arms, and two legs, and an hourglass's two triangles meeting at their
 *  points, each stroked with the border's width within the drawing's box, as high as the top of the
 *  inner rectangle the engine handed over and of the node shape's proportion, centred; nothing of
 *  it until the engine has handed the inner rectangle over, or where the drawing has no height. */
function drawCaptioned(
  box: Graphics,
  shape: NodeShape,
  [width, height]: readonly [number, number],
  selected: boolean,
  { inner }: OutlineDrawing,
): void {
  const proportion = PROPORTIONS[shape]!;
  // Held to the node's width, which a resize changes before the engine hands the next one over.
  const h = Math.min(inner?.y ?? 0, Math.max(width, 0) * proportion);
  if (h > 0) drawFigure(box, shape, width, [h / proportion, h]);
  if (selected) box.rect(0, 0, width, height).stroke({ color: SELECTED_STROKE, width: 2 });
}

/** Draws the figure of the captioned node shape `shape` into `box`, `w` × `h`, centred at the top
 *  of a node `width` wide, as `drawCaptioned` says. */
function drawFigure(
  box: Graphics,
  shape: NodeShape,
  width: number,
  [w, h]: readonly [number, number],
): void {
  const x = (width - w) / 2;
  const middle = x + w / 2;
  const ink = { color: FILLED_COLOR, width: 1 };
  if (shape === "actor") {
    // A head a quarter of the drawing high, the body to 0.65 of it, the arms across at 0.35.
    const head = h / 8;
    box.circle(middle, head, head).stroke(ink);
    box
      .moveTo(middle, 2 * head)
      .lineTo(middle, 0.65 * h)
      .stroke(ink);
    box
      .moveTo(x, 0.35 * h)
      .lineTo(x + w, 0.35 * h)
      .stroke(ink);
    box
      .moveTo(x, h)
      .lineTo(middle, 0.65 * h)
      .lineTo(x + w, h)
      .stroke(ink);
  } else {
    box.poly([x, 0, x + w, 0, middle, h / 2], true).stroke(ink);
    box.poly([x, h, x + w, h, middle, h / 2], true).stroke(ink);
  }
}

/** Draws the content node shape `shape`, of `outlined`, `width` × `height`, into `box`, as
 *  `drawShape` says. */
function drawOutlined(
  box: Graphics,
  shape: NodeShape,
  outlined: (box: Graphics, width: number, height: number) => Graphics,
  [width, height]: readonly [number, number],
  selected: boolean,
  drawing: OutlineDrawing,
): void {
  const border = { color: selected ? SELECTED_STROKE : NODE_STROKE, width: selected ? 2 : 1 };
  const { outline, dashes } = drawing;
  outlined(box, width, height).fill({ color: NODE_FILL });
  if (selected || outline === "solid") outlined(box, width, height).stroke(border);
  else if (outline !== "none" && dashes.length > 0) {
    for (const [x0, y0, x1, y1] of dashes) box.moveTo(x0!, y0!).lineTo(x1!, y1!);
    box.stroke(border);
  }
  if (outline !== "none" || selected) drawInside(box, shape, [width, height], drawing, border);
}

/** Draws the filled node shape `shape`, `width` × `height`, into `box`, as `drawShape` says. */
function drawFilled(
  box: Graphics,
  shape: NodeShape,
  [width, height]: readonly [number, number],
  selected: boolean,
): void {
  const [cx, cy] = [width / 2, height / 2];
  if (shape === "bar") {
    box.rect(0, 0, width, height).fill({ color: FILLED_COLOR });
    if (selected)
      box.rect(-2, -2, width + 4, height + 4).stroke({ color: SELECTED_STROKE, width: 2 });
    return;
  }
  const ink = { color: FILLED_COLOR, width: 1 };
  if (shape === "cross") {
    box.moveTo(0, 0).lineTo(width, height).stroke(ink);
    box.moveTo(width, 0).lineTo(0, height).stroke(ink);
    if (selected)
      box.rect(-2, -2, width + 4, height + 4).stroke({ color: SELECTED_STROKE, width: 2 });
    return;
  }
  if (shape === "crossed-circle") {
    // The ring within the node, and the X between its diagonal points.
    const ring = Math.max(cx - ink.width / 2, 0);
    const d = ring * Math.SQRT1_2;
    box.circle(cx, cy, ring).stroke(ink);
    box
      .moveTo(cx - d, cy - d)
      .lineTo(cx + d, cy + d)
      .stroke(ink);
    box
      .moveTo(cx + d, cy - d)
      .lineTo(cx - d, cy + d)
      .stroke(ink);
    if (selected) box.circle(cx, cy, cx + 2).stroke({ color: SELECTED_STROKE, width: 2 });
    return;
  }
  if (shape === "ringed-circle") {
    const ring = Math.max(cx - RING_WIDTH / 2, 0);
    box.circle(cx, cy, ring).stroke({ color: FILLED_COLOR, width: RING_WIDTH });
  }
  box.circle(cx, cy, shape === "circle" ? cx : cx / 2).fill({ color: FILLED_COLOR });
  if (selected) box.circle(cx, cy, cx + 2).stroke({ color: SELECTED_STROKE, width: 2 });
}

/** Draws what a note and a frame draw inside their outline into `box`, in `border`: a note's
 *  folded corner as a triangle, and a frame's tab's lower edge and its cut corner, once the engine
 *  handed the tab over, at most as wide as the frame. */
function drawInside(
  box: Graphics,
  shape: NodeShape,
  [width, height]: readonly [number, number],
  { inner: tab }: OutlineDrawing,
  border: { color: number; width: number },
): void {
  if (shape === "note") {
    const c = foldOf(width, height);
    if (c > 0)
      box
        .moveTo(width - c, 0)
        .lineTo(width - c, c)
        .lineTo(width, c)
        .stroke(border);
  } else if (shape === "frame" && tab) {
    const [w, h] = [Math.min(tab.width, width), Math.min(tab.height, height)];
    const cut = Math.min(FRAME_CUT, w, h);
    box
      .moveTo(0, h)
      .lineTo(w - cut, h)
      .lineTo(w, h - cut)
      .lineTo(w, 0)
      .stroke(border);
  }
}

/** How deep a pentagon's point and a notch reach into a node `width` × `height`: half its height,
 *  at most a quarter of its width, as the engine's `depth` holds it. */
const depthOf = (width: number, height: number) => Math.max(Math.min(height / 2, width / 4), 0);

/** How far a note `width` × `height` is folded, as the engine's `fold` holds it. */
const foldOf = (width: number, height: number) =>
  Math.max(Math.min(NOTE_FOLD, width / 4, height / 4), 0);

/** The outline of each content node shape in a node `width` × `height`, which `drawShape` fills
 *  and borders as a node. */
const OUTLINES: Partial<
  Record<NodeShape, (box: Graphics, width: number, height: number) => Graphics>
> = {
  rectangle: (box, width, height) => box.roundRect(0, 0, width, height, RECTANGLE_RADIUS),
  "rounded-rectangle": (box, width, height) => box.roundRect(0, 0, width, height, ROUNDED_RADIUS),
  ellipse: (box, width, height) => box.ellipse(width / 2, height / 2, width / 2, height / 2),
  diamond: (box, width, height) =>
    box.poly([width / 2, 0, width, height / 2, width / 2, height, 0, height / 2], true),
  pentagon: (box, width, height) => {
    const d = depthOf(width, height);
    return box.poly([0, 0, width - d, 0, width, height / 2, width - d, height, 0, height], true);
  },
  "notched-rectangle": (box, width, height) =>
    box.poly([0, 0, width, 0, width, height, 0, height, depthOf(width, height), height / 2], true),
  note: (box, width, height) => {
    const c = foldOf(width, height);
    return box.poly([0, 0, width - c, 0, width, c, width, height, 0, height], true);
  },
  frame: (box, width, height) => box.rect(0, 0, width, height),
};

/** A part of a node shape a view drew, as its `Graphics` holds it: the kind of the primitive,
 *  its bounds in its node, its fill's or its stroke's colour, and a rounded rectangle's corner
 *  radius. */
export interface DrawnOutline {
  kind: string;
  action: "fill" | "stroke";
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  radius?: number;
}

/** What a region's view draws in place of a node shape (ARCH-regions-are-container-slots): the
 *  band of its name, its rectangle in the region and the name as drawn, cut to the band's length;
 *  and the line after it, its ends in the region and its dash pattern, none for a solid one. */
export interface DrawnRegion {
  /** The band, and its name's rotation in radians: 0, or a quarter turn anticlockwise, read
   *  from bottom to top, at the left of regions one above the other. */
  band?: { x: number; y: number; width: number; height: number; name: string; rotation: number };
  line?: { x1: number; y1: number; x2: number; y2: number; dash?: readonly [number, number] };
}

/** What the views of regions take from the engine: a name as the band of a region of a length
 *  draws it, and the thickness of a band. */
export interface Bands {
  readonly name: (name: string, length: number) => string;
  readonly thickness: number;
}

/** The colour of the line between two regions and of the edge of a name band. */
const REGION_LINE = 0x9ca3af;

/** Strokes the line from `(x1, y1)` to `(x2, y2)` into `lines`, solid, or as dashes of `dash[0]`
 *  with gaps of `dash[1]` world units from its start. */
function strokeLine(
  lines: Graphics,
  { x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number },
  dash: readonly [number, number] | undefined,
): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const style = { color: REGION_LINE, width: 1 };
  if (!dash || length === 0) {
    lines.moveTo(x1, y1).lineTo(x2, y2).stroke(style);
    return;
  }
  const [on, off] = dash;
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  for (let at = 0; at < length; at += on + off) {
    const end = Math.min(at + on, length);
    lines.moveTo(x1 + ux * at, y1 + uy * at).lineTo(x1 + ux * end, y1 + uy * end);
  }
  lines.stroke(style);
}

/** One node: its node shape, its badges' pills, its progress bars, its metrics' arrows, its texts,
 *  and its icons. A pooled view, bound to one node slot at a time; its texts and sprites come from
 *  the layer's element pool. */
export class NodeGraphic extends Container {
  /** The node's node shape. */
  private readonly box = new Graphics();
  /** The lines of the node's separators, drawn together (REN-node-content-and-hits). */
  private readonly rules = new Graphics();
  /** The dash segments of the node's dashed outline as the engine laid them, each
   *  `[x0, y0, x1, y1]` relative to its node, which inspection reports. */
  private dashes: number[][] = [];
  /** The inner rectangle of a frame, an actor, or an hourglass as the engine handed it over, none
   *  until it has, and whether the view waits for it (REN-node-shapes-cover-uml). */
  private inner: Box | null = null;
  private needsInner = false;
  /** The pills of the node's badges, drawn together. */
  private readonly pills = new Graphics();
  /** The pieces of the node's progress bars, drawn together. */
  private readonly bars = new Graphics();
  /** The arrows of the node's metrics' trends, drawn together. */
  private readonly arrows = new Graphics();
  /** The sprites of the view's icons, each in use. */
  private readonly sprites: Sprite[] = [];
  /** The icons the view drew sprites of, which inspection reads by the registry's names. */
  private icons: Icons | null = null;
  /** The icons the view's node holds where the view draws them, for a registration to draw
   *  anew without a query. */
  private iconsShown: DrawnIcon[] = [];
  /** The text objects of the view, one for each of `texts`. */
  private readonly pool: PooledText[] = [];
  /** The node the view shows. */
  nodeId = "";
  /** What the view last drew, compared by content, since a pooled view shows another node from
   *  one binding to the next: the node by identity, which the store replaces where its content
   *  changes; and how many elements the query placed of it, which differ where the elements
   *  placed do for the same node, since a level of detail places a subset of the near level's,
   *  each where the near level places it. */
  private drawn: {
    node: Readonly<NodeView> | null;
    width: number;
    height: number;
    selected: boolean;
    elements: number;
    icons: number;
  } = { node: null, width: -1, height: -1, selected: false, elements: -1, icons: -1 };
  /** The texts the view draws, for inspection. */
  texts: DrawnText[] = [];
  /** The line and the band of a region the view draws, none for a node. */
  private readonly lines = new Graphics();
  private bandText: BitmapText | null = null;
  region: DrawnRegion | null = null;
  /** How the view draws a region's name, which the layer hands it. */
  bands: Bands | null = null;

  /** Whether the node the view shows is resizable, as Comb took it; none where its data left it
   *  out. */
  get resizable(): boolean | undefined {
    return this.drawn.node?.resizable;
  }

  /** Whether the view draws its node as selected. */
  get selected(): boolean {
    return this.drawn.selected;
  }
  seen = 0;
  slot = -1;

  constructor(private readonly shared: ElementPool) {
    super();
    this.addChild(this.box, this.rules, this.lines, this.pills, this.bars, this.arrows);
    // The engine answers which node lies under the pointer; the view takes no events.
    this.eventMode = "none";
  }

  /** The texts the view draws, each with the width and the fill its text object draws it in. */
  inspected(): (Omit<DrawnText, "pill"> & { drawnWidth: number; fill: unknown })[] {
    return this.texts.map((text, i) => {
      const { view } = this.pool[i]!;
      const { kind, role, drawn, x, y, width, height } = text;
      return {
        kind,
        role,
        drawn,
        x,
        y,
        width,
        height,
        drawnWidth: view.width,
        fill: view.style.fill,
      };
    });
  }

  /** The dash segments of the view's dashed outline, as the engine laid them. */
  drawnDashes(): number[][] {
    return this.dashes.map((segment) => [...segment]);
  }

  /** The lines of separators the view's `Graphics` draws, read from its fill instructions. */
  drawnRules(): DrawnPill[] {
    return filled(this.rules);
  }

  /** The pills the view's `Graphics` draws, read from its fill instructions. */
  drawnPills(): DrawnPill[] {
    return filled(this.pills);
  }

  /** The pieces of progress bars the view's `Graphics` draws, each bar's segments and then its
   *  track, read from its fill instructions. */
  drawnBars(): DrawnPill[] {
    return filled(this.bars);
  }

  /** The sprites of icons the view draws, read from the sprites themselves. */
  drawnSprites(): DrawnSprite[] {
    return this.sprites.map((sprite) => ({
      texture: this.icons?.nameOf(sprite.texture) ?? null,
      x: sprite.x,
      y: sprite.y,
      width: sprite.width,
      height: sprite.height,
    }));
  }

  /** The arrows of metrics the view's `Graphics` draws, read from its fill instructions. */
  drawnArrows(): DrawnArrow[] {
    return this.arrows.context.instructions.flatMap((instruction) => {
      if (instruction.action !== "fill") return [];
      const { path, style } = instruction.data;
      return path.shapePath.shapePrimitives.map(({ shape }) => ({
        points: [...(shape as Polygon).points],
        color: style.color,
      }));
    });
  }

  /** The node shape the view draws, the parts of it its `Graphics` holds, and of an actor and an
   *  hourglass the box its drawing's parts span. */
  drawnShape(): {
    shape: NodeShape;
    outline: DrawnOutline[];
    outlined: Outline;
    drawing?: { x: number; y: number; width: number; height: number };
  } {
    const outline = this.box.context.instructions.flatMap((instruction) => {
      const { action } = instruction;
      if (action !== "fill" && action !== "stroke") return [];
      const { path, style } = instruction.data;
      return path.shapePath.shapePrimitives.map(({ shape }) => {
        const { x, y, width, height } = shape.getBounds();
        const drawn = { kind: shape.type, action, x, y, width, height, color: style.color };
        return shape.type === "roundedRectangle"
          ? { ...drawn, radius: (shape as RoundedRectangle).radius }
          : drawn;
      });
    });
    const { node } = this.drawn;
    const shape = node?.shape ?? "rectangle";
    const drawn = { shape, outline, outlined: node?.outline ?? "solid" };
    if (PROPORTIONS[shape] === undefined) return drawn;
    const parts = outline.filter(({ color }) => color === FILLED_COLOR);
    // A drawing of no height, or one still waiting for the inner rectangle, has no box.
    if (parts.length === 0) return drawn;
    const [left, top] = [Math.min(...parts.map((p) => p.x)), Math.min(...parts.map((p) => p.y))];
    const right = Math.max(...parts.map((p) => p.x + p.width));
    const bottom = Math.max(...parts.map((p) => p.y + p.height));
    return { ...drawn, drawing: { x: left, y: top, width: right - left, height: bottom - top } };
  }

  /** The size the node was last drawn at. */
  size = { width: 0, height: 0 };

  /** Shows `node`, `width` × `height`, its content placed by the elements `start` to `end` of
   *  `placed` and its dashes by the found node `found` of it, its icons of `icons`, drawing again
   *  only when what it shows changed, a registration among it. */
  bind(
    node: Readonly<NodeView>,
    selected: boolean,
    [width, height]: readonly [number, number],
    placed: Placed,
    [start, end, found]: readonly [number, number, number],
    icons: Icons,
  ): void {
    this.nodeId = node.id;
    const { drawn } = this;
    const dashes = dashesOf(placed, found);
    if (
      drawn.node === node &&
      drawn.width === width &&
      drawn.height === height &&
      drawn.selected === selected &&
      drawn.elements === end - start &&
      drawn.icons === icons.version &&
      sameDashes(this.dashes, dashes)
    )
      return;
    const elements = end - start;
    // A frame, an actor, and an hourglass ask for their inner rectangle anew whenever they are
    // drawn anew, so that none outlives the content or the fonts it was laid out in.
    this.inner = null;
    this.drawn = { node, width, height, selected, elements, icons: icons.version };
    this.dashes = dashes;
    this.size = { width, height };
    this.drawBox(node, width, height, selected);
    this.showRules(rulesOf(placed, start, end), selected);
    this.showTexts(textsOf(placed, start, end));
    this.showBars(barsOf(placed, start, end));
    this.showArrows(arrowsOf(placed, start, end));
    this.showIcons(iconsOf(placed, start, end), icons);
  }

  /** Draws the view's node shape anew at `width` × `height`, its content left where the query
   *  placed it, as a resize redraws it frame by frame until its release queries anew
   *  (REN-moving-layer-moves-content); nothing where it is drawn at that size already. */
  resized(width: number, height: number): void {
    const { node, selected } = this.drawn;
    if (!node || (this.size.width === width && this.size.height === height)) return;
    this.size = { width, height };
    // A binding after the release draws the whole view anew.
    this.drawn = { ...this.drawn, width: -1, height: -1 };
    this.drawBox(node, width, height, selected);
  }

  /** Draws the node shape of `node`, `width` × `height`, or where it is a region its line and its
   *  band in place of one; a frame, an actor, and an hourglass wait for their inner rectangle where
   *  the engine has not handed it over. */
  private drawBox(node: Readonly<NodeView>, width: number, height: number, selected: boolean) {
    this.lines.clear();
    if (!node.region) {
      this.region = null;
      if (this.bandText) this.bandText.visible = false;
      const shape = node.shape ?? "rectangle";
      const asks = shape === "frame" || PROPORTIONS[shape] !== undefined;
      this.needsInner = asks && this.inner === null;
      const { dashes, inner } = this;
      const drawing = { outline: node.outline ?? "solid", dashes, inner };
      drawShape(this.box, shape, [width, height], selected, drawing);
      return;
    }
    this.box.clear();
    this.region = this.drawRegion(node.region, width, height);
  }

  /** Draws the region `region`, `width` × `height`: the line after it where it is not the last
   *  of its division, at its right side or its bottom, and its name in a band at its start, at
   *  its top where it lies beside others, turned at its left where it lies above or below others
   *  (ARCH-regions-are-container-slots, *Name band*, *Lines*). */
  private drawRegion(region: RegionView, width: number, height: number): DrawnRegion {
    const drawn: DrawnRegion = {};
    if (!region.last) drawn.line = this.drawLine(region, width, height);
    const { bands } = this;
    if (region.name === undefined || !bands) {
      if (this.bandText) this.bandText.visible = false;
      return drawn;
    }
    drawn.band = this.drawBand(region.name, region.axis === "across", bands.thickness, [
      width,
      height,
    ]);
    return drawn;
  }

  /** Draws the band of the name `name` of a region `width` × `height`, `t` thick, at its top
   *  where it lies `across` beside others, else at its left, the name turned, and returns it. */
  private drawBand(
    name: string,
    across: boolean,
    t: number,
    [width, height]: readonly [number, number],
  ): NonNullable<DrawnRegion["band"]> {
    const edge = across ? { x1: 0, y1: t, x2: width, y2: t } : { x1: t, y1: 0, x2: t, y2: height };
    strokeLine(this.lines, edge, undefined);
    this.bandText ??= this.addChild(
      new BitmapText({ text: "", style: TEXT_STYLES.title, anchor: 0.5 }),
    );
    const text = this.bandText;
    text.visible = true;
    text.rotation = across ? 0 : -Math.PI / 2;
    text.position.set(across ? width / 2 : t / 2, across ? t / 2 : height / 2);
    // Cut by the engine once the layer has read the views of its buffers, which a call into the
    // engine may detach (API-bridge-columns-keep-no-size).
    this.unnamed = { name, length: across ? width : height };
    const band = across ? { x: 0, y: 0, width, height: t } : { x: 0, y: 0, width: t, height };
    return { ...band, name: "", rotation: text.rotation };
  }

  /** Draws the line after the region `region`, `width` × `height`, at its right side or its
   *  bottom, and returns it as drawn. */
  private drawLine(region: RegionView, width: number, height: number): DrawnRegion["line"] {
    const line =
      region.axis === "across"
        ? { x1: width, y1: 0, x2: width, y2: height }
        : { x1: 0, y1: height, x2: width, y2: height };
    const dash = region.line === "solid" ? undefined : region.line;
    strokeLine(this.lines, line, dash);
    return dash ? { ...line, dash: [dash[0], dash[1]] } : line;
  }

  /** The name of a region the view draws that the engine has not cut yet. */
  private unnamed: { name: string; length: number } | null = null;

  /** Draws the name of the region the view draws as the engine cuts it to its band, where it
   *  has not yet; the layer calls it once it no longer reads the views of the engine's buffers. */
  nameBand(): void {
    const { unnamed, bands, bandText, region } = this;
    if (!unnamed || !bands || !bandText || !region?.band) return;
    this.unnamed = null;
    const name = bands.name(unnamed.name, unnamed.length);
    bandText.text = name;
    region.band.name = name;
  }

  /** Draws the node shape of the frame, the actor, or the hourglass the view draws with its inner
   *  rectangle as `innerOf` hands it over, where the view waits for it; the layer calls it once it
   *  no longer reads the views of the engine's buffers. */
  drawInner(innerOf: (slot: number) => Box): void {
    const { node, selected } = this.drawn;
    if (!this.needsInner || !node) return;
    const { x, y, width, height } = innerOf(this.slot);
    this.inner = { x, y, width, height };
    this.drawBox(node, this.size.width, this.size.height, selected);
  }

  /** Draws `rules`, each separator's line filled in the colour of the node's border, the
   *  selection's while it is selected. */
  private showRules(rules: DrawnPill[], selected: boolean): void {
    this.rules.clear();
    const color = selected ? SELECTED_STROKE : NODE_STROKE;
    for (const { x, y, width, height } of rules)
      this.rules.rect(x, y, width, height).fill({ color });
  }

  /** Returns the view's texts and sprites to the layer's element pool, once the view is released;
   *  its next binding draws whatever node it shows anew. */
  release(): void {
    this.showTexts([]);
    this.rules.clear();
    this.dashes = [];
    this.inner = null;
    this.needsInner = false;
    this.lines.clear();
    this.region = null;
    if (this.bandText) this.bandText.visible = false;
    if (this.icons) this.showIcons([], this.icons);
    this.drawn = { ...this.drawn, node: null };
  }

  /** Draws the view's icons anew from `icons`, after a registration, without the engine. */
  redrawIcons(icons: Icons): void {
    this.showIcons(this.iconsShown, icons);
    this.drawn.icons = icons.version;
  }

  /** Draws a sprite of each of `icons` registered in `icons`, its texture fitted into its square;
   *  an icon none is registered under draws nothing. */
  private showIcons(drawn: DrawnIcon[], icons: Icons): void {
    this.icons = icons;
    this.iconsShown = drawn;
    let used = 0;
    for (const icon of drawn) {
      const texture = icons.get(icon.name);
      if (!texture) continue;
      let sprite = this.sprites[used];
      if (!sprite) {
        sprite = this.shared.sprites.pop() ?? new Sprite();
        this.sprites.push(sprite);
        this.addChild(sprite);
      }
      used += 1;
      sprite.texture = texture;
      const at = fitted(icon, texture.width, texture.height);
      sprite.position.set(at.x, at.y);
      sprite.setSize(at.width, at.height);
    }
    for (const sprite of this.sprites.splice(used)) {
      this.removeChild(sprite);
      this.shared.sprites.push(sprite);
    }
  }

  /** Draws `arrows`, each its triangle filled in its colour. */
  private showArrows(arrows: DrawnArrow[]): void {
    this.arrows.clear();
    for (const { points, color } of arrows) this.arrows.poly(points).fill({ color });
  }

  /** Draws `bars`, each piece within its bar's outline, which only its outer ends round; a piece
   *  of no length is drawn as none. */
  private showBars(bars: DrawnBar[]): void {
    this.bars.clear();
    for (const bar of bars) {
      const left = bar[0]!.x;
      const right = bar.at(-1)!.x + bar.at(-1)!.width;
      const radius = Math.min(BAR_RADIUS, bar[0]!.height / 2, (right - left) / 2);
      for (const piece of bar) {
        if (piece.width <= 0) continue;
        this.bars.poly(pieceOutline(piece, left, right, radius)).fill({ color: piece.color });
      }
    }
  }

  /** Draws `texts`, a badge's on its pill, inside the pill's padding, taking text objects from
   *  the layer's element pool where the view holds too few and returning those it holds beyond. */
  private showTexts(texts: DrawnText[]): void {
    this.texts = texts;
    this.pills.clear();
    texts.forEach((text, i) => {
      let pooled = this.pool[i];
      const style = styleOf(text);
      if (!pooled) {
        pooled = this.shared.texts.pop() ?? { view: new BitmapText({ text: "", style }), style };
        this.pool.push(pooled);
        this.addChild(pooled.view);
      }
      if (pooled.style !== style) {
        pooled.view.style = style;
        pooled.style = style;
      }
      pooled.view.text = text.drawn;
      // A trend's colour on the text object's own style, set only where it changed.
      if (text.trend !== undefined && pooled.view.style.fill !== text.trend)
        pooled.view.style.fill = text.trend;
      if (text.pill) {
        const { x, y, width, height } = text;
        this.pills
          .roundRect(x, y, width, height, Math.min(width, height) / 2)
          .fill({ color: text.pill.color });
        pooled.view.position.set(text.pill.textX, text.pill.textY);
      } else pooled.view.position.set(text.x, text.y);
    });
    for (const pooled of this.pool.splice(texts.length)) {
      this.removeChild(pooled.view);
      this.shared.texts.push(pooled);
    }
  }
}

/** The shapes `graphics` fills, each by the bounds of its path and its colour. */
function filled(graphics: Graphics): DrawnPill[] {
  return graphics.context.instructions.flatMap((instruction) => {
    if (instruction.action !== "fill") return [];
    const { path, style } = instruction.data;
    const { minX, minY, width, height } = path.bounds;
    return [{ x: minX, y: minY, width, height, color: style.color }];
  });
}

/** The nodes layer: a pooled view for every node slot the query found, and none for the rest. */
export class NodesContainer extends Container {
  /** How its views draw a region's name, which the scene hands it from the engine. */
  bands: Bands | null = null;
  private readonly elements = new ElementPool();
  private readonly views = new Bindings(
    this,
    () => new NodeGraphic(this.elements),
    (view) => view.release(),
  );

  /** How many views the layer's pool has made. */
  get created(): number {
    return this.views.created;
  }

  /** Draws the icons of every bound view anew from `icons`, after a registration. */
  redrawIcons(icons: Icons): void {
    for (const view of this.children as NodeGraphic[]) view.redrawIcons(icons);
  }

  /** Moves the views bound to `slots`, the nodes a drag moves, to their places in `positions`,
   *  keeping their content and their place among the views, and draws the node shape of one a
   *  resize changed anew at its size in `sizes` (REN-moving-layer-moves-content). */
  place(slots: readonly number[], positions: Float32Array, sizes: Float32Array): void {
    for (const slot of slots) {
      const view = this.views.boundTo(slot);
      view?.position.set(positions[slot * 2], positions[slot * 2 + 1]);
      view?.resized(sizes[slot * 2]!, sizes[slot * 2 + 1]!);
    }
  }

  /** Binds a view to each of `slots`, the nodes a query found, at their places in `positions` and
   *  of their sizes in `sizes`, their content as the query placed it in `placed`, the elements
   *  drawn at its level alone, their icons of `icons`; the content of the node at `i` of `slots`
   *  lies at `first + i` of `placed`, which holds the containers' content before the other
   *  nodes' (ARCH-engine-edits-nested-graph). */
  sync(
    state: GraphView,
    slots: Uint32Array,
    positions: Float32Array,
    sizes: Float32Array,
    placed: Placed,
    icons: Icons,
    first = 0,
  ): void {
    const selected = state.selection?.kind === "node" ? state.selection.id : null;
    this.views.begin();
    slots.forEach((slot, i) => {
      const node = state.nodes[slot];
      if (!node) return;
      const view = this.views.bind(slot);
      const [start, end] = [placed.bounds[first + i]!, placed.bounds[first + i + 1]!];
      const [width, height] = [sizes[slot * 2]!, sizes[slot * 2 + 1]!];
      view.bands = this.bands;
      const at = [start, end, first + i] as const;
      view.bind(node, node.id === selected, [width, height], placed, at, icons);
      view.position.set(positions[slot * 2], positions[slot * 2 + 1]);
    });
    this.views.end();
  }

  /** Has each view cut the name of the region it draws; called once no view of the engine's
   *  buffers is read any more in the frame, since the call into the engine may detach them. */
  nameBands(): void {
    for (const view of this.children as NodeGraphic[]) view.nameBand();
  }

  /** Has each view of a frame, an actor, or an hourglass draw its node shape with its inner
   *  rectangle as `innerOf` hands it over, where it waits for it; called once no view of the
   *  engine's buffers is read any more in the frame (REN-node-shapes-cover-uml). */
  drawInners(innerOf: (slot: number) => Box): void {
    for (const view of this.children as NodeGraphic[]) view.drawInner(innerOf);
  }
}
