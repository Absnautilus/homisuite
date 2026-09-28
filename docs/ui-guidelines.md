# UI guidelines

`packages/ui` (`@homisuite/ui`) holds the platform's shared, animated
presentational primitives — components generic enough that `apps/web`
(plain CSS, no Tailwind), `apps/guest`, and `modules/housekeeping` (both
Tailwind) can all use them unmodified. It started empty, per
`docs/architecture/monorepo.md`'s "no premature shared-component
extraction" rule; it was populated the first time a component was already
duplicated across two workspaces (`Toggle`, `Dropdown`) or requested for
platform-wide, consistent motion (`Tabs`).

## Why a shared package, and what belongs in it

A component belongs in `packages/ui` when:

- It has no domain logic and no Supabase client usage — pure presentation.
- Its visual/motion design should be identical everywhere it appears,
  regardless of which app renders it.
- It is (or is about to be) duplicated in more than one workspace.

It does **not** hold full, opinionated widgets with fixed markup and copy
(a "Menu" with a specific set of items, a specific account popover). Those
stay local to each app — `packages/ui` gives them the *transition
primitive* (a hook, a CSS class contract) they mount on their own existing
structure, not a replacement for their content.

## Cross-theme styling rule

`packages/ui` never uses Tailwind utility classes and never hardcodes a
color. Every component's CSS reads design tokens by name — `--accent`,
`--accent-ink`, `--line`, `--line-strong`, `--surface-2`, `--muted` — the
same token names apps/web, apps/guest, and modules/housekeeping each
already define under their own theme. A component ships its own CSS file,
imported directly by its `.tsx` file (`import './toggle.css'`); Vite bundles
it into whichever app or module imports the component, no separate
stylesheet import required from consumers.

**Never use the `transform` shorthand for a component's own animation.**
Use the standalone `scale`/`translate`/`rotate` CSS properties instead. A
consumer positions/aligns its own dropdown with `transform: translateX(...)`
or Tailwind's `-translate-x-1/2`; if the shared component's exit/enter
animation also claimed the `transform` property, the two would silently
clobber each other. Splitting them onto independent CSS properties (widely
supported, Baseline 2023) lets both apply at once. See
`dropdown-transition.css` for the working example.

Respect `prefers-reduced-motion: reduce` in every component: disable the
animation/transition entirely, don't just shorten it.

## Components

### `Toggle`

The canonical on/off switch (`checked`, `onCheckedChange`, `disabled?`,
`id?`, `className?`, aria passthrough). A double-bounce thumb travel on
click, gated by an internal `isInit` flag so a toggle rendered already-on
from server data never animates on mount — only a real click does.

Both `apps/web`'s `Switch` and `modules/housekeeping`'s `SwitchControl` are
now thin wrappers around it, preserving their own existing prop shapes so
call sites didn't need to change. Reach for `Toggle` directly in new code
instead of a local reimplementation.

### `Tabs`

A segmented control with a sliding pill indicator measured from the real
active button (`offsetLeft`/`offsetWidth`), not a fixed width — labels of
any length work, including a re-render on window resize. Props: `items`
(`{ value, label }[]`), `value`, `onValueChange`, `className?`, aria
passthrough.

Applied to `apps/web`'s `TeamPage` "Invito email / Credenziali" segmented
control. This was the only tab-like UI in the platform at the time this
component was introduced — a deliberate, requested exception to
"populated only once two workspaces need it," since establishing the
pattern now (rather than after a second tab UI is built ad hoc) was the
point of the exercise.

### `BreadcrumbHeader`

The module page header: a breadcrumb trail (`breadcrumb: string[]`, last
segment rendered as a real `<h1>`) plus an optional inline primary
`switcher` (a `Tabs`, `variant="surface"`) and an optional `actions` slot,
in one tinted banner. Below 640px the switcher gets an automatic frosted
"glass" pill treatment (see `breadcrumb-header.css`).

**The breadcrumb's last segment is always the module's own display name,
never the currently active section.** `[hotelName, 'Turni']`,
`[hotelName, t('department.housekeeping')]` — constant regardless of which
tab is selected. The active section belongs in `switcher` (or in a
secondary `Tabs` row below the header), not the breadcrumb — see "Module
page header contract" below.

