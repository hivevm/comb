# ADR-0030: Comb applies edits at once, reports every change through one listener as a typed change, and lets the host application refuse a user's connection or deletion, a veto during whose call Comb tells a change ending its gesture with nothing done

- **Status:** 🟡 proposed
- **Date:** 2026-10-25
- **Deciders:** Markus Brigl
- **Applies to:** `CombOptions` and the `Comb` interface in `packages/comb/src/api/`, the change types `comb` exports, the store's actions in `packages/comb/src/store/`, and the gestures of `packages/comb/src/interaction/` that change the graph
- **Supersedes:** [ADR-0023](0023-edits-are-reported-as-typed-changes.md)

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
ADR-0029 derives the events to the host application from store changes in `api`, "so the host
application sees one sequence of events whatever caused them". ADR-0021 makes every call that
needs the engine throw an `EngineLostError` once the engine is lost. ADR-0022 adds and removes
nodes and edges in the engine one at a time.

Two shapes of data flow are common. In the *controlled* shape, as xyflow has it, the editor
proposes each change and the application applies it and hands the graph back; in the
*uncontrolled* one, the editor applies the change and tells the application. The controlled
shape puts the host's code into every frame of a drag and every edit round a copy of the graph,
against Q-1 at 50,000 nodes; the store keeps the structure and the engine the coordinates
(ADR-0029), and neither can wait for the host. So Comb applies the edit, and the host refuses in
advance where it has to.

A refusal can be asked for in three ways: a callback that answers before the edit, a promise that
answers later, or an event the host cancels. A test decides a synchronous answer by its return
value in the same call; a promise leaves the gesture pending, with the canvas unsure what to show
and the nodes of the pending edge free to be deleted meanwhile.

The methods below need refusals only the store's map from identifiers to slots can give: an
identifier `removeNodes`, `removeEdges`, or `updateEdge` names that the graph does not hold, an
`addNode`, `addEdge`, or user's connection whose identifier the graph holds already, and an
`addEdge` whose end the graph does not hold. The engine keeps no identifiers (ADR-0010), so the
bridge crate cannot check them against the graph it holds; ADR-0028 makes them `api`'s.

