# Ticket: The budget of content's strings holds across every edit

## What to build

The bridge crate refuses a load whose strings of content pass 1,000,000,000 UTF-16 code units
(ADR-0013, *Limits*), but it counts them within a load alone: `addNode` and `updateNode` check a
node's content by every other rule and never against the budget, so a graph built or grown by
edits after a load can hold any number of code units of content. The engine keeps the count of the
graph's strings of content, raises it on `addNode` and on an `updateNode` that grows a node's
content, lowers it on a deletion and on an `updateNode` that shrinks it, and refuses an edit that
would pass the budget with `contentBudgetExceeded`, naming the node, before anything changes.

## Acceptance criteria

- [ ] Given a graph whose strings of content lie at the budget, when `addNode` adds a node with a
      text of one code unit, then it is refused as `contentBudgetExceeded` naming that node, and
      the graph stays as it was (Q-7); a test lowers the budget as the bridge crate's tests of the
      load do.
- [ ] Given the same graph, when `updateNode` replaces a node's content with content of more code
      units, then it is refused the same way; with content of as many or fewer, it is taken.
- [ ] Given a deletion of a node, when a node of as many code units is added after it, then it is
      taken.
- [ ] Given a property test of loads, additions, updates, and deletions, when it runs, then the
      engine's count equals the code units of content the graph holds after every step.

## Read first

- ADR-0013 (*Limits*), ADR-0034 (*Graph data of a load*, *Structured data*), ADR-0028 (where
  validation lives).
- `crates/engine-wasm/src/graph_data/content.rs` (the cursor and its budget),
  `crates/engine-wasm/src/lib.rs` (`add_node`, `update_node`, the deletions).

## Blocked by

- docs/plan/node-content/01-a-node-shows-its-content-as-rows-of-text.md

## Mode

with the human: it changes the bridge crate's validation (`crates/engine-wasm/`), a protected part
of ADR-0007.
