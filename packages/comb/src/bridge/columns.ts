// The writers of a load's columns (ADR-0010, *Graph data of a load*): the columns of the nodes,
// their content among them, and of the edges, which `api/snapshot.ts` writes from the primitives
// it reads, one string column in pieces and one typed array per field, and the codes of kinds,
// roles, directions, arrowheads, and sides they cross as. `index.ts` re-exports them and hands the
// columns to the engine.
import {
  ArrowCode,
  DirectionCode,
  EdgeField,
  KindCode,
  NodeField,
  NodeShapeCode,
  RoleCode,
  SideCode,
  type Arrow,
  type ContentElement,
  type Dock,
  type NodeShape,
  type TextRole,
  type TrendDirection,
} from "../../wasm/engine.js";

/** The most UTF-16 code units of a piece of a string column the snapshot hands the engine
 *  (ADR-0010): half of V8's maximum string length, the smallest of the evergreen engines'. */
export const PIECE_BOUND = 2 ** 28;

/** The content of a load's nodes as the engine's `loadGraph` takes it (ADR-0010), the nodes'
 *  elements in slot order, each node's rows in their order and each row's elements in theirs: the
 *  boundaries of each node's rows, one more than there are nodes; of each row's elements, one more
 *  than there are rows; per element its kind's code, its weight, NaN for one of another type, a
 *  text's role's code and a trend's direction's code, each 0 for another kind, and a badge's or a
 *  trend's colour, NaN for one of another type and for another kind; per element the boundaries of
 *  a progress bar's segments, one more than there are elements, and per segment its fraction and
 *  its colour, NaN for one of another type; the texts, every string an element shows, a metric's
 *  caption, value, and trend's text in that order, as a string column with per text whether it is a
 *  text, 1 or 0; and the names, every string an element names and does not show, an action's
 *  identifier and an icon's registered name, as the texts. */
export interface ContentColumns {
  readonly rowBounds: Uint32Array;
  readonly elementBounds: Uint32Array;
  readonly kinds: Uint8Array;
  readonly weights: Float64Array;
  readonly roles: Uint8Array;
  readonly directions: Uint8Array;
  readonly colors: Float64Array;
  readonly segmentBounds: Uint32Array;
  readonly fractions: Float64Array;
  readonly segmentColors: Float64Array;
  readonly texts: string[];
  readonly textBounds: Uint32Array;
  readonly textValid: Uint8Array;
  readonly names: string[];
  readonly nameBounds: Uint32Array;
  readonly nameValid: Uint8Array;
}

/** The nodes of a load as the engine's `loadGraph` takes them (ADR-0010), each column in slot
 *  order: the identifiers as the values concatenated and cut into pieces, each ending where a value
 *  ends, with their boundaries in UTF-16 code units across all pieces, one more than there are
 *  nodes, a refused value empty; the numbers as the host application handed them; the node shapes
 *  as codes, one for a string that names none; the content as its columns; and the first value the
 *  engine's first pass refuses by its type, the index of its node and its field, `item` for a node
 *  that is no object, and for a shape of content its row and, below a row, its column. */
export interface NodeColumns {
  readonly ids: string[];
  readonly idBounds: Uint32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly width: Float64Array;
  readonly shape: Uint8Array;
  readonly content: ContentColumns;
  readonly refused:
    | {
        readonly index: number;
        readonly field: NodeField;
        readonly row?: number | undefined;
        readonly column?: number | undefined;
      }
    | undefined;
}

/** What writes the columns of a load's nodes, one node after another in slot order, from the
 *  primitives `api/snapshot.ts` reads of each: `node`, then its content row by row, each row's
 *  elements, the last of which ends the row, or `endRow` for a row of none or one whose last
 *  element is a progress bar, whose segments follow it before its row ends. */
