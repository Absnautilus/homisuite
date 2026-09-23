// Portaled UI (dropdown menus, pickers) must mount inside .shift-root, never
// document.body directly. The module's theme custom properties (--shift-ink,
// --shift-line, --shift-accent, etc.) are scoped to .shift-root so the
// embeddable bundle cannot mutate Shell-owned variables. A node portaled
// straight to document.body sits outside that scope: every var(--shift-*)
// reference inside it resolves to nothing and the element silently renders
// with unstyled/inherited colors instead of the module's palette.
export function getShiftPortalTarget(): Element {
  return document.querySelector('.shift-root') ?? document.body
}
