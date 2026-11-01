//! The engine's functional core: pure geometry over values and buffers handed to it (ADR-0028).

#![cfg_attr(
    test,
    allow(
        clippy::cast_possible_truncation,
        reason = "test code narrows the fixtures it builds; the lint holds the code that ships"
    )
)]

pub mod content;
pub mod geometry;
pub mod graph;
mod spatial;
pub mod stroke;