export interface NodeColumnWriter {
  /** Starts the next node: an identifier that is a string is one, a number that is a number is
   *  one, a node shape that is a string crosses as its code, and any other value is refused by
   *  its type, the first of them named. */
  node(id: unknown, x: unknown, y: unknown, width: unknown, shape: unknown): void;
  /** The node's content is no list: refused by its type, and the node holds no rows. */
  noContent(): void;
  /** The next element of the row: an element's kind and role cross as their codes, its weight as
   *  given, 1 where it is absent, NaN where it is of another type, a badge's colour as given, NaN
   *  where it is absent or of another type, and a text, or an action's identifier or an icon's
   *  name, `id`, that is no string as none, each refused at its rule. */
  element(
    kind: unknown,
    role: unknown,
    weight: unknown,
    color: unknown,
    text: unknown,
    id: unknown,
    endsRow: boolean,
  ): void;
  /** The next element of the row, a metric: its weight as `element` takes one, its caption, its
   *  value, and its trend's text as texts, its trend's direction as its code, and its trend's
   *  colour as a badge's; a trend that is no object holds none of its fields, each refused at its
   *  rule. */
  metric(
    weight: unknown,
    caption: unknown,
    value: unknown,
    direction: unknown,
    color: unknown,
    trend: unknown,
    endsRow: boolean,
  ): void;
  /** The next element of the row is no object: it crosses as one of no kind, its place named. */
  noElement(endsRow: boolean): void;
  /** The next segment of the progress bar written last: a fraction and a colour that are numbers
   *  cross as given, any other value as NaN, refused at its rule. */
  segment(fraction: unknown, color: unknown): void;
  /** The progress bar written last has segments that are no list: it holds none, its place
   *  named. */
  noSegments(): void;
  /** The next segment of the progress bar written last is no object: it crosses as one of NaN,
   *  its place named. */
  noSegment(): void;
  /** The row is no list: it crosses as a row of no elements, its place named, and ends. */
  noRow(): void;
  /** Ends a row of no elements, or one whose last element was written without ending it. */
  endRow(): void;
  /** The next node, which is no object, refused as malformed unless a value before it was. */
  noObject(): void;
  /** The columns of the nodes written so far. */
  columns(): NodeColumns;
}

/** A column of at most `count` strings: the values concatenated and cut into pieces of at most
 *  `bound` UTF-16 code units, each ending where a value ends, so that no value is split between
 *  two pieces, a column of no code units in none; and the values' boundaries in UTF-16 code units
 *  across all pieces, one more than there are values. */
function stringColumn(count: number, bound: number) {
  const pieces: string[] = [];
  let values: string[] = [];
  let bounds = new Uint32Array(count + 1);
  let written = 0;
  let units = 0;
  let pieceUnits = 0;
  const cut = () => {
    if (pieceUnits > 0) pieces.push(values.join(""));
    values = [];
    pieceUnits = 0;
  };
  return {
    /** Ends the next value with `value` where it is a string, else empty; returns whether it is
     *  one. A value longer than `bound` fits in no piece, and is refused by a throw; the snapshot
     *  cuts every value to its limit plus one, far below `PIECE_BOUND`, so only a test's small
     *  bound reaches it. */
    add(value: unknown): boolean {
      const text = typeof value === "string";
      if (text) {
        const { length } = value;
        if (pieceUnits + length > bound) {
          if (length > bound) throw new RangeError(`comb: a value longer than a piece of ${bound}`);
          cut();
        }
        values.push(value);
        pieceUnits += length;
        units += length;
      }
      if (written + 1 === bounds.length) bounds = grown(bounds);
      bounds[++written] = units;
      return text;
    },
    pieces: () => {
      cut();
      return pieces;
    },
    bounds: () => bounds.subarray(0, written + 1),
  };
}

type Typed = Uint8Array | Uint32Array | Float64Array;

/** The code of each kind of element and each role by its name, typed by the generated names so
 *  that a kind or a role added in the engine fails here until it has its code (ADR-0010). */
const KINDS: Readonly<Record<ContentElement["kind"], KindCode>> = {
  text: KindCode.Text,
  action: KindCode.Action,
  badge: KindCode.Badge,
  progress: KindCode.Progress,
  metric: KindCode.Metric,
  icon: KindCode.Icon,
};
const DIRECTIONS: Readonly<Record<TrendDirection, DirectionCode>> = {
  up: DirectionCode.Up,
  down: DirectionCode.Down,
  flat: DirectionCode.Flat,
};
export const ROLES: Readonly<Record<TextRole, RoleCode>> = {
  title: RoleCode.Title,
  body: RoleCode.Body,
  caption: RoleCode.Caption,
};

/** The code of the kind `kind` names, `Unnamed` for any other value: compared with each name,
 *  which `KINDS` holds, so that a value is looked at by equality alone. */
