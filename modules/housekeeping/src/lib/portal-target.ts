// Portaled UI (dropdown panels, pickers, confirm dialogs) must mount inside
// .hk-root, never document.body directly. The module's own colors/spacing
// (see housekeeping-theme.css's own comment: "They live on the module root
// rather than :root so the embeddable bundle cannot mutate shell-owned
// variables") are CSS custom properties scoped to .hk-root specifically, so
// the embedded bundle never clobbers the host Shell's identically-named
// tokens. A node portaled straight to document.body sits outside that
// scope: every var(--accent)/var(--bad-bg)/var(--surface)/etc reference
// inside it resolves to nothing, and the element silently renders with
// browser-default colors instead of the brand palette.
export function getHkPortalTarget(): Element {
  return document.querySelector('.hk-root') ?? document.body
}
