# Conventions — Comb

> How this project writes code and tests **where no check decides it**: the judgement calls. What
> a module may know, what a test asserts and never does, the shape of an error, how a thing is
> named when the glossary has no word for it. Whoever settles a convention updates this file
> inline, an agent included, in the same change as the review or code that settled it. The
> reviewer always has it ([NUC-documents-are-fixed §6](adr/NUC-documents-are-fixed.md)).

An entry says in a sentence or two what is done and why; the why tells a convention from a habit.
A convention a check can decide is the check, not an entry. One that constrains future choices is
an ADR. What the golden path already shows needs none. Few entries that hold beat many that are
skimmed. The design revision drops what prevented nothing
([`AGENTS.md` §5](../AGENTS.md#5-quality-bar--definition-of-done)).

- **A rule changes everywhere it is stated** — a change to a rule, a step, or a name searches
  the tree for its old wording and for every citation of its anchor, and corrects them in the
  same change. A link check sees the anchor, never a sentence that restates it. A ticket under
  `docs/plan/` whose premise the change makes false, a refusal it adds or a step it already
  takes, is rewritten or withdrawn in the same change: named in a hand-off only, it is claimed and
  worked against a tree that no longer has its problem.
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
  instead of leaving the clause unchecked silently. It asserts the floors once, after the run, not
  inside a case, where shrinking may never reach them.
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
  every veto ([API-edits-report-nested-changes](adr/API-edits-report-nested-changes.md)).
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
  curve near the origin hides the errors that matter. A new kind of node or end, such as a node
  shape or a dock, is crossed with every rule already reading its neighbours: each dock and the
  loop on each node shape, and the hit test at the near and middle level on the thinnest node it
  allows, a bar 8 high among them. A loop that ignored the node shape and a bar whose connectors
  covered its centre each reached a later ticket because no test crossed them.
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
- **The UML example tells a relationship by its kind's family of colour.** The UML example draws
  an edge in one colour, solid or dashed (`[6, 4]`), with a filled arrowhead (`"end"`) at its target
  or none, and with a list of one label, `kind`, so it draws each kind of relationship as
  `examples/uml/src/relationships.ts` lists it: association grey `#6b7280` solid without arrowhead;
  directed association grey solid with one; generalization blue `#1d4ed8` solid with one;
  realization blue dashed with one; dependency grey dashed with one and the label «use»; aggregation
  and composition green `#15803d` solid without one, labelled «aggregation» and «composition» at
  `t = 0.4`, nearer their source, which is the whole. Each colour carries white label text at a
  contrast of at least 4.5. The label names the kind wherever colour, dash, and arrowhead leave two
  kinds alike, since Comb has no diamond and no arrowhead at the source, and its font no glyph for
  one. The package diagram draws each dependency as a dependency, its label «import» for a module's
  import of another and «use» for the bridge's load of the WebAssembly package and the bridge
  crate's use of the core; its legend names the dependency by both labels, since one naming «use»
  alone leaves the diagram's most common edge, «import», unexplained. The state diagram draws a
  transition grey, solid, with an open arrowhead (`"open"`), as UML 2.5.1 draws one, and a comment's
  anchor grey, dashed, and without one; neither is listed in the legend. The activity diagram draws
  a control flow and an object flow as a transition is drawn, an interrupting edge and the edge of
  an exception handler the same with `lightning`, and a comment's anchor as the state diagram's;
  none of them is listed in the legend. The use case diagram draws an association as the class
  diagram does, with a multiplicity at each end, two labels at the path parameters 0.1 and 0.9 on
  a pill of the edge's colour; an include and an extend grey and dashed with an open arrowhead,
  labelled «include» and «extend»; and a generalization blue and solid with a hollow triangle
  (`"hollow"`); none of the last three is listed in the legend.
- **The UML example draws a state diagram in UML's node shapes.** Each kind of state takes the node
  shape UML gives it, so that a reader who knows UML reads the kind from the shape and no label
  names it. A pseudostate has no content and is as small as its node shape allows, so that it reads
  as a mark on the path and never as a state. A state, a composite state, a submachine state, and a
  state list are rounded rectangles; an initial pseudostate and a junction filled circles, a final
  state a ringed circle, a terminate a cross, a choice a diamond, a fork and a join bars, an entry
  point and an entry connection point reference hollow circles (an ellipse without content), and an
  exit point and an exit connection point reference crossed circles. Shallow and deep history are
  ellipses holding `H` and `H*`, as wide as their content makes them high, so that they are round.
  A state's entry, do, and exit behaviours, internal transitions, and deferred triggers stand below
  a separator, as UML 2.5.1 draws its compartment. A composite state is divided one above the other
  into orthogonal regions, parted by dashed lines. A point rides the border of its composite state,
  submachine state, or frame, and its name is a further border node beside it on the same side
  without an outline, since no border node rides another. A transition that sends or receives a
  signal runs as two edges through a pentagon or a notched rectangle naming the signal, its trigger
  and guard on the first. A comment is a `note`, anchored by a dashed edge on a state, or by
  `targetEdge` at `targetT` 0.5 on a transition. A transition the user connects docks on the outline
  at both ends, as the seeded ones do, so that several transitions leave one state from different
  directions instead of meeting in the middle of one side (API-edges-dock-nodes-or-edges); a loop
  docks at both ends on the side the connection left by, since a loop on the outline is drawn above
  its node (API-edges-dock-nodes-or-edges) and not where the user dragged it.
- **The UML example draws an activity diagram in the building blocks settled for it.** Each kind
  takes the building block `ACTIVITY_SHAPES` in `examples/uml/src/activity.ts` names, which the
  activity diagram of a load and the notation diagram share, as tickets 12 and 14 of uml-diagrams
  settled them with the human. An action and a call behavior action are rounded rectangles of their
  name, the call behavior action's beside a rake icon the example registers. A send signal action is
  a `pentagon`, an accept event action a `notched-rectangle`, an accept time event action an
  `hourglass` above its time. An object node is a rectangle, and a data store and a central buffer
  are rectangles with «datastore» and «centralBuffer». A decision is a `diamond`, and a fork and a
  join are `bar`s given a height, upright. An interruptible region and an expansion region are
  dashed rounded rectangles that hold nodes, the expansion region's mode its keyword. A pin is a
  small rectangle riding its action, its name a further border node beside it without an outline, as
  a state diagram's point. An expansion node is three small rectangles without content side by side
  on its region's border, since one node with separators would be at least 64 high; the middle one
  is the node, and the outer ones go with it. An activity parameter node is a rectangle of its name
  riding the frame. A connector is an ellipse holding its letter, as wide as its content makes it
  high, 90.51, so that it is round, as history is. The frame of the activity is divided across into
  its partitions, regions named in their bands, and a partition may be divided across again into
  nested ones. An initial node is a `circle`, an activity final a `ringed-circle`, a flow final a
  `crossed-circle`, and a merge a `diamond`. A structured activity node is a dashed rounded
  rectangle below «structured» that holds nodes; a conditional node and a loop node are the same
  below «conditional» and «loop», divided down into regions named in their turned bands, the
  clauses, or the setup, test, and body. A value pin's value and `{stream}` beside a streaming pin
  are further border nodes without an outline, as a pin's name. A parameter set is a dashed border
  node around its pins, added before them so that they are drawn above it; its white fill hides the
  action's outline where it lies, and the names of its pins hide its own. A flow's label shows its
  guard in brackets and its weight as `{weight=…}`. The example's `canMoveInto` allows a move into a
  partition or a region and refuses one onto the canvas, out of the frame. A frame, a conditional
  node, and a loop node the palette drops take the regions their building block names, an equal
  share each: two partitions, two empty clauses, or the setup, test, and body. A parameter set the
  palette drops lands on the nearest side of the action under the pointer, added before two new
  input pins inside it; dropped on no action, it is refused, and the sidebar says "A parameter set
  groups pins of an action; drop it on an action's side." The notation diagram's palette also
  drops a partition. Onto the frame's heading, above the partitions, the frame takes one more,
  named "Partition" and its number, 600 wide, and the last partition before it keeps its width.
  Onto an empty partition, it divides that partition across into "Partition 1" and "Partition 2",
  an equal share each. Onto a partition that holds elements, the sidebar says, for the user's,
  "User holds elements; only an empty partition is divided."; off every frame, "A partition
  divides an empty partition or adds one to the frame; drop it there." The sidebar edits a value
  pin's value in a field and a pin's `{stream}` by a checkbox. It edits a conditional node's
  clauses, and the frame's partitions beside its name, one name per line, depth first, a nested
  partition indented, since Comb selects no region on its own (ARCH-regions-are-container-slots);
  it refuses another count of lines, or an empty one, and says why. A drop on the band of a
  partition divided again is refused, and the sidebar names the partitions to drop into.
- **The UML example draws a use case diagram in the building blocks settled for it.** Each kind
  takes the building block `USE_CASE_SHAPES` in `examples/uml/src/use-case-diagram.ts` names, as
  ticket 13 of uml-diagrams settled them with the human. An actor is an `actor`, its name the
  content below its drawing. A use case is an `ellipse` of its name, its extension points below a
  separator under the caption "extension points". The subject is a rectangular container titled
  with its name, and a comment a `note`. An extend's condition is a comment whose dashed anchor
  ends on the extend by `targetEdge` at `targetT` 0.5. Actors stand outside the subject, as UML
  2.5.1 draws them: a use case or a comment dropped over the subject lands in it, an actor on the
  canvas, over the subject too, and the example's `canMoveInto` refuses an actor moved into the
  subject. A connection adds an association between an actor and a use case, a generalization
  between two actors, an include between two use cases, and from a comment its anchor; the
  sidebar changes a relationship between two use cases among include, extend, and generalization,
  offering only the kinds the table allows between its ends, and edits an association's
  multiplicities. An extend changed to another kind loses its condition: the example asks Comb to
  remove the comments anchored on it, and their anchors go with them.
- **The UML example's rules of connection are a table of what they refuse.** `allows` and
  `refusal` in `examples/uml/src/rules.ts` answer from the kinds of the two ends and of the
  relationship, against a table of refused combinations, each with why, and its test writes that
  table out. The sidebar says why where the table refuses a user's connection. Between a class, an
  interface, an abstract class, and a package it refuses none, in either direction. Between the
  state diagram's kinds it refuses, the first that holds saying why:
  - a transition from or to a comment, which its anchor attaches;
  - a transition from or to the frame of the state machine, which is no vertex;
  - a transition into an initial pseudostate;
  - a transition out of a final state or a terminate pseudostate;
  - a transition from a fork to a pseudostate, since a fork's transitions enter states only
    (UML 2.5.1 `fork_segment_state`);
  - a transition from a pseudostate to a join, since only transitions from states enter one
    (`join_segment_state`);
  - a transition from a fork into a receive signal symbol, or from one into a join, since a receive
    signal is its transition's trigger and a fork's or a join's segment has none
    (`fork_segment_guards`, `join_segment_guards`);
  - a transition from a pseudostate into a receive signal symbol, since a transition out of a
    pseudostate has no trigger (`outgoing_pseudostates`), nor one out of an initial pseudostate
    (`outgoing_from_initial`).

  The sidebar offers no trigger on a transition out of a pseudostate, nor on one into a join, and no
  guard on one out of an initial pseudostate or a fork, or into a join, by the same constraints.

  A connection between the activity diagram's kinds adds an object flow where an end is an object
  node, a control flow otherwise, from a comment its anchor, and from an action to an input pin an
  exception handler, as the human decided on 2026-11-20. The table refuses, the first that
  holds saying why, as the OCL of UML 2.5.1's metamodel states the constraints:
  - a flow from or to a comment, which its anchor attaches;
  - a flow from or to the frame of the activity, or an interruptible region, which groups nodes;
  - a flow from or to a parameter set, which groups the parameters of its pins;
  - a flow into an initial node (`no_incoming_edges`), or out of an activity final or a flow final
    node (`no_outgoing_edges`);
  - a flow into a value pin (`no_incoming_edges`);
  - a flow into an output pin (`incoming_edges_structured_only`), or out of an input pin or a
    value pin (`outgoing_edges_structured_only`), of an action;
  - a flow into an input activity parameter node, or out of an output one (`no_edges`,
    `no_outgoing_edges`, `no_incoming_edges`);
  - a control flow from or to an object node, none of the example's being of a control type
    (`object_nodes`);
  - an object flow from or to an action, whose objects pass through its pins, or an expansion
    region, whose objects pass through its expansion nodes (`no_executable_nodes`);
  - an object flow out of an initial node (`control_edges`);
  - an anchor that starts at no comment, or ends on a comment;
  - an interrupting edge where the flow a connection adds between its ends is refused, for the same
    reason, since it is that flow interrupting its region;
  - an exception handler that starts at no action, the node it protects, or ends on no input pin,
    the pin that takes the exception into its handler's body.

  The sidebar's form of a flow changes its kind among the control flow, the object flow, the
  interrupting edge, and the exception handler, offering those the table allows between the
  flow's ends, as the human decided on 2026-11-20; the edge is then drawn as that kind, an
  interrupting edge and an exception handler with `lightning`. An edge that becomes an exception
  handler drops the label it had, since an exception handler carries none.

  An object node, a pin, a value pin, a data store, a central buffer, an expansion node, and an
  activity parameter node count as object nodes; the actions, the expansion region, and the
  structured, conditional, and loop nodes as actions. The constraints that count edges, such as a
  fork's one incoming edge or a merge's one outgoing edge, are no matter of two kinds, and the table
  holds none of them.

  A connection from a comment adds its anchor instead of a transition. The table refuses an anchor
  that starts at no comment, and one that ends on anything but a state or a pseudostate: a signal
  symbol, a comment, or the frame. The user anchors no comment on an edge; only the diagram's data
  does.

  Between the use case diagram's kinds the table refuses, the first that holds saying why:
  - a relationship but an anchor from or to a comment, which its anchor attaches, or the subject,
    which the example's relationships leave alone;
  - an association between two actors, since UML 2.5.1 lets an actor have associations only to
    use cases, components, and classes (`associations`), or between two use cases, since it lets
    none join two use cases of the same subject (`no_association_to_use_case`), and the example's
    use cases are all Comb's;
  - an include or an extend but between two use cases, the ends UML 2.5.1 types both as;
  - a generalization between an actor and a use case, since UML 2.5.1 lets a classifier specialize
    only one of its own type or a more general one (`specialize_type`);
  - an anchor that starts at no comment, or ends on a comment.

  A loop is refused on every kind of the use case diagram: an include of a use case with itself by
  `cannot_include_self`, a generalization of an actor or a use case with itself by
  `no_cycles_in_generalization`, every other loop by the table above or the example's rule below.

  A state, a composite state, a submachine state, a state list, and a final state count as states;
  a signal symbol stands on a transition and counts as neither. A loop, an edge of a node with
  itself, is allowed only as a transition of a state, a composite state, or a submachine state; the
  example's Comb allows loops for it, so its gesture offers them in every diagram, and the table
  refuses every other. No case is needed of a class, a package, and a state together, which never
  share a diagram. A diagram that adds kinds of node adds its refusals here and to the table.
- **What stays is pinned by assertions, not by unchanged files.** A spec's *Existing behaviour*
  or a ticket's criterion that existing tests run unchanged names the assertions that must hold,
  and expects a test that only follows a new field, argument, or signature to change with it;
  such a change is listed in the hand-off with its reason. A promise that test files stay as they
  are breaks at the first new field, and its criterion closes disputed while the behaviour held.
- **A ticket names its paths in full.** *What to build* and *Acceptance criteria* write every path
  from the repository root, `packages/comb/src/api/editors.ts` and not `api/editors.ts`, so that
  `scripts/check-plan-modes.sh` reads each one against the protected parts of
  [DEV-implementer-and-fresh-reviewer](adr/DEV-implementer-and-fresh-reviewer.md); a short form
  passes that check unread.
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
  refuse it, as a text past its limits, and the copy then holds what the canvas does not show. It
  stores a node's kind and never works it out again from a text the user edits, such as a
  stereotype, which once turned a class into a package.
- **A stacked pull request is retargeted before its base branch goes.** A pull request based on
  another's branch, rather than on `main`, waits for that one to merge; the base merges without
  deleting its branch, the dependent one is moved to `main` and updated, and only then is the base's
  branch deleted. A branch deleted through the API, `gh pr merge --delete-branch` among them, or
  with git closes every pull request based on it, which GitHub retargets only when the branch goes
  through its own button or its deletion after a merge. A fix of the base is committed on the base's
  branch alone and reaches the dependent through that update, never a second time beside it.
- **A check's cases are a table** — a new or changed check writes its cases into a table under
  `scripts/fixtures/` before its code, and its self-test reads the table, so a port of the
  checks is held to the same cases. A case expects a key, a rule identifier and a reason word that
  the message ends in, such as `[docs/adr-index:twice]`, and the data of the finding, never its
  wording, so that rewording a message breaks no port.