function kindCode(kind: unknown): KindCode {
  switch (kind) {
    case "text":
      return KINDS.text;
    case "action":
      return KINDS.action;
    case "badge":
      return KINDS.badge;
    case "progress":
      return KINDS.progress;
    case "metric":
      return KINDS.metric;
    case "icon":
      return KINDS.icon;
    default:
      return KindCode.Unnamed;
  }
}

/** The code of the direction `direction` names, `Unnamed` for any other value, as `kindCode`
 *  finds it. */
function directionCode(direction: unknown): DirectionCode {
  switch (direction) {
    case "up":
      return DIRECTIONS.up;
    case "down":
      return DIRECTIONS.down;
    case "flat":
      return DIRECTIONS.flat;
    default:
      return DirectionCode.Unnamed;
  }
}

/** The code of the role `role` names, `Unnamed` for any other value, as `kindCode` finds it. */
function roleCode(role: unknown): RoleCode {
  switch (role) {
    case "title":
      return ROLES.title;
    case "body":
      return ROLES.body;
    case "caption":
      return ROLES.caption;
    default:
      return RoleCode.Unnamed;
  }
}

/** Whether `value` stands for a field left out: null or undefined. */
const absent = (value: unknown) => value === undefined || value === null;

/** The weight of a column left out (ADR-0013). */
const WEIGHT = 1;

/** A writer of the columns of `count` nodes, their content of about one row of one element each,
 *  which grows past that, its strings in pieces of at most `bound` code units; it names the first
 *  value refused by its type. Each value is written into its typed array in place, without a call
 *  per value, since a load writes several per node. It looks at a value by `typeof` and at a
 *  string's length and its equality with a name only, so that no value it is handed runs code. */
class NodeWriter implements NodeColumnWriter {
  private readonly ids: ReturnType<typeof stringColumn>;
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly width: Float64Array;
  private readonly shape: ReturnType<typeof codeColumn<NodeShapeCode>>;
  /** The index of the node being written, and whether one is. */
  private at = 0;
  private open = false;
  private refused: NodeColumns["refused"];
  private rowBounds: Uint32Array;
  private elementBounds: Uint32Array;
  private kinds: Uint8Array;
  private weights: Float64Array;
  private roles: Uint8Array;
  private directions: Uint8Array;
  private colors: Float64Array;
  private segmentBounds: Uint32Array;
  private fractions = new Float64Array(16);
  private segmentColors = new Float64Array(16);
  private segments = 0;
  private textValid: Uint8Array;
  private readonly texts: ReturnType<typeof stringColumn>;
  private nameValid = new Uint8Array(16);
  private readonly names: ReturnType<typeof stringColumn>;
  private nodes = 0;
  private rows = 0;
  private elements = 0;
  private valid = 0;
  private namesValid = 0;

  constructor(count: number, bound: number) {
    this.ids = stringColumn(count, bound);
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.width = new Float64Array(count);
    this.shape = codeColumn(count, SHAPES, NodeShapeCode.Unnamed);
    this.rowBounds = new Uint32Array(count + 1);
    this.elementBounds = new Uint32Array(count + 1);
    this.kinds = new Uint8Array(count);
    this.weights = new Float64Array(count);
    this.roles = new Uint8Array(count);
    this.directions = new Uint8Array(count);
    this.colors = new Float64Array(count);
    this.segmentBounds = new Uint32Array(count + 1);
    this.textValid = new Uint8Array(count);
    this.texts = stringColumn(count, bound);
    this.names = stringColumn(16, bound);
  }

  /** The row and column of the next element within its node. */
  private row = 0;
  private column = 0;

  /** Names the first value refused by its type, of the node being written. */
  private refuse(field: NodeField, row?: number, column?: number): void {
    this.refused ??= { index: this.at, field, row, column };
  }

  /** `value` into `column` where it is a number, else refused as `field`. */
  private number(column: Float64Array, value: unknown, field: NodeField): void {
    if (typeof value === "number") column[this.at] = value;
    else this.refuse(field);
  }

  node(id: unknown, x: unknown, y: unknown, width: unknown, shape: unknown): void {
    if (this.open) this.endNode();
    this.open = true;
    if (!this.ids.add(id)) this.refuse(NodeField.Id);
    this.number(this.x, x, NodeField.X);
    this.number(this.y, y, NodeField.Y);
    this.number(this.width, width, NodeField.Width);
    if (this.shape.add(this.at, shape)) this.refuse(NodeField.Shape);
  }

