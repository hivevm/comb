// The order of the gestures at the view the example opens with, the whole graph fitted, apart
// from the page they run in (ADR-0008): the drag, the pan, the zoom, then the edits. The zoom can
// run out of its action budget wherever its steps took the view, so the edits begin at the fitted
// view again, its scale and position, and record the scale they ran at.

/** A viewport: its position and scale. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

/** The viewport of the page the gestures run in: read it, and show one and wait until drawn. */
export interface Viewport {
  read(): Promise<View>;
  show(view: View): Promise<void>;
}

/** Runs the gestures at the fitted view `fitted`, in order, the edits from `fitted` again. */
export async function gesturesAtFitted<G>(
  viewport: Viewport,
  fitted: View,
  gestures: {
    drag(): Promise<G>;
    pan(): Promise<G>;
    zoom(): Promise<G>;
    edit(): Promise<G>;
  },
): Promise<{ drag: G; pan: G; zoom: G; edit: G & { scale: number } }> {
  const drag = await gestures.drag();
  const pan = await gestures.pan();
  const zoom = await gestures.zoom();
  await viewport.show(fitted);
  const { scale } = await viewport.read();
  return { drag, pan, zoom, edit: { ...(await gestures.edit()), scale } };
}
