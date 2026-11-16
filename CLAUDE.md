# Homisuite — project rules

## UI components

Every UI component (buttons, toggles, selects, menus, modals, date/time
pickers, etc.) must be exported from `@homisuite/ui` (`packages/ui`) and
imported from there — never a native HTML control styled ad hoc, and never
a one-off local component duplicating something the package already has
or should have. If `@homisuite/ui` doesn't yet have the component a task
needs, add it there (following the existing components' conventions:
co-located `<name>.tsx` + `<name>.css`, theme tokens via `var(--token,
fallback)`, `ui-` prefixed class names) and export it from
`packages/ui/src/index.ts`, then use it from the consuming app/module.

Known pending exception: `apps/web/src/components/Select.tsx` is a
mature, portal-based select (handles clipping inside scrollable modals,
full keyboard nav, flips above/below, `FormData`-compatible) that
predates this rule and is already used across 8+ files. Reuse it as-is
(`import { Select } from '.../components/Select'`) rather than writing a
new one — do not build a second, simpler Select anywhere. Migrating it
into `@homisuite/ui` (and updating every call site) is a deliberate,
separate piece of work, not something to do incidentally while adding an
unrelated feature.

## Save buttons

A page or panel's save button must always read exactly "Salva" — never
"Salva impostazioni", "Salva modifiche", "Salva preferenze", or any other
qualified label. Context comes from the surrounding page/section heading,
not the button. It must always sit bottom-right of whatever it's saving
(the form, panel, or page). When a save can fail (permission, network,
validation), surface that failure to the user — a bare `try { ... }
finally { ... }` with no `catch` that reports the error is a bug: the
button must never silently reset to its idle label after a failed save
with no visible indication anything went wrong.