  noObject(): void {
    if (this.open) this.endNode();
    this.refuse(NodeField.Item);
    this.ids.add(undefined);
    // No rows, without a refusal of its own: the node is named as no object already.
    this.endNode();
  }

  /** The node's content is no list. */
  noContent(): void {
    this.refuse(NodeField.Content);
  }

  /** The row is no list. */
  noRow(): void {
    this.refuse(NodeField.Row, this.row);
    this.endRow();
  }

  /** Ends the row. */
  endRow(): void {
    if (this.rows + 1 === this.elementBounds.length) this.elementBounds = grown(this.elementBounds);
    this.elementBounds[++this.rows] = this.elements;
    this.row++;
    this.column = 0;
  }

  /** Ends the node being written. */
  private endNode(): void {
    this.open = false;
    if (this.nodes + 1 === this.rowBounds.length) this.rowBounds = grown(this.rowBounds);
    this.rowBounds[++this.nodes] = this.rows;
    this.row = 0;
    this.at++;
  }

  /** Room for one more element, of the next index, which it returns. */
  private next(): number {
    const at = this.elements++;
    if (at === this.kinds.length) {
      this.kinds = grown(this.kinds);
      this.weights = grown(this.weights);
      this.roles = grown(this.roles);
      this.directions = grown(this.directions);
      this.colors = grown(this.colors);
      this.textValid = grown(this.textValid);
    }
    if (at + 1 === this.segmentBounds.length) this.segmentBounds = grown(this.segmentBounds);
    this.segmentBounds[at + 1] = this.segments;
    this.column++;
    return at;
  }

  /** The next element is no object. */
  noElement(endsRow: boolean): void {
    this.refuse(NodeField.Element, this.row, this.column);
    const at = this.next();
    [this.kinds[at], this.weights[at], this.roles[at]] = [KindCode.Unnamed, Number.NaN, 0];
    [this.directions[at], this.colors[at]] = [0, Number.NaN];
    if (endsRow) this.endRow();
  }

  /** The next segment of the progress bar written last. */
  segment(fraction: unknown, color: unknown): void {
    if (this.segments === this.fractions.length) {
      this.fractions = grown(this.fractions);
      this.segmentColors = grown(this.segmentColors);
    }
    this.fractions[this.segments] = typeof fraction === "number" ? fraction : Number.NaN;
    this.segmentColors[this.segments] = typeof color === "number" ? color : Number.NaN;
    this.segmentBounds[this.elements] = ++this.segments;
  }

  /** The segments of the progress bar written last are no list. */
  noSegments(): void {
    this.refuse(NodeField.Segments, this.row, this.column - 1);
  }

  /** The next segment of the progress bar written last is no object. */
  noSegment(): void {
    this.refuse(NodeField.Segment, this.row, this.column - 1);
    this.segment(undefined, undefined);
  }

  /** The next element, of the fields read of it: a `text` fills its role and a text, an
   *  `action` a text and a name, a `badge` its colour and a text, a `progress` no string, its
   *  segments following it, an `icon` a name, and any other kind none (ADR-0010). */
  element(
    kind: unknown,
    role: unknown,
    weight: unknown,
    color: unknown,
    text: unknown,
    id: unknown,
    endsRow: boolean,
  ): void {
    const at = this.next();
    const code = kindCode(kind);
    this.kinds[at] = code;
    this.weights[at] = weightOf(weight);
    this.roles[at] = code === KindCode.Text ? roleCode(role) : 0;
    this.directions[at] = 0;
    this.colors[at] = code === KindCode.Badge && typeof color === "number" ? color : Number.NaN;
    this.strings(code, text, id);
    if (endsRow) this.endRow();
  }

  /** The next element, a metric: its direction and its colour, and its three texts. */
  metric(
    weight: unknown,
    caption: unknown,
    value: unknown,
    direction: unknown,
    color: unknown,
    trend: unknown,
    endsRow: boolean,
  ): void {
    const at = this.next();
    [this.kinds[at], this.weights[at], this.roles[at]] = [KindCode.Metric, weightOf(weight), 0];
    this.directions[at] = directionCode(direction);
    this.colors[at] = typeof color === "number" ? color : Number.NaN;
    for (const text of [caption, value, trend]) {
      if (this.valid === this.textValid.length) this.textValid = grown(this.textValid);
      this.textValid[this.valid++] = Number(this.texts.add(text));
    }
    if (endsRow) this.endRow();
  }

