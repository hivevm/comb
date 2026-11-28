# Ticket: What the bridge does not call in `shape.rs` is private to the engine crate

## What to build

`docs/ARCHITECTURE.md` says of `crates/engine` that only what the bridge uses is public, and the
rest private to the crate, so that the `dead_code` lint finds what only tests reach.
`crates/engine/src/shape.rs` has 18 public functions. The bridge crate calls four of them, read by
type, through `NodeShape::` paths and calls on values of type `NodeShape`, its tests included; the
call sites are under the bridge crate's `src/`:

- `NodeShape::of_code`: `graph_data/node_columns.rs:422`;
- `NodeShape::holds_content`: `graph_data/checks.rs:171`;
- `NodeShape::inner`: `graph_data/content/layout.rs:128`;
- `NodeShape::dashes`: `lib.rs:1665`, on `self.graph.shape(slot)`.

These four stay public. The bridge crate calls none of the other 14, though several share a name
with a function of its own or of the standard library (`height`, `side_of`, `drawing`, `fold`,
`contains`, `outline`), which a search by bare name counts:

- the methods `NodeShape::drawing`, `height`, `contains`, `crossing`, `inset`, `on_side`,
  `side_of`, `nearest`, and `outline`;
- the free functions `depth`, `fold`, `side_length`, `side_of`, and `held`.

Constants, types, and fields were not read; they stay as they are.

Since 67e707d0 (PR #118) the bridge asks the engine's `height_within` and `set_content` for a
node's height and no longer calls `NodeShape::height`. It stays `pub` because the test
`a_node_shape_has_one_public_function_of_a_node_s_height` in `shape.rs` counts the functions of
`impl NodeShape` that start with `pub fn ` or `pub const fn `, and asserts that `height` is the
one of them; a `pub(crate) fn height` would make it find none.

Evidence: the review of ticket 04 of revision-2026-11-20 (PR #118) left `NodeShape::height` for
the maintainer, "against ARCHITECTURE.md's rule that only what the bridge uses is public". The
review of this revision found the others.

Let each of the 14 be `pub(crate)`, or removed where only a test calls it. Let the test of
`shape.rs` count
the functions of a node's height whatever their visibility, so that it still decides that a node
shape has one function of its height (REN-node-shapes-cover-uml). Then let the overview's sentence
on the rule no longer name `shape` or `NodeShape::height`. The rest of the crate is ticket 04 of
this revision, with the human, since it touches protected parts.

## Acceptance criteria

- [ ] Given a test of `crates/engine/src/shape.rs` that reads only `shape.rs` and lists its
      `pub fn` and `pub const fn`, when the list is compared with the named set `of_code`,
      `holds_content`, `inner`, and `dashes`, then the two are equal, and the test fails naming
      each function that differs. It is watched fail on today's tree, naming `NodeShape::height`
      and the other 13, and passes on the result.
- [ ] Given a second function of a node's height added to `impl NodeShape`, `pub`, `pub(crate)`,
      or private, when the test of `shape.rs` runs, then it fails, naming both; it passes on the
      result.
- [ ] Given `docs/ARCHITECTURE.md`, when its part *Engine* is read, then its sentence on the rule
      names neither `shape` nor `NodeShape::height`.
- [ ] Given the workspace, when `scripts/check-all.sh` runs, then it passes.

## Read first

- Touches: `crates/engine/src/shape.rs`, `docs/ARCHITECTURE.md`
- REN-node-shapes-cover-uml, ARCH-one-workspace-per-example (*Core*).
- Conventions: *Break the feature once, and watch its test fail*.
- The seam: the tests of `crates/engine/src/shape.rs`.

## Blocked by

- None (can start immediately)

## Mode

unattended:

- tests of `shape.rs` decide it: the source test of criterion 1, watched fail on today's tree, and
  the height test, watched fail under a second height function of each visibility. The named set
  of criterion 1 is the ticket's list of the bridge's calls; the reviewer of the work checks it
  against the bridge crate's call sites above, and a later change that makes the bridge call
  another function of `shape.rs` adds it to the set in the same change;
- it touches `crates/engine/src/shape.rs` and the overview alone, no protected part, and a wrong
  result costs one revert;
- it touches no part the harness ADR, DEV-implementer-and-fresh-reviewer, keeps with the human,
  and fits under its cap of two open pieces of agent work;
- a wrong result shows as a red `cargo test`, or a build of the bridge crate that no longer finds a
  function it calls;
- the stop: where code outside `shape.rs` needs one of the functions public, or a change outside
  `shape.rs` is needed, the session stops and hands off with its state in this ticket;
- the order: this ticket and
  docs/plan/revision-2026-11-20/09-the-shell-draws-node-shapes-from-the-engines-numbers.md both
  touch `crates/engine/src/shape.rs`, so it is not dispatched while 09 is claimed, and the two are
  worked one after the other.
