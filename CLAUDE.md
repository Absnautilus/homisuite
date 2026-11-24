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

## Undo (Ctrl+Z) and realtime

Every write a user makes (create, update, delete, status change — any
mutation, not just deletes) must be undoable with Ctrl+Z / Cmd+Z for a
short window right after it happens. Use the existing mechanism:
`useUndo()` from `@homisuite/ui` (`packages/ui/src/undo-context.tsx`) —
call `pushUndo({ message, undo })` right after the mutation succeeds,
where `undo` reverses it (restore the deleted row, revert the previous
field values, flip the status back). `UndoProvider` already wires the
Ctrl+Z listener and the "Annulla" toast; it just needs to be mounted once
near each app's root (`apps/web`, `apps/partner`, `apps/guest` each need
their own — it is not shared across separate deployed apps the way it is
across modules embedded in the same app). One pending action at a time,
not a stack: a new undoable action simply replaces whatever was pending.
Never build a second, local undo/toast mechanism — if a screen's own
mutation doesn't fit the existing shape, extend `useUndo`/`UndoAction`
rather than reinventing it there.

Every view that lists or displays data another user or device can also
change (requests, bookings, shifts, stays, reservations, ...) must update
itself live via Supabase Realtime instead of requiring a manual refresh —
follow the pattern already used in Turni and Dining's Prenotazioni tab
(`subscribeToQueue`/`realtimeHotelFilter` in `staff-api.ts` is the
reference implementation). A list that only loads once on mount and never
subscribes is a bug, not a missing nice-to-have.

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