  /** The strings an element of `code` fills: a text of a `text`, an `action`, and a `badge`, the
   *  three of a metric being `metric`'s to fill, and a name of an action and of an icon. */
  private strings(code: KindCode, text: unknown, id: unknown): void {
    if (code === KindCode.Text || code === KindCode.Action || code === KindCode.Badge) {
      if (this.valid === this.textValid.length) this.textValid = grown(this.textValid);
      this.textValid[this.valid++] = Number(this.texts.add(text));
    }
    if (code === KindCode.Action || code === KindCode.Icon) {
      if (this.namesValid === this.nameValid.length) this.nameValid = grown(this.nameValid);
      this.nameValid[this.namesValid++] = Number(this.names.add(id));
    }
  }

  columns(): NodeColumns {
    if (this.open) this.endNode();
    return {
      ids: this.ids.pieces(),
      idBounds: this.ids.bounds(),
      x: this.x.subarray(0, this.at),
      y: this.y.subarray(0, this.at),
      width: this.width.subarray(0, this.at),
      shape: this.shape.column(this.at),
      content: this.contentColumns(),
      refused: this.refused,
    };
  }

  private contentColumns(): ContentColumns {
    return {
      rowBounds: this.rowBounds.subarray(0, this.nodes + 1),
      elementBounds: this.elementBounds.subarray(0, this.rows + 1),
      kinds: this.kinds.subarray(0, this.elements),
      weights: this.weights.subarray(0, this.elements),
      roles: this.roles.subarray(0, this.elements),
      directions: this.directions.subarray(0, this.elements),
      colors: this.colors.subarray(0, this.elements),
      segmentBounds: this.segmentBounds.subarray(0, this.elements + 1),
      fractions: this.fractions.subarray(0, this.segments),
      segmentColors: this.segmentColors.subarray(0, this.segments),
      texts: this.texts.pieces(),
      textBounds: this.texts.bounds(),
      textValid: this.textValid.subarray(0, this.valid),
      names: this.names.pieces(),
      nameBounds: this.names.bounds(),
      nameValid: this.nameValid.subarray(0, this.namesValid),
    };
  }
}

/** A weight as the host application handed it: 1 where it is absent, NaN where it is of another
 *  type. */
const weightOf = (weight: unknown) =>
  absent(weight) ? WEIGHT : typeof weight === "number" ? weight : Number.NaN;

/** `array` with its values in one twice as long. */
function grown<T extends Typed>(array: T): T {
  const twice = new (array.constructor as new (length: number) => T)(
    Math.max(16, array.length * 2),
  );
  twice.set(array);
  return twice;
}

/** A writer of the columns of at most `count` nodes, its strings in pieces of at most `bound` code
 *  units. It looks at a value by `typeof` and at a string's length only, so that no value it is
 *  handed runs code. */
export function nodeColumns(count: number, bound: number): NodeColumnWriter {
  return new NodeWriter(count, bound);
}

/** The edges of a load as the engine's `loadGraph` takes them (ADR-0010), each column in slot
 *  order: the identifiers, sources, targets, and label texts each as the values concatenated and
 *  cut into pieces, each ending where a value ends, with their boundaries in UTF-16 code units
 *  across all pieces, one more than there are edges, a refused or absent value empty; per label
 *  text whether it is a text, 1 or 0; whether a label, its background, and a dash are present, 1
 *  or 0; the numbers as the host application handed them, a background of another type NaN; the
 *  arrowhead and the sides as codes, one for a string that names none; and the first value the
 *  engine's first pass refuses by its type, the index of its edge and its field, `item` for an
 *  edge that is no object. */
export interface EdgeColumns {
  readonly ids: string[];
  readonly idBounds: Uint32Array;
  readonly sources: string[];
  readonly sourceBounds: Uint32Array;
  readonly targets: string[];
  readonly targetBounds: Uint32Array;
  readonly hasLabel: Uint8Array;
  readonly labels: string[];
  readonly labelBounds: Uint32Array;
  readonly labelTexts: Uint8Array;
  readonly labelT: Float64Array;
  readonly labelOffset: Float64Array;
  readonly hasBackground: Uint8Array;
  readonly background: Float64Array;
  readonly color: Float64Array;
  readonly hasDash: Uint8Array;
  readonly dash: Float64Array;
  readonly gap: Float64Array;
  readonly arrow: Uint8Array;
  readonly sourceSide: Uint8Array;
  readonly targetSide: Uint8Array;
  readonly refused: { readonly index: number; readonly field: EdgeField } | undefined;
}

