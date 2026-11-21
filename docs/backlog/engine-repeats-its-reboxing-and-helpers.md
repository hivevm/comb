# The engine writes its reboxing and its small helpers more than once

- **Observed:** the design revision of 2026-11-20 found these without evidence
  (NUC-design-is-revised §3). The human had them recorded on 2026-11-21.
  - A node is reboxed twice: by `Graph::resize` in `graph/resize.rs` and by `set_box` in
    `graph/regions.rs`.
  - `kept` stands in `content.rs`, `graph/regions.rs`, and `graph/resize.rs`.
  - `grow_to` stands in `graph/containers.rs` and `graph/borders.rs`.
  - Per-slot data lives in sparse `Vec`s that `add_nested` and `remove_nodes` reset
    asymmetrically.
  - `NodeShape` is matched by or-pattern lists instead of exhaustive classifiers. The only sign of
    cost: TDD watched these fail in tickets 07 and 08 of uml-diagrams.
- **Where:** `crates/engine/src/content.rs`, `crates/engine/src/shape.rs`, and
  `crates/engine/src/graph/` (`resize.rs`, `regions.rs`, `containers.rs`, `borders.rs`).
