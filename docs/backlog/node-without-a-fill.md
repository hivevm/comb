# Every node shape is filled white

- **Observed:** Comb fills every node shape white below its outline. The UML example's notation
  diagram draws a parameter set as a dashed border node around two pins of an action; its fill hides
  the action's outline where the set lies, and the fill of the pins' names, border nodes beside the
  pins, hides a stretch of each of the set's side edges, so the set does not read as a closed box.
  UML 2.5.1 draws a parameter set as a box around its pins over the action's outline. The human
  accepted the hidden outline of the action for ticket 14 of uml-diagrams on 2026-11-18, and the
  pins' names hiding the set's edges on 2026-11-19, and left a node without a fill to the backlog.
- **Where:** the drawing of a node's fill in `packages/comb/src/render/`, the fields of
  `NodeData` in `packages/comb/src/store/` and of the bridge, and REN-node-shapes-cover-uml
  *Outline*, which gives an outline but no fill.
