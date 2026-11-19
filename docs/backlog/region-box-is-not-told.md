# A host application cannot ask where a region lies

- **Observed:** the UML example works out the world box of a region itself, from the sizes of the
  regions before it and the content height `heightOf` gives. For a region within a named region,
  it also needs the thickness of that region's band, 24, which it copies from the engine. Comb's
  interface gives neither a region's box nor the band's thickness, so a change to either moves the
  example's drops off their regions without any error. Ticket 15 of uml-diagrams hit this when its
  palette had to drop into the notation diagram's nested partitions.
- **Where:** the `Comb` interface in `packages/comb/src/api/` (a query of a node's or a region's
  world box, or an exported band constant), `BAND` in `crates/engine/src/graph/regions.rs`, and
  `Diagram.box` in `examples/uml/src/diagram.ts`.
