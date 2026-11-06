//! The engine's functional core: pure geometry over values and buffers handed to it (ADR-0009).

#![cfg_attr(
    test,
    allow(
        clippy::cast_possible_truncation,
        reason = "test code narrows the fixtures it builds; the lint holds the code that ships"
    ),
    allow(
        clippy::disallowed_methods,
        reason = "an oracle measures with `hypot`, which owes nothing to the engine's `length`"
    )
)]

pub mod content;
pub mod geometry;
pub mod graph;
pub mod shape;
mod spatial;
pub mod stroke;