/** What writes the columns of a load's edges, one edge after another in slot order. */
export interface EdgeColumnWriter {
  /** The next edge, from the plain data `api/snapshot.ts` read of it: an identifier, a source, or
   *  a target that is a string is one, a number that is a number is one, a label that is an
   *  object and a dash that is a list of two are read for their fields, null or undefined is an
   *  absent label, dash, or background, and an arrowhead or a side that is a string crosses as its
   *  code; any other value is refused by its type, the first of them named, a label text and a
   *  background at their rule. */
  edge(
    id: unknown,
    source: unknown,
    target: unknown,
    label: unknown,
    color: unknown,
    dash: unknown,
    arrow: unknown,
    sourceSide: unknown,
    targetSide: unknown,
  ): void;
  /** The next edge, which is no object, refused as malformed unless a value before it was. */
  noObject(): void;
  /** The columns of the edges written so far. */
  columns(): EdgeColumns;
}

/** The code of each arrowhead, side, and node shape by its name, typed by the generated names so
 *  that one added in the engine fails here until it has its code. */
const ARROWS: Readonly<Record<Arrow, ArrowCode>> = { end: ArrowCode.End, none: ArrowCode.None };
const SHAPES: Readonly<Record<NodeShape, NodeShapeCode>> = {
  rectangle: NodeShapeCode.Rectangle,
  "rounded-rectangle": NodeShapeCode.RoundedRectangle,
  ellipse: NodeShapeCode.Ellipse,
  circle: NodeShapeCode.Circle,
  "ringed-circle": NodeShapeCode.RingedCircle,
  diamond: NodeShapeCode.Diamond,
  bar: NodeShapeCode.Bar,
};
const SIDES: Readonly<Record<Dock, SideCode>> = {
  top: SideCode.Top,
  right: SideCode.Right,
  bottom: SideCode.Bottom,
  left: SideCode.Left,
  outline: SideCode.Outline,
};

/** The code of `name` in `codes`, `unnamed` for a string that names none of them, or none for a
 *  value that is no string. */
function codeOf<C>(codes: Readonly<Record<string, C>>, name: unknown, unnamed: C): C | undefined {
  if (typeof name !== "string") return undefined;
  return Object.hasOwn(codes, name) ? codes[name] : unnamed;
}

/** The columns of at most `count` labels: whether each edge has one, its text, `t`, offset, and
 *  background. */
function labelColumns(count: number, bound: number) {
  const texts = stringColumn(count, bound);
  const hasLabel = new Uint8Array(count);
  const labelTexts = new Uint8Array(count);
  const labelT = new Float64Array(count);
  const labelOffset = new Float64Array(count);
  const hasBackground = new Uint8Array(count);
  const background = new Float64Array(count);
  return {
    /** Writes the label of the edge at `at`, and returns the first of its fields refused by its
     *  type, or none. */
    add(at: number, label: unknown): EdgeField | undefined {
      if (typeof label !== "object" || label === null) {
        texts.add(undefined);
        return absent(label) ? undefined : EdgeField.Label;
      }
      const fields = label as Record<string, unknown>;
      hasLabel[at] = 1;
      labelTexts[at] = Number(texts.add(fields.text));
      if (!absent(fields.background)) {
        hasBackground[at] = 1;
        background[at] = typeof fields.background === "number" ? fields.background : Number.NaN;
      }
      const { t, offset } = fields;
      if (typeof t === "number") labelT[at] = t;
      if (typeof offset === "number") labelOffset[at] = offset;
      if (typeof t !== "number") return EdgeField.LabelT;
      return typeof offset === "number" ? undefined : EdgeField.LabelOffset;
    },
    columns: (written: number) => ({
      hasLabel: hasLabel.subarray(0, written),
      labels: texts.pieces(),
      labelBounds: texts.bounds(),
      labelTexts: labelTexts.subarray(0, written),
      labelT: labelT.subarray(0, written),
      labelOffset: labelOffset.subarray(0, written),
      hasBackground: hasBackground.subarray(0, written),
      background: background.subarray(0, written),
    }),
  };
}

/** The columns of at most `count` dash patterns: whether each edge has one, its dash, and its
 *  gap. */
