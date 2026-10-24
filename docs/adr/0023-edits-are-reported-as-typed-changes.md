# ADR-0023: Comb applies edits at once, reports every change through one listener as a typed change, and lets the host application refuse a user's connection or deletion

- **Status:** 🟡 proposed
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** `CombOptions` and the `Comb` interface in `packages/comb/src/api/`, the change types `comb` exports, the store's actions in `packages/comb/src/store/`, and the gestures of `packages/comb/src/interaction/` that change the graph

## Context

G-1, G-3, G-4, G-5, and G-6 make the graph editable: the host application adds nodes and edges
and changes their attributes, and the user moves nodes, connects them, deletes the selection,
and drags edge labels. The specification leaves persistence to the host application
([Non-Goals](../SPECIFICATION.md#non-goals)), so the host has to learn of every edit the user
makes, and it owns what a graph means, so it has to be able to refuse an edge or a deletion its
model does not allow. Q-3 asks for a public interface fully typed in TypeScript and free of any UI
framework; Q-7 asks that every change through it that names a node the graph does not hold be
refused with a typed error, the graph kept as it was.

Today the public interface has `load`, `updateNode` (a title alone), and `onSelectionChange`.
ADR-0011 derives the events to the host application from store changes in `api`, "so the host
application sees one sequence of events whatever caused them". ADR-0021 makes every call that
needs the engine throw an `EngineLostError` once the engine is lost. ADR-0022 adds and removes
nodes and edges in the engine one at a time.

Two shapes of data flow are common. In the *controlled* shape, as xyflow has it, the editor
proposes each change and the application applies it and hands the graph back; in the
*uncontrolled* one, the editor applies the change and tells the application. The controlled
shape puts the host's code into every frame of a drag and every edit round a copy of the graph,
against Q-1 at 50,000 nodes; the store keeps the structure and the engine the coordinates
(ADR-0011), and neither can wait for the host. So Comb applies the edit, and the host refuses in
advance where it has to.

A refusal can be asked for in three ways: a callback that answers before the edit, a promise that
answers later, or an event the host cancels. A test decides a synchronous answer by its return
value in the same call; a promise leaves the gesture pending, with the canvas unsure what to show
and the nodes of the pending edge free to be deleted meanwhile.

The methods below need refusals only the store's map from identifiers to slots can give: an
identifier `removeNodes`, `removeEdges`, or `updateEdge` names that the graph does not hold, an
`addNode`, `addEdge`, or user's connection whose identifier the graph holds already, and an
`addEdge` whose end the graph does not hold. The engine keeps no identifiers (ADR-0010), so the
bridge crate cannot check them against the graph it holds; ADR-0026 makes them `api`'s.

The maintainer asked for the editing interface as one decision: the changes, the vetoes, and the
methods are one contract between Comb and the host, each part shaped by the others (a veto exists
because the change is applied at once; a change reports what a method or a gesture did), so this
ADR records their interplay as one integration ([`AGENTS.md` §3](../../AGENTS.md#3-adr-rules),
rule 1).

## Decision

We will apply every edit to the store and the engine at once, report each change of the graph,
whoever made it, to the listeners of `Comb.onChange` as one value of a union discriminated by
`kind`, and ask the host application synchronously before a connection or a deletion the user
makes: `CombOptions.canConnect` allows a connection only by returning the new edge's identifier,
and `CombOptions.canDelete` a deletion only by returning `true`.

- **Changes:** each carries `by`, `"user"` or `"host"`, and is one of:

  | `kind`         | `by`           | fields                                                   |
  | -------------- | -------------- | -------------------------------------------------------- |
  | `loaded`       | host           | none: `load` replaced the graph                          |
  | `nodeAdded`    | host           | `node`, the `NodeData` as Comb took it                   |
  | `nodeUpdated`  | host           | `id`, `patch` as Comb merged it                          |
  | `nodeMoved`    | user           | `id`, `x`, `y`: where a drag left the node               |
  | `nodesRemoved` | user or host   | `nodes`, and `edges`, every edge removed with them, ids  |
  | `edgeAdded`    | user or host   | `edge`, the `EdgeData` as Comb keeps it, defaults filled |
  | `edgeUpdated`  | host           | `id`, `patch` as Comb merged it                          |
  | `edgesRemoved` | user or host   | `edges`, ids                                             |
  | `labelMoved`   | user           | `edge`, `t`, `offset`: where a drag left the edge label  |

  The selection stays with `onSelectionChange`; it is no change of the graph.
- **Delivery:** `onChange(listener)` returns the function that removes it, like
  `onSelectionChange`. A change is delivered synchronously, after the store and the engine hold
  it and before the call or the input event that made it returns, in the order made. `nodeMoved`
  and `labelMoved` come once, when the pointer is released, not per frame of the drag, and not at
  all for a drag that moved nothing. The store's action records the kind of the change and the
  identifiers it touched, never a coordinate (ADR-0011, *Coordinates*); `api` derives the delivery
  from that store change, as ADR-0011 asks, and reads the positions a change carries from the
  engine's buffer as it delivers. Where an edit also clears the selection, its change is
  delivered before `onSelectionChange` reports `null`. Lists of identifiers are
  `readonly string[]`.
- **New methods of `Comb`:** `addNode(node: NodeData)`; `removeNodes(ids: readonly string[])`,
  which removes the edges at those nodes with them; `addEdge(edge: EdgeData)`;
  `updateEdge(id, patch)`, whose patch may set `color`, `arrow`, `sourceSide`, and `targetSide`,
  set `dash` or clear it with `null`, and set `label` or clear it with `null`;
  `removeEdges(ids: readonly string[])`; and `worldPointAt(clientX, clientY)`, the world point
  under a point of the page in client coordinates, for a drop from the host's palette (G-1).
  Each returns nothing. Each method that changes the graph changes all it names or nothing, and
  throws a
  `GraphDataError` on a refusal and an `EngineLostError` once the engine is lost (ADR-0021);
  `worldPointAt` needs no engine and keeps working, and throws a `RangeError` on a coordinate
  that is not finite, like `setViewport`.
- **Validation:** `api` reads each input once into primitives (ADR-0026). The bridge crate checks
  what a load would check of that one node or edge, and a patch of `updateEdge` as a load checks
  those fields; the limits of a load hold for the graph after the edit, the count of nodes and edges
  and the code units of all identifiers it holds, which the store counts. `api` refuses, as the
  store's map shows, an unknown node (`unknownNode`), an unknown edge (`unknownEdge`), an identifier
  the graph holds already (`duplicateNode`, `duplicateEdge`), and an edge to a node it does not hold
  (`missingNode`), as ADR-0026 decides. Every new kind is a kind of the generated `GraphDataProblem`
  (ADR-0010), never one written in TypeScript.
- **Vetoes:** both are called synchronously, in the input event that ends the gesture, and
  neither for the host application's own calls. Where one throws, Comb makes no edit, ends the
  gesture, and then throws the error on.
  - `canConnect({ source, sourceSide, target, targetSide })` is called when the user releases a
    connection over a connector Comb would connect to. It returns the identifier of the new edge
    as a string, or `false` to refuse. Any other value refuses as `false` does, with no error, so
    a callback that forgets to return makes no edge. Without `canConnect`, no connection is begun:
    Comb has no name to give the edge.
  - `canDelete({ nodes, edges })` is called when the user deletes the selection, `edges` holding
    every edge that would go with the nodes, as the engine names them before it removes anything
    (ADR-0022), all as `readonly string[]`. Comb deletes only where it returns `true`. Without
    `canDelete`, a deletion is allowed.
- **The user's edge:** the identifier `canConnect` returns is checked as the identifier of an edge
  `addEdge` receives: read once, refused by the bridge crate where it is too long and by `api`
  where it holds a lone surrogate or the graph holds an edge of that identifier already. A refused
  identifier refuses the connection: Comb makes no edge, delivers no change, ends the gesture, and
  then throws the `GraphDataError` of the generated kind from the input event, as it throws on the
  error of a callback that threw, so that the host's mistake reaches the page as an error. A
  connection made is drawn with the defaults of an edge without appearance and delivered as
  `edgeAdded` with `by: "user"`.
- **A drop from the palette** is the host application's own `addNode`, so it arrives as
  `by: "host"`; a host that persists only `by: "user"` persists a drop in its own drop handler.
- **Deleting:** with the canvas focused, Delete or Backspace deletes the selection, a node with
  every edge at it or an edge alone, after `canDelete`, and clears the selection. The canvas
  takes focus when pressed.

**Out of scope:** undo and redo, copy and paste, and a selection of more than one item; moving a
node from the host application; node content (G-10); a refusal the host gives later than the
gesture.

## Alternatives considered

- **Controlled, the host applies every change** — the host keeps the one copy of the graph and
  Comb shows what it is handed, but each edit and each frame of a drag waits on host code and a
  round of the graph through `load` or a diff, against Q-1, and the store and the engine would
  hold a graph that is not yet the host's.
- **Report the user's changes only** — the host never hears back what it did itself, and no `by`
  is needed, but ADR-0011 asks for one sequence of events whatever caused them, and a host that
  mirrors the graph from `onChange` would miss its own calls.
- **A listener per kind of change** (`onNodeAdded`, `onEdgesRemoved`, …) — each narrowly typed,
  but nine listeners where one switch on `kind` does, and a new kind is a new method rather than
  a new member of the union, as the error kinds are.
- **Asynchronous vetoes returning a promise** — a host can ask its server first, but the gesture
  stays pending: the canvas has to show an edge that may not be, the user may delete one of its
  nodes meanwhile, and a test has to wait on timing. A host that needs its server refuses at
  once and calls `addEdge` itself once the server agrees, with the proposal it was given.
- **A cancelable event, as the DOM's `preventDefault`** — familiar, but several listeners could
  disagree, and allowing by default where a listener forgot to return makes a forgotten case an
  edit; returning `true` to allow makes it a refusal.
- **Comb applies and the host undoes** — no veto at all, the host removes what it does not
  allow, but the canvas shows the edge for a frame, and the host hears two changes for none.
- **Comb names the user's edge**, such as the first free `edge-n` — a boolean veto and no
  callback needed to connect, but Comb's names would share the host's namespace, a host naming
  its own edges `edge-n` would meet a `duplicateEdge`, and the host would rename or map every edge
  the user draws. The maintainer chose the host's names.
- **The refused identifier reported through `onChange` or a listener of its own** — no error
  escapes an input event, but a refusal is no change of the graph, and a listener only for the
  host's own mistake is more interface than throwing the error the method calls throw.
- **Vetoes as listener methods of `Comb`** — they could change while Comb runs, but each is one
  function, not a list, and a host that needs to change one reads its own state inside it.

## Sources / Prior art

- xyflow (React Flow), *Uncontrolled flow*: controlled means the application holds the state of
  nodes and edges, uncontrolled that React Flow handles it internally —
  <https://reactflow.dev/learn/advanced-use/uncontrolled-flow>; its `NodeChange`, a union
  discriminated by `type` (`dimensions`, `position`, `select`, `remove`, `add`, `replace`) —
  <https://reactflow.dev/api-reference/types/node-change> (both read 2026-10-24).
- Svelte Flow, `onbeforedelete` and `onbeforeconnect` on `<SvelteFlow />` —
  <https://svelteflow.dev/api-reference/svelte-flow>; `OnBeforeDelete` takes `{ nodes, edges }`
  and returns `Promise<boolean | { nodes, edges }>`, false to abort —
  <https://svelteflow.dev/api-reference/types/on-before-delete> (both read 2026-10-24): the
  asynchronous alternative above, with the nodes and edges of a deletion in one argument, as
  `canDelete` has them.
- The `Comb` interface, `api/index.ts`, and the store, `store/index.ts`, as they stand (read on
  2026-10-24).

## Consequences

- Positive: one listener and one switch tell the host everything that changed, and its type says
  what each change holds.
- Positive: a veto is decided in the same call, so a test asserts it by returning `false` and
  finding no edge.
- Positive: every edge carries a name of the host's, the user's too, so the host persists it as it
  comes.
- Positive: edits never wait on the host, so a drag and an edit cost what they cost in Comb (Q-1).
- Negative / trade-offs: a host that persists has to filter `by: "host"` out, or it stores its
  own calls twice; what it adds through its own calls, a palette drop among them, it persists
  where it makes the call.
- Negative / trade-offs: a refusal that needs the host's server cannot be given during the
  gesture.
- Negative / trade-offs: a host has to give `canConnect` to let the user connect at all, and
  `canConnect` answers two questions at once, whether and under which name.
- Negative / trade-offs: a refused identifier surfaces as an error thrown from an input event,
  which the host sees in its error handling for the page, not at a call of its own.
- Negative / trade-offs: the public interface grows by seven methods, two options, and the
  change types, each a promise to every host application (Q-3).
- Follow-ups: moving a node from the host application, and
  bringing one to the front; a selection of several items, which would widen `canDelete` and the
  removal changes, not their shape.

## Enforcement

Each test below cites this ADR with `Verifies: ADR-0023`.

- **Changes:** browser tests in `examples/metric-tree/e2e/` make each change of the table, by the
  host application through the public interface and by the user through the canvas where the
  user can, and assert the one change `onChange` delivers, its `kind`, `by`, and fields, and that
  it arrives before the call returns.
- **Vetoes:** browser tests connect two nodes with `canConnect` returning an identifier, `false`,
  `undefined`, a number, an identifier the graph holds, one past the length limit, and throwing,
  and delete the selection with `canDelete` returning `true`, `false`, and `undefined`, and
  throwing; they assert that only an identifier the graph does not hold connects, under that
  identifier, and only `true` deletes, that a refused gesture delivers no change, and that a
  thrown error and the `GraphDataError` of a refused identifier reach the page after the gesture
  ended; without `canConnect`, no connection begins.
- **Refusals:** browser tests call each new method with an unknown identifier, a duplicate one,
  and a value of the wrong type, and assert a `GraphDataError` of the generated kind and a graph
  as it was; they also `Verifies: Q-7`. A test asserts that every kind `api` builds is one of the
  generated `GraphDataProblem`.
- **Types:** a type test in `packages/comb/src/` asserts that `GraphChange` admits exactly the
  kinds of the table.
