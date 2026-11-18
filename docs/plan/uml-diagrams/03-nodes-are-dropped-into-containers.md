# Ticket: A dragged node is dropped into a container or onto the canvas, and the host can refuse it

## What to build

The user drags a node and releases it over the topmost container or region under the pointer, or
outside every container. Where that differs from its own container, Comb asks `canMoveInto({ node,
container })`. On `true` the node moves into it, keeping its world position, takes the next rank,
and `nodeMoved` delivers its position relative to the new container and the container. On anything
else the whole drag is taken back and no change is delivered. A container and what it holds are
never its own target.

Settled with the human on 2026-11-18:

- Only containers are targets here; a region becomes a target with ticket 05, which places a drop
  into a region.
- One engine export, asked once at the release with the pointer's world point and the dragged
  node's slot, names the topmost container under the point that is neither the dragged node nor
  anything it holds at any depth, or none. Nothing is queried during the drag, so no target is
  highlighted while dragging; that highlight goes to the backlog.
- One engine export puts a node into a container or onto the canvas, keeping its world position,
  and gives it the next rank, onto the canvas too. It refuses, as the shell's mistake with a typed
  refusal, a target that is no container and a target that is the node or anything it holds. The
  store then sets the node's `container`. A refused drop and a drop within the node's own container
  keep its rank.
- Comb keeps the node's relative position at the press. A take-back puts it there exactly, by an
  engine export `place` that moves what the node holds along as `translate` does, not by
  translating back the sum of the drag's f32 deltas.
- Where Comb told a change during the veto's call, the node is taken back while its slot still
  holds its identifier; a veto that removed it, its container, or loaded leaves nothing to take
  back. `NodePatch` carries no position, so the take-back never meets a move of the host's.
- A drag that ends without a release point on the canvas (a release outside it, a cancel, a later
  press) has no target: nothing is asked, and it is a move within its own container, `nodeMoved`
  carrying the same container.
- The target is found at the pointer, not at the node's box, as API-edits-report-nested-changes
  says: a node reaching past its container's outline, grabbed there and released outside the
  container, asks `canMoveInto` with `null`. A test pins it.
- The tests of this ticket are browser tests in `examples/metric-tree/e2e/containers.spec.ts`,
  with `canMoveInto` returning `true`, `false`, and throwing, as API-edits-report-nested-changes
  (*Enforcement*, *Nesting*) now says; the UML example's test of its own `canMoveInto` goes to
  ticket 12.

## Acceptance criteria

- [ ] Given a node on the canvas and a container, when the user drops the node inside the container
      with `canMoveInto` returning `true`, then one `nodeMoved` arrives with the container and the
      position relative to it, and the node is drawn above the container.
- [ ] Given the same drop with `canMoveInto` returning `false`, throwing, or removing the container
      during its call, then the node stands where it stood before the drag, no change of the user's
      is told, and a thrown error reaches the page after the gesture.
- [ ] Given a node in a container, when the user drops it outside every container, then
      `canMoveInto` is asked with `null`, and on `true` the node lies on the canvas.
- [ ] Given a container dragged over a container it holds, when it is released, then `canMoveInto`
      is not asked for it, and the drag is a move within its own container.
- [ ] Given a drop within the node's own container, when it is released, then nothing is asked, and
      `nodeMoved` carries the same container.

## Read first

- Touches: `packages/comb/src/interaction/node-drag.ts`, `packages/comb/src/interaction/guard.ts`,
  `packages/comb/src/api/index.ts`, `packages/comb/src/api/changes.ts`,
  `crates/engine-wasm/src/lib.rs`, `crates/engine/src/graph/nodes.rs`
- ADRs: API-edits-report-nested-changes (*Vetoes*, *A veto during whose call Comb tells a change*),
  ARCH-engine-edits-nested-graph (*Moving into a container*).
- Conventions: *Host code may change the graph*, *Hostile host code in a test answers within
  bounds*.
- Golden path: the connection veto, `packages/comb/src/interaction/connect.ts` and
  `examples/metric-tree/e2e/connect.spec.ts`.
- Seam: browser tests in `examples/metric-tree/e2e/containers.spec.ts`; unit tests beside
  `packages/comb/src/interaction/delete.test.ts`.

## Blocked by

- docs/plan/uml-diagrams/02-containers-are-edited-and-dragged.md

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
