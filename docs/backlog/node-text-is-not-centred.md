# A node's text stands at its left, never centred

- **Observed:** Comb lays out every row of a node's content from the left of its inner rectangle
  (REN-node-content-and-hits), so a text narrower than its node stands at the node's left. UML
  2.5.1's figures draw an actor's name centred below the stick figure and a use case's name
  centred in its ellipse; the UML example's use case diagram draws an actor's name left of the
  figure, which stands centred across the node, and a use case's name in the upper left of its
  ellipse. Found by ticket 13 of uml-diagrams.
- **Where:** the layout of a row's columns in `crates/engine/src/content.rs`, the drawing of texts
  in `packages/comb/src/render/`, and REN-node-content-and-hits, which has no alignment of a
  column's content.
