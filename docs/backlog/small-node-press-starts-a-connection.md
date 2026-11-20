# A press on a small node starts a connection instead of selecting it

- **Observed:** a press near the middle of a node 16 world units wide, such as a pin or an
  expansion node's rectangle of the UML example's activity diagram, or an entry or exit point of
  its state diagram, lands on one of the connectors at the middles of the node's sides, which lie
  no more than 8 units away. Comb then begins a connection, so the node is not selected; the user
  selects it only by a press near a corner, and the example's browser tests click such nodes
  there. Found by ticket 12 of uml-diagrams and its review.
- **Where:** the hit test of a press with connectors in `packages/comb/src/interaction/gesture.ts`
  (`bridge.hit` with `connectors`), the connect gesture of
  `packages/comb/src/interaction/connect.ts`, and the connectors' hit in the engine's hit test.
