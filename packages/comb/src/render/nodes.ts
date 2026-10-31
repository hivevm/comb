// The nodes layer at the near and the middle level (ADR-0027): a pooled view per node in view, its
// box and its content (ADR-0013), every text as `BitmapText`. The engine lays the content out and
// the view draws each text where the engine placed it, cut where it was cut, an action's in the
// link colour, a badge's on its pill, each progress bar as the segments and the track the engine
// cut its bar into, and each metric as its caption, its value, and its trend's text and arrow, the
// last two in the trend's colour, and each icon as a sprite of the texture the host application
// registered under its name, fitted into its square. It draws what the query placed, which elements
// a level of detail keeps being the engine's to decide.
import {
  BitmapFontManager,
  BitmapText,
  Container,
  Graphics,
  type Polygon,
  Sprite,
  TextStyle,
  type TextStyleOptions,
} from "pixi.js";
import {
  KIND_NAMES,
  ROLE_NAMES,
  type ContentElement,
  type FontMetrics,
  type Placed,
  type TextRole,
} from "../bridge";
import type { GraphView, NodeView } from "../store";
import { Bindings } from "./bindings";
import type { Icons } from "./icons";

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xd0d4dc;
const SELECTED_STROKE = 0x3b82f6;
const TEXT_COLOR = 0x1f2430;
const CAPTION_COLOR = 0x6b7280;
const LINK_COLOR = 0x2563eb;
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
 *  both contrast alike, as on an edge label's pill (ADR-0013). */
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
 *  character, and the role's line height (ADR-0013). */
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
    if (first === last) continue;
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
 *  (ADR-0027). */
class ElementPool {
  readonly texts: PooledText[] = [];
  readonly sprites: Sprite[] = [];
}

/** One node: its box, its badges' pills, its progress bars, its metrics' arrows, its texts, and
 *  its icons. A pooled view, bound to one node slot at a time; its texts and sprites come from the
 *  layer's element pool. */
export class NodeGraphic extends Container {
  private readonly box = new Graphics();
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

  /** Whether the view draws its node as selected. */
  get selected(): boolean {
    return this.drawn.selected;
  }
  seen = 0;
  slot = -1;

  constructor(private readonly shared: ElementPool) {
    super();
    this.addChild(this.box, this.pills, this.bars, this.arrows);
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

  /** The size the node was last drawn at. */
  size = { width: 0, height: 0 };

  /** Shows `node`, `width` × `height`, its content placed by the elements `start` to `end` of
   *  `placed`, its icons of `icons`, drawing again only when what it shows changed, a
   *  registration among it. */
  bind(
    node: Readonly<NodeView>,
    selected: boolean,
    height: number,
    placed: Placed,
    start: number,
    end: number,
    icons: Icons,
  ): void {
    this.nodeId = node.id;
    const { drawn } = this;
    const { width } = node;
    if (
      drawn.node === node &&
      drawn.width === width &&
      drawn.height === height &&
      drawn.selected === selected &&
      drawn.elements === end - start &&
      drawn.icons === icons.version
    )
      return;
    this.drawn = { node, width, height, selected, elements: end - start, icons: icons.version };
    this.size = { width, height };
    this.box
      .clear()
      .roundRect(0, 0, width, height, 6)
      .fill({ color: NODE_FILL })
      .stroke({ color: selected ? SELECTED_STROKE : NODE_STROKE, width: selected ? 2 : 1 });
    this.showTexts(textsOf(placed, start, end));
    this.showBars(barsOf(placed, start, end));
    this.showArrows(arrowsOf(placed, start, end));
    this.showIcons(iconsOf(placed, start, end), icons);
  }

  /** Returns the view's texts and sprites to the layer's element pool, once the view is released;
   *  its next binding draws whatever node it shows anew. */
  release(): void {
    this.showTexts([]);
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

  /** Binds a view to each of `slots`, the nodes a query found, at their places in `positions` and
   *  of their sizes in `sizes`, their content as the query placed it in `placed`, the elements
   *  drawn at its level alone, their icons of `icons`. */
  sync(
    state: GraphView,
    slots: Uint32Array,
    positions: Float32Array,
    sizes: Float32Array,
    placed: Placed,
    icons: Icons,
  ): void {
    const selected = state.selection?.kind === "node" ? state.selection.id : null;
    this.views.begin();
    slots.forEach((slot, i) => {
      const node = state.nodes[slot];
      if (!node) return;
      const view = this.views.bind(slot);
      const [start, end] = [placed.bounds[i]!, placed.bounds[i + 1]!];
      const height = sizes[slot * 2 + 1]!;
      view.bind(node, node.id === selected, height, placed, start, end, icons);
      view.position.set(positions[slot * 2], positions[slot * 2 + 1]);
    });
    this.views.end();
  }
}
