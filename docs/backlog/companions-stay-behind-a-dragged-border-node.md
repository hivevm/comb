# What goes with a border node stays behind when it is dragged

- **Observed:** the UML example draws the name of a state diagram's entry or exit point, of a
  connection point reference, and of an activity diagram's pin as a further border node beside it
  on the same side, and an expansion node as three border nodes side by side, the outer two going
  with the middle one, since no border node rides another (ARCH-border-nodes-ride-sides). When the
  user slides the point, the pin, or the middle rectangle along its owner's outline, only that
  border node moves: its name, or the two outer rectangles, stay where they stood, and the user
  slides each on its own. Delete removes them together, since the example's `canDelete` and its
  copy know what goes with what; a drag has no such hook. Tickets 11 and 12 of uml-diagrams settled
  the further border nodes with the human; neither asked that they move together. Found by ticket
  12 and its review.
- **Where:** the drag of a border node in `packages/comb/src/interaction/`, which moves the one
  node pressed, the `nodeMoved` change it tells, and ARCH-border-nodes-ride-sides, which has no
  border node ride another or move with it.