The maintainer asked for the editing interface as one decision: the changes, the vetoes, and the
methods are one contract between Comb and the host, each part shaped by the others (a veto exists
because the change is applied at once; a change reports what a method or a gesture did), so this
ADR records their interplay as one integration ([`AGENTS.md` §3](../../AGENTS.md#3-adr-rules),
rule 1).

A veto is the host's code, and it may call `Comb` while it runs: add an edge, remove a node,
update one. `docs/CONVENTIONS.md` (*Host code may change the graph*) asks that after host code
returns, Comb decide from the graph as it stands then. ADR-0023 decided this interface and left
open what a veto that changed the graph during its call means, and the two vetoes answered
differently. The deletion did nothing, silently, since what `canDelete` was asked about may no
longer be what would go. The connection added the edge whatever `canConnect` did: one that
removed the source or the target threw `missingNode` from the pointer's release, and one that
added an edge between the two itself got a second edge from the user's gesture beside its own,
which ADR-0024 (*Compatible*) would not have let the user make. A veto is asked about one
proposal; once the graph has changed under it, its answer is about a graph that is gone. On the
maintainer's decision, both gestures now end as the deletion did. That makes an exception to
ADR-0023's *The user's edge*, which checks every identifier `canConnect` returns and throws a
refused one: a `canConnect` that adds the edge `x` and returns `x` threw `duplicateEdge` under
ADR-0023, and throws nothing here. This ADR carries ADR-0023 over whole and adds the clause
*A veto during whose call Comb tells a change*, with its exception in *The user's edge*.

## Decision

We will apply every edit to the store and the engine at once, report each change of the graph,
whoever made it, to the listeners of `Comb.onChange` as one value of a union discriminated by
`kind`, and ask the host application synchronously before a connection or a deletion the user
makes: `CombOptions.canConnect` allows a connection only by returning the new edge's identifier,
and `CombOptions.canDelete` a deletion only by returning `true`, and only where Comb told no
change of the graph during the veto's call.

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
  identifiers it touched, never a coordinate (ADR-0029, *The graph's coordinates*); `api` derives
  the delivery from that store change, as ADR-0029 asks, and reads the positions a change carries
  from the engine's buffer as it delivers. Where an edit also clears the selection, its change is
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
- **Validation:** `api` reads each input once into primitives (ADR-0028). The bridge crate checks
  what a load would check of that one node or edge, and a patch of `updateEdge` as a load checks
  those fields; the limits of a load hold for the graph after the edit, the count of nodes and edges
  and the code units of all identifiers it holds, which the store counts. `api` refuses, as the
  store's map shows, an unknown node (`unknownNode`), an unknown edge (`unknownEdge`), an identifier
  the graph holds already (`duplicateNode`, `duplicateEdge`), and an edge to a node it does not hold
  (`missingNode`), as ADR-0028 decides. Every new kind is a kind of the generated `GraphDataProblem`
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
- **A veto during whose call Comb tells a change:** where the store records a change of the graph
  between a veto's call and its return, which Comb tells to the listeners of `onChange` as it
  records it, the gesture ends with nothing done, whatever the veto returned: no edge is added and
  nothing is removed by the gesture, no change of the user's is delivered, and nothing is thrown,
  even where `canConnect` returned an identifier or `canDelete` returned `true`. What the veto did
  through `Comb` stands, and was delivered as that call delivers it. A change of the selection or
  the viewport is no change of the graph and leaves the gesture to the veto's answer. A veto that
  throws is refused as above, its error thrown on after the gesture ended, whether or not Comb told
  a change during its call. Both vetoes are asked from one module of `api`, beside the user's
  edits, and the rule is written there once.
- **The user's edge:** except where Comb told a change during the veto's call (above), the
  identifier `canConnect` returns is checked as the identifier of an edge
  `addEdge` receives: read once, refused by the bridge crate where it is too long or, handed over as
  `false` (ADR-0028), holds a lone surrogate, and by `api` where the graph holds an edge of that
  identifier already. A refused identifier refuses the connection: Comb makes no edge, delivers no
  change, ends the gesture, and then throws the `GraphDataError` of the generated kind from the
  input event, as it throws on the error of a callback that threw, so that the host's mistake
  reaches the page as an error. A connection made is drawn with the defaults of an edge without
  appearance and delivered as `edgeAdded` with `by: "user"`.
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
  is needed, but ADR-0029 asks for one sequence of events whatever caused them, and a host that
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
  the user draws.
- **The refused identifier reported through `onChange` or a listener of its own** — no error
  escapes an input event, but a refusal is no change of the graph, and a listener only for the
  host's own mistake is more interface than throwing the error the method calls throw.
- **Vetoes as listener methods of `Comb`** — they could change while Comb runs, but each is one
  function, not a list, and a host that needs to change one reads its own state inside it.
- **A veto that changed the graph: re-check and carry out against the changed graph** — the
  connection would add its edge where both nodes still exist and no edge joins them, and the
  deletion would recompute what goes. The veto would then have allowed something it was never
  asked about: a deletion that now takes an edge the veto added, a connection beside an edge the
  veto drew between the same nodes. Asking the veto again could loop with a veto that changes the
  graph each time.
- **A veto that changed the graph: throw a typed error** — a `GraphDataError` from the input
  event, as a refused identifier is thrown. The host's call that changed the graph succeeded, and
  the host chose to make it; reporting that as its mistake makes every host that edits in a veto
  handle an error for a case it made on purpose, and the deletion, which ended silently, would
  change behaviour a host may rely on.
- **Count only a change that touches the proposal's nodes or edges** — an `updateNode` of a third
  node would leave the gesture to the veto's answer. But a change touches a proposal in more ways
  than by naming its items: an edge the veto adds between the two nodes makes the connection no
  longer compatible (ADR-0024), one it adds at a node to delete joins what would go, and a slot
  freed and reused moves what an identifier names. Deciding which changes touch the proposal is a
  second check of compatibility and of what goes, run on host-made state, where one comparison of
  the store's change before and after the call is exact and costs nothing.

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
- ADR-0023, which this ADR carries over, and the vetoes as they stood before it:
  `interaction/delete.ts`, which compared the store's change before and after `canDelete`, and
  `connectorOf` in `api/index.ts`, which added the edge whatever `canConnect` did (read on
  2026-10-25).

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
- Negative / trade-offs: a host has to give `canConnect` to let the user connect at all, where a
  missing `canDelete` allows; and `canConnect` answers two questions at once, whether and under
  which name.
- Negative / trade-offs: a refused identifier surfaces as an error thrown from an input event,
  which the host sees in its error handling for the page, not at a call of its own.
- Negative / trade-offs: the public interface grows by seven methods, two options, and the
  change types, each a promise to every host application (Q-3).
- Positive: a host that edits the graph in a veto gets exactly the graph it made, for both
  gestures, and no error from the page; the user's gesture never names a node the graph no longer
  holds, so it never throws `missingNode` for a graph the host changed (Q-7 holds without a
  refusal the host did not cause).
- Positive: the rule after a veto stands in one place, so a third veto would take it as it is.
- Negative / trade-offs: a veto during whose call Comb tells a change has its answer ignored
  without being told; the change it made through `Comb` is how the host learns what happened, and
  an identifier it returned is not checked, so a mistake in it goes unseen, which narrows what
  *The user's edge* reports through the typed errors of Q-7.
- Negative / trade-offs: the public interface (Q-3) keeps its types, but the meaning of
  `canConnect` and `canDelete` gains a case a host has to know: any change of the graph counts,
  also one unrelated to the proposal, such as an `updateNode` of a third node.
- Follow-ups: moving a node from the host application, and bringing an existing one to the front; a
  selection of several items, which would widen `canDelete` and the removal changes, not their
  shape; whether a veto should be told that its answer was dropped, should a host ask for it.

## Enforcement

Each test below cites this ADR with `Verifies: ADR-0030`.

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
- **A veto during whose call Comb tells a change:** browser tests in
  `examples/metric-tree/e2e/connect.spec.ts` release a connection with a `canConnect` that removes
  the target and returns an identifier, and assert that no edge is added, no change of the user's
  is told, and no error reaches the page; with a `canConnect` that adds an edge between the two
  nodes itself and returns another identifier, and assert that only its own edge exists; with a
  `canConnect` that sets the viewport and fits the view and returns an identifier, and assert that
  the edge is made; and with a `canConnect` that adds an edge and then throws, and assert that only
  its own edge exists and its error reaches the page after the gesture ended. Browser tests in
  `examples/metric-tree/e2e/delete.spec.ts` delete with a `canDelete` that adds an edge and returns
  `true`, and with one that adds an edge and then throws, and assert that nothing is deleted, and
  with one that sets the viewport and returns `true`, and assert that the deletion is made. Unit
  tests in `packages/comb/src/interaction/delete.test.ts` assert the same of a veto that updates a
  node and of one that changes the selection.
- **Refusals:** browser tests call each new method with an unknown identifier, a duplicate one,
  and a value of the wrong type, and assert a `GraphDataError` of the generated kind and a graph
  as it was; they also `Verifies: Q-7`. A test asserts that every kind `api` builds is one of the
  generated `GraphDataProblem`.
- **Types:** a type test in `packages/comb/src/` asserts that `GraphChange` admits exactly the
  kinds of the table.
