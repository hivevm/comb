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
  A test that passes either way verifies nothing, and reading it rarely shows that.
- **An oracle owes nothing to the code it judges.** A test computes its expected value from the
  inputs, by brute force or by hand, never from a cache, buffer, or helper of the module under
  test; an oracle that reads the engine's own state agrees with the engine's mistakes.
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