function dashColumns(count: number) {
  const hasDash = new Uint8Array(count);
  const dash = new Float64Array(count);
  const gap = new Float64Array(count);
  return {
    /** Writes the dash pattern of the edge at `at`, and returns whether it is refused by its
     *  type: neither left out nor a list of two numbers. */
    add(at: number, pattern: unknown): boolean {
      if (absent(pattern)) return false;
      const [length, space] = Array.isArray(pattern) && pattern.length === 2 ? pattern : [];
      if (typeof length !== "number" || typeof space !== "number") return true;
      hasDash[at] = 1;
      dash[at] = length;
      gap[at] = space;
      return false;
    },
    columns: (written: number) => ({
      hasDash: hasDash.subarray(0, written),
      dash: dash.subarray(0, written),
      gap: gap.subarray(0, written),
    }),
  };
}

/** A column of at most `count` codes of names in `codes`, `unnamed` for a string that names
 *  none. */
function codeColumn<C extends number>(
  count: number,
  codes: Readonly<Record<string, C>>,
  unnamed: C,
) {
  const column = new Uint8Array(count);
  return {
    /** Writes the code of `name` at `at`, and returns whether it is refused by its type: no
     *  string. */
    add(at: number, name: unknown): boolean {
      const code = codeOf(codes, name, unnamed);
      if (code !== undefined) column[at] = code;
      return code === undefined;
    },
    column: (written: number) => column.subarray(0, written),
  };
}

/** A writer of the columns of at most `count` edges, its strings in pieces of at most `bound` code
 *  units. It looks at a value by `typeof` and at a string's length, and reads the fields of a
 *  label and the items of a dash, which are the snapshot's own plain data, so that no value of
 *  the host application it is handed runs code. */
export function edgeColumns(count: number, bound: number): EdgeColumnWriter {
  const ids = stringColumn(count, bound);
  const sources = stringColumn(count, bound);
  const targets = stringColumn(count, bound);
  const labels = labelColumns(count, bound);
  const color = new Float64Array(count);
  const dashes = dashColumns(count);
  const arrows = codeColumn(count, ARROWS, ArrowCode.Unnamed);
  const sourceSides = codeColumn(count, SIDES, SideCode.Unnamed);
  const targetSides = codeColumn(count, SIDES, SideCode.Unnamed);
  let at = 0;
  let refused: EdgeColumns["refused"];
  const refuse = (field: EdgeField | undefined) => {
    if (field !== undefined) refused ??= { index: at, field };
  };
  return {
    edge(id, source, target, label, colorOf, dash, arrow, sourceSide, targetSide) {
      if (!ids.add(id)) refuse(EdgeField.Id);
      if (!sources.add(source)) refuse(EdgeField.Source);
      if (!targets.add(target)) refuse(EdgeField.Target);
      refuse(labels.add(at, label));
      if (typeof colorOf === "number") color[at] = colorOf;
      else refuse(EdgeField.Color);
      if (dashes.add(at, dash)) refuse(EdgeField.Dash);
      if (arrows.add(at, arrow)) refuse(EdgeField.Arrow);
      if (sourceSides.add(at, sourceSide)) refuse(EdgeField.SourceSide);
      if (targetSides.add(at, targetSide)) refuse(EdgeField.TargetSide);
      at++;
    },
    noObject() {
      refuse(EdgeField.Item);
      for (const column of [ids, sources, targets]) column.add(undefined);
      labels.add(at, undefined);
      at++;
    },
    columns: () => ({
      ids: ids.pieces(),
      idBounds: ids.bounds(),
      sources: sources.pieces(),
      sourceBounds: sources.bounds(),
      targets: targets.pieces(),
      targetBounds: targets.bounds(),
      ...labels.columns(at),
      color: color.subarray(0, at),
      ...dashes.columns(at),
      arrow: arrows.column(at),
      sourceSide: sourceSides.column(at),
      targetSide: targetSides.column(at),
      refused,
    }),
  };
}

/** The kind of each code of `KindCode` the bridge accepts, by the code. */
export const KIND_NAMES: Readonly<Record<number, ContentElement["kind"]>> = Object.fromEntries(
  Object.entries(KINDS).map(([name, code]) => [code, name as ContentElement["kind"]]),
);

/** The role of each code of `RoleCode`, by the code. */
export const ROLE_NAMES: Readonly<Record<number, TextRole>> = Object.fromEntries(
  Object.entries(ROLES).map(([name, code]) => [code, name as TextRole]),
);
