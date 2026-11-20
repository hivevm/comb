# A dragged node shows no container it would drop into

- **Observed:** while the user drags a node, Comb shows nothing of the container a release would
  drop it into. The target is asked of the engine once, at the release, with the pointer's world
  point (`containerAt`), so the user learns where the node lands only from where it stands
  afterwards, or from the host's refusal. Ticket 03 of uml-diagrams settled this with the human on
  2026-11-18 and left the highlight to the backlog.
- **Where:** `packages/comb/src/interaction/node-drag.ts` (`targetOf`), the engine's
  `containerAt` in `crates/engine/src/graph/containers.rs`, and the overlay that would draw it.
