// Portaled UI (dropdown menus, pickers) needs the module's theme custom
// properties (--shift-ink, --shift-line, --shift-accent, etc.), which are
// scoped to the `.shift-root` class selector -- so the portal element
// itself carries that class rather than mounting into the embedding app's
// own tree. It can't reuse the real, embedded `.shift-root` node for this,
// though: that one sits nested inside the host app's `.page-content`
// (itself a `position: relative; z-index: 1` stacking context), so any
// `position: fixed` descendant's z-index is only ever compared against
// `.page-content`'s own, regardless of how high the descendant sets it --
// which is exactly how a shift grid row near the top of a mobile screen
// could open its code-picker menu and have the host's sticky header (a
// `.page-content` sibling, so not subject to that cap) paint and intercept
// clicks over the menu's top portion despite the menu's own z-index: 1000.
// A dedicated node appended straight to document.body sidesteps every
// ancestor stacking context the embedding app might add, while keeping the
// `shift-root` class so the same variable rules apply unchanged.
let portalRoot: HTMLDivElement | null = null

export function getShiftPortalTarget(): Element {
  if (portalRoot && document.body.contains(portalRoot)) return portalRoot
  portalRoot = document.createElement('div')
  portalRoot.className = 'shift-root shift-portal-root'
  document.body.appendChild(portalRoot)
  return portalRoot
}
