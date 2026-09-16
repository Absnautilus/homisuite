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
