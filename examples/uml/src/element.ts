// The lookup of an element of the UML example's page, which the host application and the sidebar
// share.

/** The element of the page with identifier `id`; a missing one is a defect of the page. */
export function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}
