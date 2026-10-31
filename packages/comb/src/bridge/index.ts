// The one module that imports the WebAssembly package (ADR-0028). Structured data crosses as
// generated types through serde-wasm-bindgen, but for a load's nodes and edges, which cross as
// columns of strings in pieces or one typed array each; node positions and the results of a
// viewport query are read through views on the engine's buffers, created anew on every read
// because growing memory detaches older views (ADR-0034).
import init, {
  ArrowCode,
  checkGraphSize,
  checkContentBudget,
  badgePaddingX,
  badgePaddingY,
  checkIdBudget,
  columnLimit,
  contentBudget,
  DetailLevel,
  DirectionCode,
  EdgeField,
  idBudget,
  idLimit,
  KindCode,
  rowLimit,
  segmentLimit,
  RoleCode,
  textLimit,
  Engine,
  initSync,
  MeshDetail,
  NodeField,
  SideCode,
  type Arrow,
  type ContentElement,
  type InitOutput,
  type EdgeInput,
  type EdgePatch,
  type ElementHit,
  type ElementKind,
  type Hit,
  type GraphDataProblem,
  type NodeContent,
  type NodeInput,
  type NodePatch,
  type NumberError,
  type Side,
  type SlotError,
  type TextRole,
  type TrendDirection,
} from "../../wasm/engine.js";

export type {
  ContentElement,
  EdgeField,
  ElementHit,
  ElementKind,
  GraphDataProblem,
  NodeContent,
  NodeField,
  Hit,
  NodeInput,
  NodePatch,
  NumberError,
  SlotError,
  TextRole,
};

/** The refusal of `translate`'s delta, under the name it had before `NumberError` held it. */
export type TranslateError = NumberError;

/** The mark of plain data `api/snapshot.ts` read once from the host application's value
 *  (ADR-0028). It is exported nowhere, so that handing the bridge a value of the host
 *  application, which may hold a getter or a Proxy, takes a cast a reviewer sees. */
declare const read: unique symbol;

/** The most UTF-16 code units of a piece of a string column the snapshot hands the engine
 *  (ADR-0034): half of V8's maximum string length, the smallest of the evergreen engines'. */
export const PIECE_BOUND = 2 ** 28;

/** The content of a load's nodes as the engine's `loadGraph` takes it (ADR-0034), the nodes'
 *  elements in slot order, each node's rows in their order and each row's elements in theirs: the
 *  boundaries of each node's rows, one more than there are nodes; of each row's elements, one more
 *  than there are rows; per element its kind's code, its weight, NaN for one of another type, a
 *  text's role's code and a trend's direction's code, each 0 for another kind, and a badge's or a
 *  trend's colour, NaN for one of another type and for another kind; per element the boundaries of
 *  a progress bar's segments, one more than there are elements, and per segment its fraction and
 *  its colour, NaN for one of another type; the texts, every string an element shows, a metric's
 *  caption, value, and trend's text in that order, as a string column with per text whether it is a
 *  text, 1 or 0; and the names, every string an element names and does not show, an action's
 *  identifier, as the texts. */
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

/** The nodes of a load as the engine's `loadGraph` takes them (ADR-0034), each column in slot
 *  order: the identifiers as the values concatenated and cut into pieces, each ending where a
 *  value ends, with their boundaries in UTF-16 code units across all pieces, one more than there
 *  are nodes, a refused value empty; the numbers as the host application handed them; the
 *  content as its columns; and the first value the engine's first pass refuses by its type, the
 *  index of its node and its field, `item` for a node that is no object, and for a shape of
 *  content its row and, below a row, its column. */
