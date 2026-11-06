# Conventions — Comb

> How this project writes code and tests **where no check decides it**: the judgement calls. What
> a module may know, what a test asserts and never does, the shape of an error, how a thing is
> named when the glossary has no word for it. Whoever settles a convention updates this file
> inline, an agent included, in the same change as the review or code that settled it. The
> reviewer always has it ([ADR-0001](adr/0001-agent-governance-model.md)).

An entry says in a sentence or two what is done and why; the why tells a convention from a habit.
A convention a check can decide is the check, not an entry. One that constrains future choices is
an ADR. What the golden path already shows needs none. Few entries that hold beat many that are
skimmed. The design revision drops what prevented nothing
([`AGENTS.md` §5](../AGENTS.md#5-quality-bar--definition-of-done)).

- **A rule changes everywhere it is stated** — a change to a rule, a step, or a name searches
  the tree for its old wording and for every citation of its anchor, and corrects them in the
  same change. A link check sees the anchor, never a sentence that restates it.
- **A self-test asserts what it builds** — it takes its fixtures from the tree it copies or writes
  them itself, never from the template's own ADRs, scripts, or numbers, so it holds in a derived
  project and after a normalization.
- **Break the feature once, and watch its test fail.** Before a test that verifies a criterion
  lands, the author removes or breaks the behaviour it claims (drops the dashes, skips the
  rebuild, returns every slot) and sees the test go red; the pull request names the breakage.
  A test that passes either way verifies nothing, and reading it rarely shows that. The breakage
  is the one the test claims to decide, not a neighbour of it: a test named for one function's
  refusal is run with that refusal removed. A test that admits more than one outcome fails under
  the breakage in each, or it pins the one outcome the fixed code gives, since an outcome that
  holds either way decides nothing.
- **A random test counts the cases each clause rests on.** A property test over random inputs
  counts, per clause it decides, the cases where that clause and no earlier one settles the result,
  and asserts a floor on each count. A seed, a size, or a spread that leaves no case then fails,
  instead of leaving the clause unchecked silently.
- **An oracle owes nothing to the code it judges.** A test computes its expected value from the
  inputs, by brute force or by hand, never from a cache, buffer, or helper of the module under
  test; an oracle that reads the engine's own state agrees with the engine's mistakes. Nor does
  it take its cases from that code: a case the code under test picks is skipped exactly where the
  code errs.
- **Host code may change the graph.** A getter of the host's input, a listener of `onChange`, and
  a veto are the host application's code, and each may call `Comb` again. Read the host's input
  whole before the first look at the store or the engine, and after a veto or a listener returns,
  decide from the graph as it stands then, not from what was found before the call: a slot looked
  up before host code ran may hold another item after it. A veto during whose call Comb tells a
  change to `onChange` ends its gesture with nothing done, a rule `api/editors.ts` writes once for
  every veto ([ADR-0024](adr/0024-edits-are-reported-as-typed-changes.md)).
- **A refusal added at the bridge is traced to the shell's callers.** Before an export refuses a
  value it took until now, each caller in the shell that can hand it that value from inputs the
  host may give, such as an extreme viewport, either guards it or handles the refusal. A browser
  test drives one such input and asserts no page error. An export's refusal that an input event
  reaches is an uncaught error on the host's page.
- **Hostile host code in a test answers within bounds.** A test that hands Comb a getter or a
  `Proxy` whose answers change, as a host application's code may, answers a finite value it
  counts, such as a length that grows once to a few more than the limit, never one that grows on
  every read: under the bug it looks for, the reading loops, and a timeout does not end a loop
  that never yields, so the test hangs instead of failing.
- **Hand the host copies.** What a change or a method gives the host application is a copy, never
  an object the store keeps, since a host that writes into it changes the graph past every check.
- **Work that should not happen is pinned by a count, never by a time.** A layer, a hand-over to
  the engine, or a probe that should do nothing while the pointer moves or the view pans has a test
  that counts it across such a move (`work()` of `comb/testing`, or a count of its calls), because
  a frame that redoes it still draws the right picture and no other test sees the cost. Where a
  test asserts that something is refused before it crosses into the engine, it counts the
  crossings (`bridgeCalls(name)` of `comb/testing`): a comparison of two timings holds only while
  the work either side happens to cost what it did, and fails on the same code another day.
- **A number says where it was taken.** A test or a measurement whose verdict depends on the
  environment (the renderer, the GPU, the display) asserts that environment before it records
  anything, and fails rather than measure a fallback: a silent fallback looks like a result.
- **A timed gesture begins from the same view on every runner.** A gesture of the benchmark
  shows its starting view, its scale and position, before its first timed frame wherever the
  gesture before it can stop at a place of its own, as one cut short by its action budget does:
  a gesture that begins where such a one stopped measures another view on each runner under the
  same name, against a baseline taken at another.
- **Geometry is tested on its awkward cases.** A test of paths, bounds, or strokes includes edges
  that run backwards (target left of source), level edges, edges shorter than their arrowhead,
  and edges far from the world's origin and far longer than the viewport, where `f32` rounds by
  more than a pixel; distances are measured to the segment, not to its line. The easy forward
  curve near the origin hides the errors that matter.
- **A bulk path is tried at the limits of a load.** A format or a path that carries a whole load,
  a column, a buffer, a budget's count, is run once at the most a load may hold (the counts,
  lengths, and budgets the bridge crate states), not only at the benchmark's size, before its
  ADR is accepted: what fits 50,010 nodes can pass a length an engine allows at 1,000,000, and the
  load then fails for a host application whose graph the bridge accepts.
- **Check a value as the engine keeps it.** Graph data is judged in the type the engine stores it
  in, not the type it arrived in: `1e300` is a finite `f64` and an infinite `f32`, so a check of
  the wider type lets through what the engine then holds as infinity. Narrow first, then check.
  Clippy's `cast_possible_truncation`, denied outside the tests, makes each narrowing say why it
  holds, by a checked conversion or an `expect` whose reason names what bounds the value, since a
  narrowing written without a look at its range can lose what Q-4 or Q-7 needs. The lint makes the
  author look; it does not check the value after the narrowing, which this entry still asks.
- **Cite the clause a test decides.** A `Verifies:` names the ADR or criterion whose text says what
  the test asserts, read in that text, not the one nearest the code; a test or check that decides
  none says so. A citation of a neighbour passes the traceability check and tells the next reader
  that a decision holds which nothing tests.
- **A check fails on what it cannot read.** A check that reads its subjects from a source (names
  from an interface, files under a root, marks from the bridge) fails, naming the source, where it
  reads none or meets a shape it does not know, and its self-test plays that case; a check that
  reads nothing passes everything.
- **The UML example tells a relationship by its kind's family of colour.** Comb draws an edge in
  one colour, solid or dashed (`[6, 4]`), with an arrowhead at its target or none, and one label,
  so the UML example draws each kind of relationship as `examples/uml/src/relationships.ts` lists
  it: association grey `#6b7280` solid without arrowhead; directed association grey solid with
  one; generalization blue `#1d4ed8` solid with one; realization blue dashed with one; dependency
  grey dashed with one and the label «use»; aggregation and composition green `#15803d` solid
  without one, labelled «aggregation» and «composition» at `t = 0.4`, nearer their source, which
  is the whole. Each colour carries white label text at a contrast of at least 4.5. The label
  names the kind wherever colour, dash, and arrowhead leave two kinds alike, since Comb has no
  hollow triangle, no diamond, and no arrowhead at the source, and its font no glyph for one.
  The package diagram draws each dependency as a dependency, its label «import» for a module's
  import of another and «use» for the bridge's load of the WebAssembly package and the bridge
  crate's use of the core.
- **The UML example draws a state diagram in UML's node shapes.** A state is a rounded rectangle
  of its name as a title, an initial state a circle, a final state a ringed circle, and a choice a
  diamond without content, its branches' guards on their edges in square brackets; a transition is
  a grey `#6b7280` solid edge with an arrowhead, labelled by its event on a pill of its colour, and
  none from a pseudostate taken at once. A pseudostate is as small as its node shape allows: a
  circle 24 wide, a ringed circle 28, and a diamond as wide as the 128 its empty content makes it
  high. A state is 200 wide, and one the palette drops is named NewState. A transition the user
  connects docks on the outline at both ends, and a loop on the side the connection left by at
  both; its event's label stands 14 to the left of its direction of travel.
- **The UML example's rules of connection are a table of what they refuse.** `allows` in
  `examples/uml/src/rules.ts` answers from the kinds of the two ends and of the relationship,
  against a set of refused combinations, and its test writes that table out. Between a class, an
  interface, an abstract class, and a package it refuses none, in either direction. Between a
  state, an initial state, a final state, and a choice it refuses a transition into an initial
  state and one out of a final state. A loop, an edge of a node with itself, is allowed only as a
  transition of a state; the example's Comb allows loops for it, so its gesture offers them in
  every diagram, and the table refuses every other. No case is needed of a class, a package, and
  a state together, which never share a diagram. A diagram that adds kinds of node adds its
  refusals here and to the table.
- **A ticket names its paths in full.** *What to build* and *Acceptance criteria* write every path
  from the repository root, `packages/comb/src/api/editors.ts` and not `api/editors.ts`, so that
  `scripts/check-plan-modes.sh` reads each one against the protected parts of
  [ADR-0007](adr/0007-harness.md); a short form passes that check unread.
- **A premise is read in the code.** An ADR or a ticket that states how the system behaves today,
  such as the order the scene draws in or what a counter signals, names the function, the test, or
  the ADR it read that in. A premise written from memory reads as true to the reviewer, who has no
  reason to open the engine, and a decision built on a false one decides the wrong problem. A
  spec or a ticket that asks for a refusal names, in the same way, the gesture or the call that
  can hand over what it refuses, and what Comb refuses of it already: a criterion that refuses
  what Comb refuses first, such as an edge of a node with itself where the host application does
  not allow loops (`selfEdge`), or what no gesture produces, cannot arise, and its ticket closes
  with the criterion disputed.
- **A host application's copy follows what Comb took.** The UML example, like any host
  application that keeps its own copy of the graph, writes into that copy only after Comb took the
  change, from what `onChange` tells or after the call returned, never before the call: Comb may
  refuse it, as a text past its limits, and the copy then holds what the canvas does not show.
- **A stacked pull request is retargeted before its base branch goes.** A pull request based on
  another's branch, rather than on `main`, waits for that one to merge; the base merges without
  deleting its branch, the dependent one is moved to `main` and updated, and only then is the base's
  branch deleted. A branch deleted through the API, `gh pr merge --delete-branch` among them, or
  with git closes every pull request based on it, which GitHub retargets only when the branch goes
  through its own button or its deletion after a merge. A fix of the base is committed on the base's
  branch alone and reaches the dependent through that update, never a second time beside it.