### `BottomActionBar`

A generic, opt-in, mobile-only (`display: none` above 640px) fixed bar
pinned to the bottom of the screen, for a page's primary action to stay
reachable while its content scrolls (e.g. Turni's "Salva turni"). No fixed
content schema — each page fills it with whatever it needs, since this
varies a lot by module and role.

### `Modal`

A centered dialog on desktop; below 760px it becomes a full-height edge
drawer instead (`translateX` slide-in, not a scale morph — always
contained within the viewport by construction). `title`/`description`/
`footer`/`onClose`, plus an optional `originRef` pointing at the button
that triggered it: above the mobile breakpoint the panel visually grows out
of that button via the Web Animations API; the morph is skipped on mobile,
where scaling a small trigger up to a 100%-tall drawer would look broken
rather than smooth. Header and footer are `position: sticky` so the title
and primary actions stay reachable regardless of how long the body is.

### `Toast`

A brief, self-dismissing confirmation (e.g. "Turni salvati.") reusing
`useDropdownTransition`'s mount lifecycle — no provider, no queue. The
consumer owns its own `open` boolean, typically flipped back via a
`setTimeout` a few seconds after the action succeeds.

### `useDropdownTransition` / `dropdownTransitionClassName`

Not a full dropdown/menu component — each app's popover (language picker,
text-size picker, account menu, notification volume) has different
trigger and content markup. This is the shared *lifecycle + CSS class*
piece: `useDropdownTransition(open, closeDurationMs?)` returns
`{ state, mounted }`, holding `'closing'` for the close animation's
duration before the popover actually unmounts (so closing doesn't just
vanish instantly). Render the popover only while `mounted` is true, and
compute its className with `dropdownTransitionClassName(state, ownClassName)`.

Set `data-origin` on the popover element to `top-left` / `top-right` /
`bottom-left` / `bottom-right` to match where it actually opens relative to
its trigger (a menu opening upward needs a `bottom-*` origin, or the scale
animation looks like it's growing from the wrong corner).

## Module navigation contract

`ModuleNav` is the single source of truth for navigation **inside Homisuite
modules**. Previous per-module combinations of `BreadcrumbHeader`, `Tabs`,
custom tab bars, or mobile-only navigation treatments are superseded by this
component. The Shell is explicitly outside this contract and must keep its
existing style and behavior.

The component owns the complete two-tier pattern shown in the approved
module-navigation design:

1. module identity (`property / module`) and optional right-side actions;
2. primary navigation with a leading icon for every item;
3. optional secondary navigation directly below, also icon-labelled;
4. one shared raised surface-pill active state and smooth sliding indicator;
5. compact, left-aligned items — never equal-width columns stretched across the
   module rail;
6. horizontal scrolling on narrow screens instead of compressing, hiding
   labels, or moving module destinations into an "Altro/More" overflow menu.

The approved Housekeeping desktop/mobile reference is the visual specification: module rails use compact left-aligned icon+label pills, fully rounded tracks, a white active pill, and a second rail with the same grammar at slightly smaller scale. Do not stretch primary destinations to fill available width.\n\nNew modules must start from `ModuleNav`. Existing modules should migrate to
it rather than reproducing the look with local CSS. Module-specific CSS may
control surrounding content, but must not redefine the navigation track,
selected pill, icon geometry, typography, or mobile behavior.

`Tabs` remains the low-level segmented-control primitive for controls that
are not module navigation. `BreadcrumbHeader` remains available for legacy
call sites while migration completes, but it is no longer the module-nav
contract.

## Adding a new shared component

1. Confirm it's actually needed in two workspaces now, or is a
   platform-wide motion pattern being deliberately established (as `Tabs`
   was) — not a guess at future reuse.
2. No Tailwind, no hardcoded color — tokens only, per the rule above.
3. Animate via standalone `scale`/`translate`/`rotate`, never the
   `transform` shorthand, so positioning and motion never collide.
4. Respect `prefers-reduced-motion: reduce`.
5. Add the new export to `packages/ui/src/index.ts` and declare its
   package.json `exports` entry if it ships its own CSS file as a direct
   import path (most components won't need this — see "Cross-theme
   styling rule" above).
6. Document it in this file.