export interface NodeColumns {
  readonly ids: string[];
  readonly idBounds: Uint32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly width: Float64Array;
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
   *  one, and any other value is refused by its type, the first of them named. */
  node(id: unknown, x: unknown, y: unknown, width: unknown): void;
  /** The node's content is no list: refused by its type, and the node holds no rows. */
  noContent(): void;
  /** The next element of the row: an element's kind and role cross as their codes, its weight as
   *  given, 1 where it is absent, NaN where it is of another type, a badge's colour as given, NaN
   *  where it is absent or of another type, and a text or an action's identifier `id` that is no
   *  string as none, each refused at its rule. */
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
 *  that a kind or a role added in the engine fails here until it has its code (ADR-0034). */
const KINDS: Readonly<Record<ContentElement["kind"], KindCode>> = {
  text: KindCode.Text,
  action: KindCode.Action,
  badge: KindCode.Badge,
  progress: KindCode.Progress,
  metric: KindCode.Metric,
};
const DIRECTIONS: Readonly<Record<TrendDirection, DirectionCode>> = {
  up: DirectionCode.Up,
  down: DirectionCode.Down,
  flat: DirectionCode.Flat,
};
const ROLES: Readonly<Record<TextRole, RoleCode>> = {
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

  node(id: unknown, x: unknown, y: unknown, width: unknown): void {
    if (this.open) this.endNode();
    this.open = true;
    if (!this.ids.add(id)) this.refuse(NodeField.Id);
    this.number(this.x, x, NodeField.X);
    this.number(this.y, y, NodeField.Y);
    this.number(this.width, width, NodeField.Width);
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
   *  segments following it, and any other kind none (ADR-0034). */
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

  /** The strings an element of `code` fills: a text of every kind built so far but a progress
   *  bar and a metric, whose three `metric` fills, and a name of an action. */
  private strings(code: KindCode, text: unknown, id: unknown): void {
    if (code !== KindCode.Unnamed && code !== KindCode.Progress && code !== KindCode.Metric) {
      if (this.valid === this.textValid.length) this.textValid = grown(this.textValid);
      this.textValid[this.valid++] = Number(this.texts.add(text));
    }
    if (code === KindCode.Action) {
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

/** The edges of a load as the engine's `loadGraph` takes them (ADR-0034), each column in slot
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

/** The code of each arrowhead and side by its name, typed by the generated names so that one
 *  added in the engine fails here until it has its code. */
const ARROWS: Readonly<Record<Arrow, ArrowCode>> = { end: ArrowCode.End, none: ArrowCode.None };
const SIDES: Readonly<Record<Side, SideCode>> = {
  top: SideCode.Top,
  right: SideCode.Right,
  bottom: SideCode.Bottom,
  left: SideCode.Left,
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

/** The snapshot of a load: what `snapshotOf` hands the bridge, its nodes and its edges as
 *  columns. */
export type GraphSnapshot = { readonly nodes: NodeColumns; readonly edges: EdgeColumns } & {
  readonly [read]: "graph";
};

/** The node of `addNode` read once: what `nodeSnapshotOf` returns, and the node the bridge takes. */
export type NodeSnapshot = NodeInput & { readonly [read]: "node" };

/** The plain patch of `updateNode`: what `patchOf` returns, and the patch the bridge takes. */
export type PlainPatch = NodePatch & { readonly [read]: "patch" };

/** The edge of `addEdge` read once: what `edgeSnapshotOf` returns, and the edge the bridge takes. */
export type EdgeSnapshot = EdgeInput & { readonly [read]: "edge" };

/** The plain patch of `updateEdge`: what `edgePatchOf` returns, and the patch the bridge takes. */
export type PlainEdgePatch = EdgePatch & { readonly [read]: "edgePatch" };

/** A rectangle in world coordinates. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The triangles of the found edges: per vertex its position `x, y`, its distance along its
 *  path, its colour as RGBA bytes, and its dash pattern `dash, gap` (0, 0 for solid); three
 *  vertex indices per triangle. */
export interface EdgeMesh {
  positions: Float32Array;
  distances: Float32Array;
  colors: Uint32Array;
  dashes: Float32Array;
  indices: Uint32Array;
}

/** The detail of a query's edge mesh (ADR-0027): complete, or coarsened where an edge was drawn
 *  as its chord, or left out, for the mesh budget or for memory. */
export type Detail = "complete" | "coarsened";

const DETAILS: Record<MeshDetail, Detail> = {
  [MeshDetail.Complete]: "complete",
  [MeshDetail.Coarsened]: "coarsened",
};

/** Where the elements of the content of the nodes a query found lie and what they draw
 *  (ADR-0013), at the near and the middle level: per found node, in their order, the boundaries
 *  of its elements in the other columns, one more than there are found nodes; per element, its
 *  node's elements in the order of its rows and theirs, its rectangle `x, y, width, height`
 *  relative to its node's top-left corner, its kind's code, the role whose font draws its text,
 *  body for an action, a badge, and a progress bar, its colour as `0xRRGGBB`, a badge's pill's and
 *  0 for an element of no colour, and what is drawn of its text, the text or as much of it as fits
 *  followed by an ellipsis, those strings one after another in `texts`, cut by `textBounds`; and
 *  per element the boundaries of the pieces of its bar in `barBounds`, one more than there are
 *  elements, a progress bar's segments and then its track and no piece of another kind, each
 *  piece's rectangle `x, y, width, height` relative to its node in `bars`, and its colour in
 *  `barColors`, a segment's, 0 for the track. A metric's colour is its trend's, its role body's,
 *  and its drawn text its caption's, value's, and trend's text's one after another: per element
 *  the boundaries of its parts in `partBounds`, a metric's three and no part of another kind,
 *  each part's rectangle relative to its node in `parts`, and where its text ends in `texts` in
 *  `partEnds`, each starting where the one before it in its element ends, the first where its
 *  element's text starts; and per element the boundaries of its arrows in `arrowBounds`, a
 *  metric's one where its column holds it, each arrow's triangle as three points `x, y` relative
 *  to its node in `arrows`. At the far level it holds no node. */
export interface Placed {
  bounds: Uint32Array;
  rects: Float32Array;
  kinds: Uint8Array;
  roles: Uint8Array;
  colors: Uint32Array;
  texts: string;
  textBounds: Uint32Array;
  barBounds: Uint32Array;
  bars: Float32Array;
  barColors: Uint32Array;
  partBounds: Uint32Array;
  parts: Float32Array;
  partEnds: Uint32Array;
  arrowBounds: Uint32Array;
  arrows: Float32Array;
  /** The space between a badge's text and its pill's left side and its top, the engine's. */
  badgePadding: { x: number; y: number };
}

/** The kind of each code of `KindCode` the bridge accepts, by the code. */
export const KIND_NAMES: Readonly<Record<number, ContentElement["kind"]>> = Object.fromEntries(
  Object.entries(KINDS).map(([name, code]) => [code, name as ContentElement["kind"]]),
);

/** The role of each code of `RoleCode`, by the code. */
export const ROLE_NAMES: Readonly<Record<number, TextRole>> = Object.fromEntries(
  Object.entries(ROLES).map(([name, code]) => [code, name as TextRole]),
);

/** What a viewport query found: node slots in ascending order, the edge slot and point of each
 *  found edge label, the mesh of the found edges and its detail, where the found nodes' content
 *  lies, and the positions and sizes buffers, all read after the same call. The label points and
 *  the mesh's positions are relative to `origin`, a world point near the query's rectangle, so
 *  that `f32` rounds them by their distance from it (ADR-0034); the positions buffer is not. */
export interface Visible {
  positions: Float32Array;
  sizes: Float32Array;
  nodes: Uint32Array;
  content: Placed;
  labels: Uint32Array;
  labelPoints: Float32Array;
  mesh: EdgeMesh;
  detail: Detail;
  origin: { x: number; y: number };
}

/** The level of detail a query serves (ADR-0027): near with edge labels, middle without, far
 *  with edges as plain lines one pixel wide. */
export type Level = "near" | "middle" | "far";

const LEVELS: Record<Level, DetailLevel> = {
  near: DetailLevel.Near,
  middle: DetailLevel.Middle,
  far: DetailLevel.Far,
};

/** The edges the last query found, by slot, with the point each leaves its source and enters
 *  its target, `x, y` each. */
export interface DrawnEdges {
  slots: Uint32Array;
  ends: Float32Array;
}

/** The metrics of a font the shell draws the texts of a role with, in world units: the advance
 *  of the glyph of each code point of `codes` in `advances`, of every other character
 *  `fallback`, and the height of a line (ADR-0013). */
export interface FontMetrics {
  codes: Uint32Array;
  advances: Float64Array;
  fallback: number;
  lineHeight: number;
}

export interface Bridge {
  /** Replaces the graph; node slot `i` is the batch's node `i`, edge slot `i` its edge `i`.
   *  Throws a `GraphDataProblem`. */
  loadGraph(batch: GraphSnapshot): number;
  /** Checks `node` as a load checks a node and adds it, drawn and hit above every other node, and
   *  returns the slot the engine chose for it (ADR-0022). Throws a `GraphDataProblem`, the graph
   *  as it was. */
  addNode(node: NodeSnapshot): number;
  /** Checks `edge` as a load checks an edge, refuses one from a node to itself, and adds it
   *  between the node slots `source` and `target`, which `api` resolved; returns the slot the
   *  engine chose for it (ADR-0022). Throws a `GraphDataProblem`, and a `SlotError` where a slot
   *  of an end holds no node, the graph as it was. */
  addEdge(edge: EdgeSnapshot, source: number, target: number): number;
  /** Checks the patch of the edge `id` in `slot` as a load checks those fields and gives the edge
   *  its new style and label placement. Throws a `GraphDataProblem`, and a `SlotError` where
   *  `slot` holds no edge, the graph as it was. */
  updateEdge(slot: number, id: string, patch: PlainEdgePatch): void;
  /** Checks the patch of the node `id` in `slot` as a load checks a node's content and gives the
   *  node its new content and the height it lays out to (ADR-0013). Throws a `GraphDataProblem`,
   *  and a `SlotError` where `slot` holds no node, the graph as it was. */
  updateNode(slot: number, id: string, patch: PlainPatch): void;
  /** Hands over the metrics of the font the texts of `role` are drawn with, for every layout
   *  from then on (ADR-0013). Throws a `NumberError` `invalidFont` for metrics the engine cannot
   *  take. */
  setFont(role: TextRole, font: FontMetrics): void;
  /** The most UTF-16 code units of a text of content or a label text the bridge accepts. */
  textLimit(): number;
  /** The most rows of a node's content the bridge accepts. */
  rowLimit(): number;
  /** The most columns of a row the bridge accepts. */
  columnLimit(): number;
  /** The most segments of a progress bar the bridge accepts. */
  segmentLimit(): number;
  /** The most UTF-16 code units of an identifier the bridge accepts. */
  idLimit(): number;
  /** The most UTF-16 code units of all identifiers of one load the bridge accepts. */
  idBudget(): number;
  /** Checks how many UTF-16 code units the identifiers of one load hold. Throws a
   *  `GraphDataProblem`. */
  checkIdBudget(units: number): void;
  /** The most UTF-16 code units of the texts of content of one load the bridge accepts. */
  contentBudget(): number;
  /** Checks how many UTF-16 code units the texts of content of one load hold, the node `node`
   *  the one whose text passed the budget. Throws a `GraphDataProblem`. */
  checkContentBudget(units: number, node: string): void;
  /** Checks how many nodes and edges a graph holds, before any is copied. Throws a
   *  `GraphDataProblem`. */
  checkGraphSize(nodes: number, edges: number): void;
  /** Removes the nodes in `slots` and every edge at them, and returns the slots of those edges in
   *  ascending order (ADR-0022). Throws a `SlotError`, a mistake of the shell's, never one of
   *  graph data, the graph as it was. */
  removeNodes(slots: Uint32Array): Uint32Array;
  /** Records the half width and half height of the pill of the label of the edge in `slot`, in
   *  world units, as the labels layer draws it; a label not measured is not hit (ADR-0025).
   *  Throws a `SlotError`. */
  setLabelSize(slot: number, halfWidth: number, halfHeight: number): void;
  /** The world point of the label of the edge in `slot`, or none where it holds no edge with a
   *  label. */
  labelPoint(slot: number): { x: number; y: number } | undefined;
  /** Places the label of the edge in `slot` at the world point `(x, y)`: at the path parameter
   *  nearest it and its distance along the normal there, which it returns (G-6). Throws a
   *  `SlotError`, and a `NumberError` `nonFinitePoint` for a point that is not finite, before
   *  anything moves (ADR-0031). */
  moveLabel(slot: number, x: number, y: number): { t: number; offset: number };
  /** The slots of the edges at the nodes in `slots`, in ascending order, as a removal of them
   *  would take along, named before anything is removed (ADR-0022). Throws a `SlotError`. */
  edgesAt(slots: Uint32Array): Uint32Array;
  /** Removes the edges in `slots`. Throws a `SlotError`, the graph as it was. */
  removeEdges(slots: Uint32Array): void;
  /** Moves the nodes in `slots`, their edges with them. Throws a `SlotError` for a slot that
   *  holds no node and a `NumberError` `nonFiniteDelta` for a delta that is not finite, mistakes
   *  of the shell's, never of graph data (ADR-0031). */
  translate(slots: Uint32Array, dx: number, dy: number): void;
  /** A fresh view on the positions buffer, `x, y` per slot. Do not keep it across calls. */
  positions(): Float32Array;
  /** The content of the node in `slot`, built when asked, since the shell keeps none (ADR-0013).
   *  Throws a `SlotError` where `slot` holds no node. */
  content(slot: number): NodeContent;
  /** Fresh views on the positions buffer and on the sizes buffer, `width, height` per slot, the
   *  height each node's content lays out to (ADR-0013), both read after the same call. Do not
   *  keep them across calls. */
  nodeBuffers(): { positions: Float32Array; sizes: Float32Array };
  /** The nodes and edges that meet `rect` and the mesh of the edges for `level`, where a screen
   *  pixel is `pixel` world units, within the engine's mesh budget, and the mesh's detail; at the
   *  near and the middle level where the found nodes' content lies; at the near level also the
   *  edge labels whose point lies within `labelReach` of it. Fresh views; do
   *  not keep them across calls. Throws a `NumberError` `invalidPixel` for a pixel that is not a
   *  finite number above zero (ADR-0031). */
  query(rect: Rect, level: Level, pixel: number, labelReach: number): Visible;
  /** The edges the last query found, with their ends as they lie now, which after a move and
   *  before the next query are already moved: for inspection, not for drawing. Fresh views; do
   *  not keep them across calls. */
  drawnEdges(): DrawnEdges;
  /** What a press at the world point `(x, y)` hits where a screen pixel is `pixel` world units,
   *  at `level`: where `connectors` asks for them, at the near and middle level, a connector
   *  within 8 screen pixels, of the node drawn on top; else the node drawn on top there, else the
   *  edge drawn on top within 4 screen pixels of its path as the stroke flattens it, else nothing
   *  (ADR-0025). Throws a `NumberError`, `invalidPixel` for a pixel that is not a finite number
   *  above zero and `nonFinitePoint` for a point that is not finite (ADR-0031). */
  hit(x: number, y: number, pixel: number, level: Level, connectors: boolean): Hit;
}

/** Whether the bridge runs in test mode: under `bun test`, and in Vite's `test` mode, which the
 *  browser tests serve the example in. Code that imports this source, not the built bundle, under
 *  a tool in mode `test` turns it on; a built bundle settles the mode when it is built, and a
 *  production build replaces it by `production`, so the bundle carries none of it. */
export const TEST_MODE = import.meta.env.MODE === "test" || import.meta.env.NODE_ENV === "test";

/** The mark of each seam of test mode in a bundle that carries it: of `detaching`, a word of its
 *  error's message; of the trap, the name of the engine's export that arms it, which `wrap` looks
 *  up. scripts/check-bundle.sh reads both here, fails a shipped bundle that carries either, and
 *  fails unless it finds both in the library built in test mode and the trap's in the engine. */
const DETACHING_MARK = "comb-test-mode:detaching";
const TRAP_EXPORT = "comb_test_mode_trap";

/** Each call of `bridge` passed through `around`. */
function each(
  bridge: Bridge,
  around: <A extends unknown[], R>(call: (...args: A) => R) => (...args: A) => R,
): Bridge {
  const calls = Object.entries(bridge).map(([name, call]) => [name, around(call)]);
  return Object.fromEntries(calls) as Bridge;
}

/** `bridge` with the engine's memory grown by a page before each of its calls, so that a view
 *  kept across a call is detached and reads empty in tests, not only when memory happens to grow
 *  (ADR-0034). The message of its error carries `DETACHING_MARK`. */
function detaching(bridge: Bridge, memory: WebAssembly.Memory): Bridge {
  return each(bridge, (call) => (...args) => {
    try {
      memory.grow(1);
    } catch (cause) {
      throw new Error(`${DETACHING_MARK}: the engine's memory cannot grow further`, { cause });
    }
    return call(...args);
  });
}

/** The engine trapped, in a call of this Comb or of another on the page, and is lost for the
 *  page (ADR-0021): Comb refuses every later call that needs it, and only loading the page anew
 *  brings it back. `cause` is the trap. */
export class EngineLostError extends Error {
  constructor(options?: ErrorOptions) {
    super("comb: the engine trapped and is lost for the page; load the page anew", options);
    this.name = "EngineLostError";
  }
}

/** The trap that lost the engine, once it is lost. The engine is instantiated once per page, so
 *  one trap loses it for every Comb on the page. */
let trapped: { cause: unknown } | undefined;
const lostListeners = new Set<(error: EngineLostError) => void>();

/** Whether `error`, thrown from a call of the engine, is a trap: WebAssembly's own, or the glue's
 *  refusal of an object a trapped call left borrowed, which only a trap no guard saw leaves. Errors the bridge returns as values are
 *  plain objects, never traps (ADR-0034). */
function isTrap(error: unknown): boolean {
  return (
    error instanceof WebAssembly.RuntimeError ||
    (error instanceof Error && error.message.startsWith("recursive use of an object detected"))
  );
}

/** Throws an `EngineLostError` once the engine is lost. */
export function refuseIfLost(): void {
  if (trapped) throw new EngineLostError(trapped);
}

/** Marks the engine lost by the trap `cause`, tells the listeners once, and returns the error. */
function lose(cause: unknown): EngineLostError {
  if (!trapped) {
    trapped = { cause };
    // The glue frees a collected `Engine` through the instance, which is no longer safe to call.
    kept.push(...engines.flatMap((engine) => engine.deref() ?? []));
    const error = new EngineLostError(trapped);
    const listeners = [...lostListeners];
    lostListeners.clear();
    listeners.forEach((listener) => tell(listener, error));
  }
  return new EngineLostError(trapped);
}

/** Calls `listener` with `error`; what it throws is reported on its own, so that every listener
 *  is told and the call that trapped still throws the `EngineLostError`. */
function tell(listener: (error: EngineLostError) => void, error: EngineLostError): void {
  try {
    listener(error);
  } catch (thrown) {
    queueMicrotask(() => {
      throw thrown;
    });
  }
}

/** Every `Engine` the bridges created, held weakly until the engine is lost, and from then on
 *  strongly, so that none is freed through the trapped instance. */
const engines: WeakRef<Engine>[] = [];
const kept: Engine[] = [];

/** A new `Engine`, refused once the engine is lost, and marking it lost on a trap. */
function newEngine(): Engine {
  refuseIfLost();
  try {
    const engine = new Engine();
    engines.push(new WeakRef(engine));
    return engine;
  } catch (error) {
    throw isTrap(error) ? lose(error) : error;
  }
}

/** Calls `listener` once, with the `EngineLostError`, when the engine is lost, or at once where it
 *  is lost already; returns the function that removes it. */
export function onEngineLost(listener: (error: EngineLostError) => void): () => void {
  if (trapped) {
    tell(listener, new EngineLostError(trapped));
    return () => {};
  }
  // A registration of its own, so that one listener registered twice is told twice.
  const registration = (error: EngineLostError) => listener(error);
  lostListeners.add(registration);
  return () => lostListeners.delete(registration);
}

/** `bridge` refusing every call once the engine is lost, and marking it lost on a trap. */
function guarded(bridge: Bridge): Bridge {
  return each(bridge, (call) => (...args) => {
    refuseIfLost();
    try {
      return call(...args);
    } catch (error) {
      throw isTrap(error) ? lose(error) : error;
    }
  });
}

/** The engine's export that arms its trap, in test mode, where the engine carries it. */
let trapExport: (() => void) | undefined;

/** Test mode only: the next call of an `Engine` on the page traps (ADR-0021). The engine the
 *  tests run is built with the feature `test-mode` of the bridge crate, which exports the trap;
 *  the production engine carries none of it. */
export function trapNextCall(): void {
  if (!TEST_MODE) throw new Error("comb: the engine traps on demand in test mode only");
  if (!trapExport) {
    throw new Error("comb: the engine carries no trap in test mode; run `bun run build:engine`");
  }
  trapExport();
}

function wrap(exports: InitOutput): Bridge {
  const { memory } = exports;
  if (TEST_MODE) {
    const trap = (exports as unknown as Record<string, unknown>)[TRAP_EXPORT];
    trapExport = typeof trap === "function" ? (trap as () => void) : undefined;
  }
  const bridge = engineBridge(memory);
  return guarded(TEST_MODE ? detaching(bridge, memory) : bridge);
}

/** Hands `engine` the load of `snapshot`, a parameter per column. */
function load(engine: Engine, { nodes, edges }: GraphSnapshot): number {
  const { ids, idBounds, x, y, width, content: c, refused } = nodes;
  const columns = [
    ids,
    idBounds,
    x,
    y,
    width,
    c.rowBounds,
    c.elementBounds,
    c.kinds,
    c.weights,
    c.roles,
    c.directions,
    c.colors,
    c.segmentBounds,
    c.fractions,
    c.segmentColors,
    c.texts,
    c.textBounds,
    c.textValid,
    c.names,
    c.nameBounds,
    c.nameValid,
  ] as const;
  const e = edges;
  const edgeColumnValues = [
    e.ids,
    e.idBounds,
    e.sources,
    e.sourceBounds,
    e.targets,
    e.targetBounds,
    e.hasLabel,
    e.labels,
    e.labelBounds,
    e.labelTexts,
    e.labelT,
    e.labelOffset,
    e.hasBackground,
    e.background,
    e.color,
    e.hasDash,
    e.dash,
    e.gap,
    e.arrow,
    e.sourceSide,
    e.targetSide,
  ] as const;
  return engine.loadGraph(
    ...columns,
    refused?.index,
    refused?.field,
    refused?.row,
    refused?.column,
    ...edgeColumnValues,
    e.refused?.index,
    e.refused?.field,
  );
}

/** The results of a query of `engine` for `rect` at `level`, as `Bridge.query` returns them, read
 *  through fresh views on `memory`. */
function queried(
  engine: Engine,
  memory: WebAssembly.Memory,
  rect: Rect,
  level: Level,
  pixel: number,
  labelReach: number,
): Visible {
  const u32 = (ptr: number, len: number) => new Uint32Array(memory.buffer, ptr, len);
  const f32 = (ptr: number, len: number) => new Float32Array(memory.buffer, ptr, len);
  const u8 = (ptr: number, len: number) => new Uint8Array(memory.buffer, ptr, len);
  const detail = DETAILS[engine.query(rect, LEVELS[level], pixel, labelReach)];
  // Read before the views: each is a call into the engine.
  const origin = { x: engine.originX(), y: engine.originY() };
  const badgePadding = { x: badgePaddingX(), y: badgePaddingY() };
  // The texts only where the query placed any, which it does at the near and middle level.
  const texts = engine.contentTextBoundsLen() > 1 ? engine.contentTexts() : "";
  return {
    positions: f32(engine.positionsPtr(), engine.positionsLen()),
    sizes: f32(engine.sizesPtr(), engine.sizesLen()),
    nodes: u32(engine.visibleNodesPtr(), engine.visibleNodesLen()),
    content: {
      bounds: u32(engine.contentBoundsPtr(), engine.contentBoundsLen()),
      rects: f32(engine.contentRectsPtr(), engine.contentRectsLen()),
      kinds: u8(engine.contentKindsPtr(), engine.contentKindsLen()),
      roles: u8(engine.contentRolesPtr(), engine.contentRolesLen()),
      colors: u32(engine.contentColorsPtr(), engine.contentColorsLen()),
      texts,
      textBounds: u32(engine.contentTextBoundsPtr(), engine.contentTextBoundsLen()),
      barBounds: u32(engine.contentBarBoundsPtr(), engine.contentBarBoundsLen()),
      bars: f32(engine.contentBarsPtr(), engine.contentBarsLen()),
      barColors: u32(engine.contentBarColorsPtr(), engine.contentBarColorsLen()),
      partBounds: u32(engine.contentPartBoundsPtr(), engine.contentPartBoundsLen()),
      parts: f32(engine.contentPartsPtr(), engine.contentPartsLen()),
      partEnds: u32(engine.contentPartEndsPtr(), engine.contentPartEndsLen()),
      arrowBounds: u32(engine.contentArrowBoundsPtr(), engine.contentArrowBoundsLen()),
      arrows: f32(engine.contentArrowsPtr(), engine.contentArrowsLen()),
      badgePadding,
    },
    labels: u32(engine.visibleLabelsPtr(), engine.visibleLabelsLen()),
    labelPoints: f32(engine.labelPointsPtr(), engine.labelPointsLen()),
    mesh: {
      positions: f32(engine.meshPositionsPtr(), engine.meshPositionsLen()),
      distances: f32(engine.meshDistancesPtr(), engine.meshDistancesLen()),
      colors: u32(engine.meshColorsPtr(), engine.meshColorsLen()),
      dashes: f32(engine.meshDashesPtr(), engine.meshDashesLen()),
      indices: u32(engine.meshIndicesPtr(), engine.meshIndicesLen()),
    },
    detail,
    origin,
  };
}

function engineBridge(memory: WebAssembly.Memory): Bridge {
  const engine = newEngine();
  const u32 = (ptr: number, len: number) => new Uint32Array(memory.buffer, ptr, len);
  const f32 = (ptr: number, len: number) => new Float32Array(memory.buffer, ptr, len);
  return {
    loadGraph: (snapshot) => load(engine, snapshot),
    addNode: (node) => engine.addNode(node),
    updateNode: (slot, id, patch) => engine.updateNode(slot, id, patch),
    content: (slot) => engine.content(slot),
    setFont: (role, { codes, advances, fallback, lineHeight }) =>
      engine.setFont(ROLES[role], codes, advances, fallback, lineHeight),
    addEdge: (edge, source, target) => engine.addEdge(edge, source, target),
    updateEdge: (slot, id, patch) => engine.updateEdge(slot, id, patch),
    textLimit,
    rowLimit,
    segmentLimit,
    columnLimit,
    idLimit,
    idBudget,
    checkIdBudget,
    contentBudget,
    checkContentBudget,
    checkGraphSize,
    removeNodes: (slots) => engine.removeNodes(slots),
    removeEdges: (slots) => engine.removeEdges(slots),
    edgesAt: (slots) => engine.edgesAt(slots),
    setLabelSize: (slot, halfWidth, halfHeight) => engine.setLabelSize(slot, halfWidth, halfHeight),
    labelPoint(slot) {
      const [x, y] = engine.labelPoint(slot);
      return x === undefined || y === undefined ? undefined : { x, y };
    },
    moveLabel(slot, x, y) {
      const [t, offset] = engine.moveLabel(slot, x, y);
      return { t: t!, offset: offset! };
    },
    translate: (slots, dx, dy) => engine.translate(slots, dx, dy),
    positions: () => f32(engine.positionsPtr(), engine.positionsLen()),
    nodeBuffers: () => ({
      positions: f32(engine.positionsPtr(), engine.positionsLen()),
      sizes: f32(engine.sizesPtr(), engine.sizesLen()),
    }),
    hit: (x, y, pixel, level, connectors) => engine.hit(x, y, pixel, LEVELS[level], connectors),
    drawnEdges() {
      engine.drawnEdges();
      return {
        slots: u32(engine.visibleEdgesPtr(), engine.visibleEdgesLen()),
        ends: f32(engine.edgeEndsPtr(), engine.edgeEndsLen()),
      };
    },
    query: (rect, level, pixel, labelReach) =>
      queried(engine, memory, rect, level, pixel, labelReach),
  };
}

/** The top-left corner of the node in `slot`, read from the engine's buffer of positions,
 *  `bridge.positions()`. The render layer reads the buffer by index itself, as it draws every
 *  node of a frame, and makes no object per node. */
export function positionAt(positions: Float32Array, slot: number): { x: number; y: number } {
  return { x: positions[slot * 2]!, y: positions[slot * 2 + 1]! };
}

/** Loads the engine from what the host application handed over: a `Response`, which is compiled
 *  while it streams, a compiled module, or the bytes (ADR-0019). Never a string, `URL`, or
 *  `Request`, which the initialiser would fetch itself; the API refuses those before it gets here,
 *  and the type here keeps them out. */
export async function createBridge(
  engine: Response | WebAssembly.Module | BufferSource,
): Promise<Bridge> {
  refuseIfLost();
  return wrap(await init({ module_or_path: engine }));
}

/** Loads the engine from its bytes, for tests outside a browser. */
export function createBridgeSync(module: BufferSource): Bridge {
  refuseIfLost();
  return wrap(initSync({ module }));
}
