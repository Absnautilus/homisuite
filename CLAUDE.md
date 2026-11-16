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
