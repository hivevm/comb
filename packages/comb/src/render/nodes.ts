// The nodes layer at the near and the middle level (ADR-0027): a pooled view per node in view, its
// box and its content (ADR-0013), every text as `BitmapText`. The engine lays the content out and
// the view draws each text where the engine placed it, cut where it was cut, an action's in the
// link colour: near every text, middle the texts of role title alone, at the place near gives
// them.
import {
  BitmapFontManager,
  BitmapText,
  Container,
  Graphics,
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

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xd0d4dc;
const SELECTED_STROKE = 0x3b82f6;
const TEXT_COLOR = 0x1f2430;
const CAPTION_COLOR = 0x6b7280;
const LINK_COLOR = 0x2563eb;

/** The style each role's texts are drawn in; the title's is that of the title before content. */
export const TEXT_STYLES: Readonly<Record<TextRole, TextStyleOptions>> = {
  title: { fontFamily: "Arial", fontSize: 14, fill: TEXT_COLOR },
  body: { fontFamily: "Arial", fontSize: 12, fill: TEXT_COLOR },
  caption: { fontFamily: "Arial", fontSize: 11, fill: CAPTION_COLOR },
};

/** The style an action's text is drawn in: the body's font, which the engine lays it out in, in
 *  the link colour. */
export const ACTION_STYLE: TextStyleOptions = { ...TEXT_STYLES.body, fill: LINK_COLOR };

/** The style of a text of `kind` and `role`. */
const styleOf = (kind: ContentElement["kind"], role: TextRole) =>
  kind === "action" ? ACTION_STYLE : TEXT_STYLES[role];

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

/** One text a view draws: where the engine placed it in its node, and what of it is drawn, the
 *  text or as much of it as fits followed by an ellipsis. */
export interface DrawnText {
  kind: ContentElement["kind"];
  role: TextRole;
  drawn: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The texts of the elements `start` to `end` of `placed`; at the middle level the texts of role
 *  title alone, no action among them. */
function textsOf(placed: Placed, start: number, end: number, titlesOnly: boolean): DrawnText[] {
  const texts: DrawnText[] = [];
  for (let i = start; i < end; i++) {
    const kind = KIND_NAMES[placed.kinds[i]!]!;
    const role = ROLE_NAMES[placed.roles[i]!]!;
    if (titlesOnly && (kind !== "text" || role !== "title")) continue;
    const drawn = placed.texts.slice(placed.textBounds[i], placed.textBounds[i + 1]);
    const r = placed.rects.subarray(i * 4, i * 4 + 4);
    texts.push({ kind, role, drawn, x: r[0]!, y: r[1]!, width: r[2]!, height: r[3]! });
  }
  return texts;
}

/** One node: its box and its texts. A pooled view, bound to one node slot at a time. */
export class NodeGraphic extends Container {
  private readonly box = new Graphics();
  /** The pooled text objects of the view, the first `texts.length` of them in use. */
  private readonly pool: { view: BitmapText; style: TextStyleOptions }[] = [];
  /** The node the view shows. */
  nodeId = "";
  /** What the view last drew, compared by content, since a pooled view shows another node from
   *  one binding to the next: the node by identity, which the store replaces where its content
   *  changes. */
  private drawn: {
    node: Readonly<NodeView> | null;
    width: number;
    height: number;
    selected: boolean;
    titlesOnly: boolean;
  } = { node: null, width: -1, height: -1, selected: false, titlesOnly: false };
  /** The texts the view draws, for inspection. */
  texts: DrawnText[] = [];

  /** Whether the view draws its node as selected. */
  get selected(): boolean {
    return this.drawn.selected;
  }
  seen = 0;
  slot = -1;

  constructor() {
    super();
    this.addChild(this.box);
    // The engine answers which node lies under the pointer; the view takes no events.
    this.eventMode = "none";
  }

  /** The texts the view draws, each with the width its text object draws it at. */
  inspected(): (DrawnText & { drawnWidth: number })[] {
    return this.texts.map((text, i) => ({ ...text, drawnWidth: this.pool[i]!.view.width }));
  }

  /** The size the node was last drawn at. */
  size = { width: 0, height: 0 };

  /** Shows `node`, `width` × `height`, its content placed by the elements `start` to `end` of
   *  `placed`, drawing again only when what it shows changed. */
  bind(
    node: Readonly<NodeView>,
    selected: boolean,
    height: number,
    titlesOnly: boolean,
    placed: Placed,
    start: number,
    end: number,
  ): void {
    this.nodeId = node.id;
    const { drawn } = this;
    const { width } = node;
    if (
      drawn.node === node &&
      drawn.width === width &&
      drawn.height === height &&
      drawn.selected === selected &&
      drawn.titlesOnly === titlesOnly
    )
      return;
    this.drawn = { node, width, height, selected, titlesOnly };
    this.size = { width, height };
    this.box
      .clear()
      .roundRect(0, 0, width, height, 6)
      .fill({ color: NODE_FILL })
      .stroke({ color: selected ? SELECTED_STROKE : NODE_STROKE, width: selected ? 2 : 1 });
    this.showTexts(textsOf(placed, start, end, titlesOnly));
  }

  /** Draws `texts`, taking text objects from the view's pool and leaving the rest out. */
  private showTexts(texts: DrawnText[]): void {
    this.texts = texts;
    texts.forEach((text, i) => {
      let pooled = this.pool[i];
      const style = styleOf(text.kind, text.role);
      if (!pooled) {
        pooled = { view: new BitmapText({ text: "", style }), style };
        this.pool.push(pooled);
      } else if (pooled.style !== style) {
        pooled.view.style = style;
        pooled.style = style;
      }
      pooled.view.text = text.drawn;
      pooled.view.position.set(text.x, text.y);
      if (pooled.view.parent !== this) this.addChild(pooled.view);
    });
    for (let i = texts.length; i < this.pool.length; i++) {
      const { view } = this.pool[i]!;
      if (view.parent === this) this.removeChild(view);
    }
  }
}

/** The nodes layer: a pooled view for every node slot the query found, and none for the rest. */
export class NodesContainer extends Container {
  private readonly views = new Bindings(this, () => new NodeGraphic());

  /** How many views the layer's pool has made. */
  get created(): number {
    return this.views.created;
  }

  /** Binds a view to each of `slots`, the nodes a query found, at their places in `positions` and
   *  of their sizes in `sizes`, their content placed by `placed`; at the middle level, where
   *  `titlesOnly`, the texts of role title alone. */
  sync(
    state: GraphView,
    slots: Uint32Array,
    positions: Float32Array,
    sizes: Float32Array,
    placed: Placed,
    titlesOnly: boolean,
  ): void {
    const selected = state.selection?.kind === "node" ? state.selection.id : null;
    this.views.begin();
    slots.forEach((slot, i) => {
      const node = state.nodes[slot];
      if (!node) return;
      const view = this.views.bind(slot);
      const [start, end] = [placed.bounds[i]!, placed.bounds[i + 1]!];
      view.bind(node, node.id === selected, sizes[slot * 2 + 1]!, titlesOnly, placed, start, end);
      view.position.set(positions[slot * 2], positions[slot * 2 + 1]);
    });
    this.views.end();
  }
}
