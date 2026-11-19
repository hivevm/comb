# History and a connector are no small circle with a text

- **Observed:** UML 2.5.1 draws shallow and deep history as a small circle holding `H` or `H*`,
  and a connector of an activity as a small circle holding its letter. Comb has no node shape that
  is a small circle with content: a `circle` holds none, and an `ellipse` with content is at least
  64 high inside, so never less than 90.5 world units across. The UML example therefore draws
  shallow and deep history, and a connector, as round ellipses of 90.51 by 90.51 holding their
  letter, larger than its pseudostates and control nodes, where tickets 11 and 12 of uml-diagrams
  had settled 64 by 64 with the human on 2026-11-18. The human chose the round ellipse of 90.51 for
  history on 2026-11-19 until this entry is built, and the connector takes the same decision; the
  small circle is left to the backlog, since it needs a revision of REN-node-content-and-hits.
- **Where:** the least height of `crates/engine/src/content.rs` (`MIN_HEIGHT`) and its use in
  `ShapeKind::needed` of `crates/engine/src/shape.rs`, and REN-node-content-and-hits *Layout*.
