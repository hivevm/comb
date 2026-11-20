// The writers of a load's columns (API-bridge-takes-serde-and-columns, *Graph data of a load*): the
// columns of the nodes, their content among them, and of the edges, which `api/snapshot.ts` writes
// from the primitives it reads, one string column in pieces and one typed array per field, and the
// codes of kinds, roles, directions, arrowheads, and sides they cross as. `index.ts` re-exports
// them and hands the columns to the engine.
import {
  ArrowCode,
  DirectionCode,
  EdgeField,
  KindCode,
  NodeField,
  NodeShapeCode,
  OutlineCode,
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
 *  (API-bridge-takes-serde-and-columns): half of V8's maximum string length, the smallest of the
 *  evergreen engines'. */
export const PIECE_BOUND = 2 ** 28;

/** The content of a load's nodes as the engine's `loadGraph` takes it
 *  (API-bridge-takes-serde-and-columns), the nodes' elements in slot order, each node's rows in
 *  their order and each row's elements in theirs: the boundaries of each node's rows, one more than
 *  there are nodes; of each row's elements, one more than there are rows; per row whether it is a
 *  separator, 1 or 0, which holds no element (REN-node-content-and-hits, *Separator*); per element
 *  its kind's code, its weight, NaN for one of another type, a text's role's code and a trend's
 *  direction's code, each 0 for another kind, and a badge's or a trend's colour, NaN for one of
 *  another type and for another kind; per element the boundaries of a progress bar's segments, one
 *  more than there are elements, and per segment its fraction and its colour, NaN for one of
 *  another type; the texts, every string an element shows, a metric's caption, value, and trend's
 *  text in that order, as a string column with per text whether it is a text, 1 or 0; and the
 *  names, every string an element names and does not show, an action's identifier and an icon's
 *  registered name, as the texts. */
export interface ContentColumns {
  readonly rowBounds: Uint32Array;
  readonly elementBounds: Uint32Array;
  readonly separators: Uint8Array;
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

/** The nodes of a load as the engine's `loadGraph` takes them (API-bridge-takes-serde-and-columns),
 *  each column in slot
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
  /** Per node whether its data gives a height, 1 or 0, and that height
   *  (REN-node-shapes-cover-uml). */
  readonly hasHeight: Uint8Array;
  readonly height: Float64Array;
  readonly shape: Uint8Array;
  /** Per node how its outline is drawn, as the code of `OutlineCode`, one for a string that names
   *  none, and the dash and the gap of a dashed one (REN-node-shapes-cover-uml, *Outline*). */
  readonly outline: Uint8Array;
  readonly outlineDash: Float64Array;
  readonly outlineGap: Float64Array;
  /** Per node whether it names a container, 1 or 0, the slot of the node it names, `NO_SLOT`
   *  where no node has that identifier, and whether it is a container, 1 or 0
   *  (API-bridge-columns-carry-nesting). */
  readonly hasContainer: Uint8Array;
  readonly container: Uint32Array;
  readonly isContainer: Uint8Array;
  /** Per node whether the user may resize it, 1 or 0 (API-edits-report-nested-changes). */
  readonly resizable: Uint8Array;
  /** Per node the direction its regions divide it in, 0 for none, 1 across, 2 down, and the
   *  regions of the load (ARCH-regions-are-container-slots). */
  readonly divide: Uint8Array;
  readonly regions: RegionColumns;
  /** Per node whether it is a border node, 1 or 0; the slot of the node its `attachedTo` names
   *  among the nodes, `NO_SLOT` where none has that identifier; its side as its code; its offset;
   *  and the first of its `x`, `y`, and `container` beside its `attachedTo`, 1 to 3, or of a node
   *  that is no border node a `side` or an `offset`, 4 or 5, or 0; and the
   *  identifier the first border node attached to no node names (ARCH-border-nodes-ride-sides). */
  readonly hasAttached: Uint8Array;
  readonly attached: Uint32Array;
  readonly side: Uint8Array;
  readonly offset: Float64Array;
  readonly beside: Uint8Array;
  readonly attachedMissing: string | undefined;
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

/** The regions of a load as the engine's `loadGraph` takes them
 *  (API-bridge-columns-carry-nesting): region `k` in the node slot after the nodes and the regions
 *  before it, each after what it divides, depth first: its identifier as the nodes' are, the slot
 *  of the node or region it divides, its size, its own division as a code, whether the line after
 *  it is dashed, 1 or 0, with its dash and gap, and whether it has a name, 1 or 0, the names as the
 *  identifiers are. */
export interface RegionColumns {
  readonly ids: string[];
  readonly idBounds: Uint32Array;
  readonly of: Uint32Array;
  readonly size: Float64Array;
  readonly divide: Uint8Array;
  readonly hasDash: Uint8Array;
  readonly dash: Float64Array;
  readonly gap: Float64Array;
  readonly named: Uint8Array;
  readonly names: string[];
  readonly nameBounds: Uint32Array;
}

/** A region as `api/snapshot.ts` read it, each field of the type it expects, in one list of the
 *  regions of its node, each after the region it lies in, which `of` names by its index, none for
 *  one of the node itself (ARCH-regions-are-container-slots). */
export interface RegionRead {
  readonly id: string;
  readonly name: string | undefined;
  readonly size: number;
  readonly line: "solid" | readonly [number, number];
  readonly divide: "across" | "down" | undefined;
  readonly of: number | undefined;
}

/** The code a division crosses as: 0 for none, 1 across, 2 down. */
const DIVIDES: Readonly<Record<string, number>> = { across: 1, down: 2 };

/** What writes the columns of a load's nodes, one node after another in slot order, from the
 *  primitives `api/snapshot.ts` reads of each: `node`, then its content row by row, each row's
 *  elements, the last of which ends the row, or `endRow` for a row of none or one whose last
 *  element is a progress bar, whose segments follow it before its row ends. */
export interface NodeColumnWriter {
  /** Starts the next node: an identifier that is a string is one, a number that is a number is
   *  one, a node shape that is a string crosses as its code, a container that is a string names
   *  the node of that identifier, which crosses as its slot once every node is written, a mark as
   *  a container that is a boolean is one, a height that is a number is one, whether it is
   *  resizable that is a boolean is so, a container, a mark, a height, and whether it is resizable
   *  null or undefined are none, and any other value is refused by its type, the first of them
   *  named; an outline that is `"solid"`, `"none"`, or left out crosses as its code, another
   *  string as the code of none, and a list of two numbers as a dash and a gap, any other value
   *  refused by its type, between the node shape and the container. */
  node(
    id: unknown,
    x: unknown,
    y: unknown,
    width: unknown,
    shape: unknown,
    container: unknown,
    isContainer: unknown,
    height?: unknown,
    resizable?: unknown,
    attachedTo?: unknown,
    outline?: unknown,
  ): void;
  /** The node's division and its regions, as read, after `node`: a division that is `across` or
   *  `down` is one, null or undefined none, and any other value refused by its type; regions
   *  `false`, where a value of another type lies anywhere in them, refused by their field. */
  regions(divide: unknown, regions: readonly RegionRead[] | false | undefined): void;
  /** The node's attachment, after `regions`, `attachedTo` as `node` was handed it: a string makes
   *  it a border node, whose side crosses as its code and whose offset as given, each refused
   *  where it is of another type or left out; an `attachedTo` of another type is refused, and
   *  none leaves the node no border node, whose side or offset, where given, refuses it
   *  (ARCH-border-nodes-ride-sides). */
  border(attachedTo: unknown, side: unknown, offset: unknown): void;
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
  /** The row is a separator: it crosses as a row of no elements marked as one, and ends
   *  (REN-node-content-and-hits, *Separator*). */
  separatorRow(): void;
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
 *  that a kind or a role added in the engine fails here until it has its code
 *  (API-bridge-takes-serde-and-columns). */
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

/** The slot a container crosses as where it names no node: past every slot, which the engine
 *  refuses as naming no node of the graph (API-bridge-columns-carry-nesting). */
export const NO_SLOT = 0xffff_ffff;

/** Whether `value` stands for a field left out: null or undefined. */
const absent = (value: unknown) => value === undefined || value === null;

/** The weight of a column left out (REN-node-content-in-rows). */
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
  private readonly hasHeight: Uint8Array;
  private readonly height: Float64Array;
  private readonly shape: ReturnType<typeof codeColumn<NodeShapeCode>>;
  private readonly outline: Uint8Array;
  private readonly outlineDash: Float64Array;
  private readonly outlineGap: Float64Array;
  private readonly hasContainer: Uint8Array;
  private readonly container: Uint32Array;
  private readonly isContainer: Uint8Array;
  private readonly resizable: Uint8Array;
  private readonly divide: Uint8Array;
  private readonly hasAttached: Uint8Array;
  private readonly attached: Uint32Array;
  private readonly side: ReturnType<typeof codeColumn<SideCode>>;
  private readonly offset: Float64Array;
  private readonly beside: Uint8Array;
  /** The identifier each border node's `attachedTo` names, by the node's index. */
  private readonly attachments = new Map<number, string>();
  /** The regions written, each by what it divides: a node by its index, a region by its own
   *  index past the nodes, which `columns` numbers once every node is written. */
  private readonly regionIds: ReturnType<typeof stringColumn>;
  private readonly regionNames: ReturnType<typeof stringColumn>;
  private readonly regionOf: { node: boolean; index: number }[] = [];
  private readonly regionIdList: string[] = [];
  private readonly regionNumbers: {
    size: number[];
    divide: number[];
    hasDash: number[];
    dash: number[];
    gap: number[];
    named: number[];
  } = { size: [], divide: [], hasDash: [], dash: [], gap: [], named: [] };
  /** The identifier of each node as it was handed over, and the identifier each node's container
   *  names, by the node's index, from which `columns` finds each container's slot. */
  private readonly named: unknown[] = [];
  private readonly containers = new Map<number, string>();
  /** The index of the node being written, and whether one is. */
  private at = 0;
  private open = false;
  private refused: NodeColumns["refused"];
  private rowBounds: Uint32Array;
  private elementBounds: Uint32Array;
  private separators: Uint8Array;
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
    this.hasHeight = new Uint8Array(count);
    this.height = new Float64Array(count);
    this.shape = codeColumn(count, SHAPES, NodeShapeCode.Unnamed);
    this.outline = new Uint8Array(count);
    this.outlineDash = new Float64Array(count);
    this.outlineGap = new Float64Array(count);
    this.hasContainer = new Uint8Array(count);
    this.container = new Uint32Array(count);
    this.isContainer = new Uint8Array(count);
    this.resizable = new Uint8Array(count);
    this.divide = new Uint8Array(count);
    this.hasAttached = new Uint8Array(count);
    this.attached = new Uint32Array(count);
    this.side = codeColumn(count, SIDES, SideCode.Unnamed);
    this.offset = new Float64Array(count);
    this.beside = new Uint8Array(count);
    this.regionIds = stringColumn(16, bound);
    this.regionNames = stringColumn(16, bound);
    this.rowBounds = new Uint32Array(count + 1);
    this.elementBounds = new Uint32Array(count + 1);
    this.separators = new Uint8Array(count);
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

  node(
    id: unknown,
    x: unknown,
    y: unknown,
    width: unknown,
    shape: unknown,
    container: unknown,
    isContainer: unknown,
    height?: unknown,
    resizable?: unknown,
    attachedTo?: unknown,
    outline?: unknown,
  ): void {
    if (this.open) this.endNode();
    this.open = true;
    if (!this.ids.add(id)) this.refuse(NodeField.Id);
    this.named.push(id);
    this.position(x, y, container, attachedTo);
    this.number(this.width, width, NodeField.Width);
    if (typeof height === "number") {
      this.hasHeight[this.at] = 1;
      this.height[this.at] = height;
    } else if (!absent(height)) this.refuse(NodeField.Height);
    if (this.shape.add(this.at, shape)) this.refuse(NodeField.Shape);
    this.writeOutline(outline);
    if (typeof container === "string") {
      this.hasContainer[this.at] = 1;
      this.containers.set(this.at, container);
    } else if (!absent(container)) this.refuse(NodeField.Container);
    this.flag(this.isContainer, isContainer, NodeField.IsContainer);
    this.flag(this.resizable, resizable, NodeField.Resizable);
  }

  /** The outline of the node being written (REN-node-shapes-cover-uml, *Outline*): solid where
   *  it is `"solid"` or left out, none where `"none"`, the code of none for another string, which
   *  the engine refuses at its place, a dash and a gap for a list of two numbers, which the engine
   *  checks as an edge's, and any other value refused by its type. */
  private writeOutline(outline: unknown): void {
    const at = this.at;
    if (absent(outline) || outline === "solid") this.outline[at] = OutlineCode.Solid;
    else if (outline === "none") this.outline[at] = OutlineCode.None;
    else if (typeof outline === "string") this.outline[at] = OutlineCode.Unnamed;
    else {
      const [dash, gap] = Array.isArray(outline) && outline.length === 2 ? outline : [];
      if (typeof dash !== "number" || typeof gap !== "number")
        return this.refuse(NodeField.Outline);
      [this.outline[at], this.outlineDash[at], this.outlineGap[at]] = [
        OutlineCode.Dashed,
        dash,
        gap,
      ];
    }
  }

  /** The position of the node being written: a border node has none, one left out is none, and
   *  one given stands beside its `attachedTo`, which refuses it (ARCH-border-nodes-ride-sides). */
  private position(x: unknown, y: unknown, container: unknown, attachedTo: unknown): void {
    const bordered = typeof attachedTo === "string";
    if (bordered) this.beside[this.at] = [x, y, container].findIndex((v) => !absent(v)) + 1;
    if (!bordered || !absent(x)) this.number(this.x, x, NodeField.X);
    if (!bordered || !absent(y)) this.number(this.y, y, NodeField.Y);
  }

  regions(divide: unknown, regions: readonly RegionRead[] | false | undefined): void {
    if (typeof divide === "string" && DIVIDES[divide] !== undefined)
      this.divide[this.at] = DIVIDES[divide];
    else if (!absent(divide)) this.refuse(NodeField.Divide);
    if (regions === false) this.refuse(NodeField.Regions);
    else if (regions) this.writeRegions(regions);
  }

  /** Writes `regions` of the node being written, in their order, each into what it lies in. */
  private writeRegions(regions: readonly RegionRead[]) {
    const numbers = this.regionNumbers;
    const base = this.regionOf.length;
    for (const { id, name, size, line, divide, of } of regions) {
      this.regionOf.push(
        of === undefined ? { node: true, index: this.at } : { node: false, index: base + of },
      );
      this.regionIds.add(id);
      this.regionIdList.push(id);
      numbers.size.push(size);
      numbers.divide.push(divide === undefined ? 0 : DIVIDES[divide]!);
      const dashed = line !== "solid";
      numbers.hasDash.push(dashed ? 1 : 0);
      numbers.dash.push(dashed ? line[0] : 0);
      numbers.gap.push(dashed ? line[1] : 0);
      numbers.named.push(name === undefined ? 0 : 1);
      if (name !== undefined) this.regionNames.add(name);
    }
  }

  /** `value` into `column` as 1 where it is `true`, as 0 where it is `false` or none, else
   *  refused as `field`. */
  private flag(column: Uint8Array, value: unknown, field: NodeField): void {
    if (value === true) column[this.at] = 1;
    else if (value !== false && !absent(value)) this.refuse(field);
  }

  noObject(): void {
    if (this.open) this.endNode();
    this.refuse(NodeField.Item);
    this.ids.add(undefined);
    this.named.push(undefined);
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

  /** The row is a separator, which holds no element. */
  separatorRow(): void {
    this.endRow();
    this.separators[this.rows - 1] = 1;
  }

  /** Ends the row. */
  endRow(): void {
    if (this.rows + 1 === this.elementBounds.length) this.elementBounds = grown(this.elementBounds);
    if (this.rows === this.separators.length) this.separators = grown(this.separators);
    this.separators[this.rows] = 0;
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
   *  segments following it, an `icon` a name, and any other kind none
   *  (API-bridge-takes-serde-and-columns). */
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

  border(attachedTo: unknown, side: unknown, offset: unknown): void {
    if (typeof attachedTo !== "string") {
      if (!absent(attachedTo)) this.refuse(NodeField.AttachedTo);
      // A side or an offset of a node that is no border node, which refuses it.
      else this.beside[this.at] = !absent(side) ? 4 : !absent(offset) ? 5 : 0;
      return;
    }
    this.hasAttached[this.at] = 1;
    this.attachments.set(this.at, attachedTo);
    if (this.side.add(this.at, side)) this.refuse(NodeField.Side);
    this.number(this.offset, offset, NodeField.Offset);
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
      hasHeight: this.hasHeight.subarray(0, this.at),
      height: this.height.subarray(0, this.at),
      shape: this.shape.column(this.at),
      outline: this.outline.subarray(0, this.at),
      outlineDash: this.outlineDash.subarray(0, this.at),
      outlineGap: this.outlineGap.subarray(0, this.at),
      hasContainer: this.hasContainer.subarray(0, this.at),
      container: this.containerSlots(),
      isContainer: this.isContainer.subarray(0, this.at),
      resizable: this.resizable.subarray(0, this.at),
      divide: this.divide.subarray(0, this.at),
      regions: this.regionColumns(),
      ...this.borderColumns(),
      content: this.contentColumns(),
      refused: this.refused,
    };
  }

  /** The columns of the regions written, each numbered by the slot of what it divides. */
  private regionColumns(): RegionColumns {
    const { size, divide, hasDash, dash, gap, named } = this.regionNumbers;
    const of = this.regionOf.map(({ node, index }) => (node ? index : this.at + index));
    return {
      ids: this.regionIds.pieces(),
      idBounds: this.regionIds.bounds(),
      of: Uint32Array.from(of),
      size: Float64Array.from(size),
      divide: Uint8Array.from(divide),
      hasDash: Uint8Array.from(hasDash),
      dash: Float64Array.from(dash),
      gap: Float64Array.from(gap),
      named: Uint8Array.from(named),
      names: this.regionNames.pieces(),
      nameBounds: this.regionNames.bounds(),
    };
  }

  /** The columns of the border nodes written, each `attachedTo` found by its identifier among the
   *  nodes alone, the first of an identifier shared, `NO_SLOT` and the first identifier named for
   *  one none has; a map of the identifiers only where a node is a border node. */
  private borderColumns() {
    const attached = this.attached.subarray(0, this.at);
    let attachedMissing: string | undefined;
    if (this.attachments.size > 0) {
      const byId = new Map<string, number>();
      this.named.forEach((id, slot) => {
        if (typeof id === "string" && !byId.has(id)) byId.set(id, slot);
      });
      for (const [at, id] of this.attachments) {
        const slot = byId.get(id);
        attached[at] = slot ?? NO_SLOT;
        if (slot === undefined) attachedMissing ??= id;
      }
    }
    return {
      hasAttached: this.hasAttached.subarray(0, this.at),
      attached,
      side: this.side.column(this.at),
      offset: this.offset.subarray(0, this.at),
      beside: this.beside.subarray(0, this.at),
      attachedMissing,
    };
  }

  /** The slot of each node's container, found by its identifier among the nodes and the regions
   *  written, the first of an identifier shared, `NO_SLOT` for one none has; a map of the
   *  identifiers only where a node names a container, so that a load of none builds none. */
  private containerSlots(): Uint32Array {
    const slots = this.container.subarray(0, this.at);
    if (this.containers.size === 0) return slots;
    const byId = new Map<string, number>();
    this.named.forEach((id, slot) => {
      if (typeof id === "string" && !byId.has(id)) byId.set(id, slot);
    });
    this.regionIdList.forEach((id, k) => {
      if (!byId.has(id)) byId.set(id, this.at + k);
    });
    for (const [at, id] of this.containers) slots[at] = byId.get(id) ?? NO_SLOT;
    return slots;
  }

  private contentColumns(): ContentColumns {
    return {
      rowBounds: this.rowBounds.subarray(0, this.nodes + 1),
      elementBounds: this.elementBounds.subarray(0, this.rows + 1),
      separators: this.separators.subarray(0, this.rows),
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

/** The edges of a load as the engine's `loadGraph` takes them
 *  (API-bridge-columns-carry-nesting), each column in slot order: the identifiers, sources, and
 *  targets each as the values concatenated and cut into pieces, each ending where a value ends,
 *  with their boundaries in UTF-16 code units across all pieces, one more than there are edges, a
 *  refused value empty, a source or a target the identifier of the edge it lies on where
 *  `sourceOnEdge` or `targetOnEdge` holds 1, at the path parameter `sourceT` or `targetT`, NaN for
 *  one of another type (API-edges-dock-nodes-or-edges, *Ends*); the boundaries of each edge's
 *  labels among all labels, one more than there are edges, and the labels' columns, edge by edge
 *  and each edge's in the order of its list: their identifiers and texts as string columns, per
 *  text whether it is a text, 1 or 0, their path parameters and offsets, and whether a background
 *  is present, 1 or 0; whether a dash and a lightning bolt are present, 1 or 0; the numbers as the
 *  host application handed them, a background of another type NaN; the arrowhead and the sides as
 *  codes, one for a string that names none; and the first value the engine's first pass refuses by
 *  its type, the index of its edge, its field, `item` for an edge that is no object, and a label's
 *  place for a field of a label (API-edges-dock-nodes-or-edges). */
export interface EdgeColumns {
  readonly ids: string[];
  readonly idBounds: Uint32Array;
  readonly sources: string[];
  readonly sourceBounds: Uint32Array;
  readonly sourceOnEdge: Uint8Array;
  readonly sourceT: Float64Array;
  readonly targets: string[];
  readonly targetBounds: Uint32Array;
  readonly targetOnEdge: Uint8Array;
  readonly targetT: Float64Array;
  readonly labelBounds: Uint32Array;
  readonly labelIds: string[];
  readonly labelIdBounds: Uint32Array;
  readonly labelTexts: string[];
  readonly labelTextBounds: Uint32Array;
  readonly labelTextsValid: Uint8Array;
  readonly labelT: Float64Array;
  readonly labelOffset: Float64Array;
  readonly hasBackground: Uint8Array;
  readonly background: Float64Array;
  readonly color: Float64Array;
  readonly hasDash: Uint8Array;
  readonly dash: Float64Array;
  readonly gap: Float64Array;
  readonly arrow: Uint8Array;
  readonly lightning: Uint8Array;
  readonly sourceSide: Uint8Array;
  readonly targetSide: Uint8Array;
  readonly refused:
    { readonly index: number; readonly field: EdgeField; readonly label?: number } | undefined;
}

/** One end of an edge as `api/snapshot.ts` read it: the node it names, the edge it names, the path
 *  parameter on that edge, and its side (API-edges-dock-nodes-or-edges, *Ends*). */
export interface EndValues {
  readonly node: unknown;
  readonly edge: unknown;
  readonly t: unknown;
  readonly side: unknown;
}

/** What writes the columns of a load's edges, one edge after another in slot order. */
export interface EdgeColumnWriter {
  /** The next edge, from the plain data `api/snapshot.ts` read of it: an identifier, a source, or
   *  a target that is a string is one, a number that is a number is one, labels that are a list
   *  of objects and a dash that is a list of two are read for their fields, null or undefined is
   *  absent labels, a dash, a lightning bolt, a background, or a side, and an arrowhead or a side
   *  that is a string crosses as its code; an end that names an edge, `edge` of `source` or
   *  `target` given, beside a node given is refused by its edge, and its path parameter crosses as
   *  given, which the bridge checks (API-edges-dock-nodes-or-edges, *Ends*); `label`, which
   *  `labels` replaced, is refused where it is given, and any other value is refused by its type,
   *  the first of them named, a label text and a background at their rule. */
  edge(
    id: unknown,
    source: EndValues,
    target: EndValues,
    label: unknown,
    labels: unknown,
    color: unknown,
    dash: unknown,
    arrow: unknown,
    lightning: unknown,
  ): void;
  /** The next edge, which is no object, refused as malformed unless a value before it was. */
  noObject(): void;
  /** The columns of the edges written so far. */
  columns(): EdgeColumns;
}

/** The code of each arrowhead, side, and node shape by its name, typed by the generated names so
 *  that one added in the engine fails here until it has its code. */
const ARROWS: Readonly<Record<Arrow, ArrowCode>> = {
  end: ArrowCode.End,
  none: ArrowCode.None,
  open: ArrowCode.Open,
  hollow: ArrowCode.Hollow,
};
const SHAPES: Readonly<Record<NodeShape, NodeShapeCode>> = {
  rectangle: NodeShapeCode.Rectangle,
  "rounded-rectangle": NodeShapeCode.RoundedRectangle,
  ellipse: NodeShapeCode.Ellipse,
  circle: NodeShapeCode.Circle,
  "ringed-circle": NodeShapeCode.RingedCircle,
  diamond: NodeShapeCode.Diamond,
  bar: NodeShapeCode.Bar,
  pentagon: NodeShapeCode.Pentagon,
  "notched-rectangle": NodeShapeCode.NotchedRectangle,
  note: NodeShapeCode.Note,
  frame: NodeShapeCode.Frame,
  "crossed-circle": NodeShapeCode.CrossedCircle,
  cross: NodeShapeCode.Cross,
  actor: NodeShapeCode.Actor,
  hourglass: NodeShapeCode.Hourglass,
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

/** The columns of the labels of at most `count` edges (API-edges-dock-nodes-or-edges): the
 *  boundaries of each edge's labels, and per label its identifier, its text, `t`, offset, and
 *  background. The snapshot hands over at most one label past the bridge's limit per edge. */
function labelColumns(count: number, bound: number) {
  const ids = stringColumn(count, bound);
  const texts = stringColumn(count, bound);
  const starts = new Uint32Array(count + 1);
  let valid = new Uint8Array(count);
  let labelT = new Float64Array(count);
  let labelOffset = new Float64Array(count);
  let hasBackground = new Uint8Array(count);
  let background = new Float64Array(count);
  let labels = 0;
  /** Writes the background of the label at `at`, where it has one, NaN for one of another type. */
  const writeBackground = (at: number, value: unknown) => {
    if (absent(value)) return;
    hasBackground[at] = 1;
    background[at] = typeof value === "number" ? value : Number.NaN;
  };
  /** Writes the label `label`, and returns the first of its fields refused by its type, or none. */
  const add = (label: unknown): EdgeField | undefined => {
    if (labels === labelT.length) {
      [valid, labelT, labelOffset] = [grown(valid), grown(labelT), grown(labelOffset)];
      [hasBackground, background] = [grown(hasBackground), grown(background)];
    }
    const at = labels++;
    const fields =
      typeof label === "object" && label !== null ? (label as Record<string, unknown>) : {};
    const named = ids.add(fields.id);
    valid[at] = Number(texts.add(fields.text));
    writeBackground(at, fields.background);
    const { t, offset } = fields;
    if (typeof t === "number") labelT[at] = t;
    if (typeof offset === "number") labelOffset[at] = offset;
    if (fields !== label) return EdgeField.LabelItem;
    if (!named) return EdgeField.LabelId;
    if (typeof t !== "number") return EdgeField.LabelT;
    return typeof offset === "number" ? undefined : EdgeField.LabelOffset;
  };
  return {
    /** Writes the labels of the edge at `at`, and returns the first of their fields refused by its
     *  type, with the label's place for a field of a label, or none. */
    add(at: number, list: unknown): { field?: EdgeField; label?: number } {
      let refused: { field?: EdgeField; label?: number } = {};
      if (Array.isArray(list)) {
        list.forEach((label: unknown, i) => {
          const field = add(label);
          if (field !== undefined && refused.field === undefined) refused = { field, label: i };
        });
      } else if (!absent(list)) refused = { field: EdgeField.Labels };
      starts[at + 1] = labels;
      return refused;
    },
    columns: (written: number) => ({
      labelBounds: starts.subarray(0, written + 1),
      labelIds: ids.pieces(),
      labelIdBounds: ids.bounds(),
      labelTexts: texts.pieces(),
      labelTextBounds: texts.bounds(),
      labelTextsValid: valid.subarray(0, labels),
      labelT: labelT.subarray(0, labels),
      labelOffset: labelOffset.subarray(0, labels),
      hasBackground: hasBackground.subarray(0, labels),
      background: background.subarray(0, labels),
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

/** Writes `value` at `at` of `column` where it is `true` or `false`, and returns whether it is
 *  refused by its type: neither a flag nor left out. */
function writeFlag(column: Uint8Array, at: number, value: unknown): boolean {
  if (typeof value === "boolean") column[at] = Number(value);
  return typeof value !== "boolean" && !absent(value);
}

/** The columns of at most `count` ends of edges, the sources or the targets
 *  (API-edges-dock-nodes-or-edges, *Ends*): the identifier each names, whether it lies on an edge,
 *  its path parameter there, and its side. */
function endColumns(count: number, bound: number, fields: readonly [EdgeField, EdgeField]) {
  const ids = stringColumn(count, bound);
  const onEdge = new Uint8Array(count);
  const parameter = new Float64Array(count);
  const sides = new Uint8Array(count);
  return {
    ids,
    /** Writes the end `end` of the edge at `at`, its side apart, and returns the field refused by
     *  its type: the edge where one is given beside a node given or is no identifier, else the
     *  node where it is no identifier. */
    add(at: number, { node, edge, t }: EndValues): EdgeField | undefined {
      if (absent(edge)) return ids.add(node) ? undefined : fields[0];
      onEdge[at] = 1;
      parameter[at] = typeof t === "number" ? t : Number.NaN;
      if (!absent(node)) {
        ids.add(undefined);
        return fields[1];
      }
      return ids.add(edge) ? undefined : fields[1];
    },
    /** Writes the side of the end of the edge at `at`, `absent` where it is left out, which the
     *  bridge refuses beside an end on a node, and returns whether it is refused by its type. */
    side(at: number, { side }: EndValues): boolean {
      const code = absent(side) ? SideCode.Absent : codeOf(SIDES, side, SideCode.Unnamed);
      if (code !== undefined) sides[at] = code;
      return code === undefined;
    },
    columns: (written: number) => ({
      onEdge: onEdge.subarray(0, written),
      parameter: parameter.subarray(0, written),
      sides: sides.subarray(0, written),
    }),
  };
}

/** A writer of the columns of at most `count` edges, its strings in pieces of at most `bound` code
 *  units. It looks at a value by `typeof` and at a string's length, and reads the labels and their
 *  fields and the items of a dash, which are the snapshot's own plain data, so that no value of
 *  the host application it is handed runs code. */
export function edgeColumns(count: number, bound: number): EdgeColumnWriter {
  const ids = stringColumn(count, bound);
  const sources = endColumns(count, bound, [EdgeField.Source, EdgeField.SourceEdge]);
  const targets = endColumns(count, bound, [EdgeField.Target, EdgeField.TargetEdge]);
  const labels = labelColumns(count, bound);
  const color = new Float64Array(count);
  const dashes = dashColumns(count);
  const arrows = codeColumn(count, ARROWS, ArrowCode.Unnamed);
  const lightning = new Uint8Array(count);
  let at = 0;
  let refused: EdgeColumns["refused"];
  const refuse = (field: EdgeField | undefined, label?: number) => {
    if (field !== undefined)
      refused ??= { index: at, field, ...(label === undefined ? {} : { label }) };
  };
  return {
    edge(id, source, target, label, list, colorOf, dash, arrow, bolt) {
      if (!ids.add(id)) refuse(EdgeField.Id);
      refuse(sources.add(at, source));
      refuse(targets.add(at, target));
      if (!absent(label)) refuse(EdgeField.Label);
      const labelled = labels.add(at, list);
      refuse(labelled.field, labelled.label);
      if (typeof colorOf === "number") color[at] = colorOf;
      else refuse(EdgeField.Color);
      if (dashes.add(at, dash)) refuse(EdgeField.Dash);
      if (arrows.add(at, arrow)) refuse(EdgeField.Arrow);
      if (writeFlag(lightning, at, bolt)) refuse(EdgeField.Lightning);
      if (sources.side(at, source)) refuse(EdgeField.SourceSide);
      if (targets.side(at, target)) refuse(EdgeField.TargetSide);
      at++;
    },
    noObject() {
      refuse(EdgeField.Item);
      for (const column of [ids, sources.ids, targets.ids]) column.add(undefined);
      labels.add(at, undefined);
      at++;
    },
    columns: () => ({
      ids: ids.pieces(),
      idBounds: ids.bounds(),
      sources: sources.ids.pieces(),
      sourceBounds: sources.ids.bounds(),
      sourceOnEdge: sources.columns(at).onEdge,
      sourceT: sources.columns(at).parameter,
      targets: targets.ids.pieces(),
      targetBounds: targets.ids.bounds(),
      targetOnEdge: targets.columns(at).onEdge,
      targetT: targets.columns(at).parameter,
      ...labels.columns(at),
      color: color.subarray(0, at),
      ...dashes.columns(at),
      arrow: arrows.column(at),
      lightning: lightning.subarray(0, at),
      sourceSide: sources.columns(at).sides,
      targetSide: targets.columns(at).sides,
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
