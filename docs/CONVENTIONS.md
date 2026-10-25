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
  every veto ([ADR-0030](adr/0030-a-veto-that-changes-the-graph-ends-its-gesture.md)).
- **A refusal added at the bridge is traced to the shell's callers.** Before an export refuses a
  value it took until now, each caller in the shell that can hand it that value from inputs the
  host may give, such as an extreme viewport, either guards it or handles the refusal. A browser
  test drives one such input and asserts no page error. An export's refusal that an input event
  reaches is an uncaught error on the host's page.
- **Hand the host copies.** What a change or a method gives the host application is a copy, never
  an object the store keeps, since a host that writes into it changes the graph past every check.
- **Work a frame need not redo is pinned by a count.** A layer, a hand-over to the engine, or a
  probe that should do nothing while the pointer moves or the view pans has a test that counts it
  across such a move (`work()` of `comb/testing`, or a count of its calls), because a frame that
  redoes it still draws the right picture and no other test sees the cost.
- **A number says where it was taken.** A test or a measurement whose verdict depends on the
  environment (the renderer, the GPU, the display) asserts that environment before it records
  anything, and fails rather than measure a fallback: a silent fallback looks like a result.
- **Geometry is tested on its awkward cases.** A test of paths, bounds, or strokes includes edges
  that run backwards (target left of source), level edges, edges shorter than their arrowhead,
  and edges far from the world's origin and far longer than the viewport, where `f32` rounds by
  more than a pixel; distances are measured to the segment, not to its line. The easy forward
  curve near the origin hides the errors that matter.
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
- **A ticket names its paths in full.** *What to build* and *Acceptance criteria* write every path
  from the repository root, `packages/comb/src/api/editors.ts` and not `api/editors.ts`, so that
  `scripts/check-plan-modes.sh` reads each one against the protected parts of
  [ADR-0007](adr/0007-harness.md); a short form passes that check unread.
