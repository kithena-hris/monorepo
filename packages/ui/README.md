# @reach/ui

Reach UI, the shared design system. Every module renders through this package, which is
what makes a tenant who bought only Time Off feel like they bought part of one
product rather than a standalone tool.

Browse it: `just storybook`.

## What it is not

Presentation only. This package imports no contract, no domain type and no data
client, and `.dependency-cruiser.cjs` fails the build if that changes. Without
that rule, one module's concepts leak into every other module's screens and the
system stops being shareable.

There is no page shell, no navigation and no data fetching here. A module owns
its screens; this package owns the vocabulary they are written in.

## Shipping source, not build output

`exports` points at `src/`. Next.js compiles it via `transpilePackages`, Vite
compiles it directly, and there is no watch-and-rebuild step between editing a
component and seeing it. One compiler, one set of settings, no `dist/` to fall
stale.

The trade is that consumers must be able to compile TypeScript and JSX. Every
consumer here already can.

## Tokens

Two layers:

| Layer     | Example             | Renaming it                                    |
| --------- | ------------------- | ---------------------------------------------- |
| Primitive | `--reach-brand-600` | Free. No component may reference one.          |
| Semantic  | `--color-accent`    | A breaking change. This is the public surface. |

Theming re-points the semantic layer at different primitives, so a component
never learns which theme it is in. Colours are OKLCH: a lightness step is a
perceptual step, which is what keeps `fg-muted` at the same apparent contrast
across every hue.

Components consume Tailwind utilities generated from the semantic layer —
`bg-surface`, `text-fg-muted`, `border-border`. A raw hex or a numbered palette
step in a component is a bug.

## Density is a property of the pointer, not of the screen

A third token layer sits under the control sizes. `size="md"` resolves to 36px
under a mouse and 44px under a thumb, because `@media (pointer: coarse)`
re-points `--reach-control-*` — not because a screen somewhere passed a
different prop. Nothing in a component asks how wide the window is.

Three attributes drive the rest:

| Attribute                 | Effect                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `data-platform="tv"`      | 1.5× root font, 52px controls, a 4px focus ring with a halo |
| `data-density="compact"`  | Tighter controls. Never below the tap floor.                |
| `data-density="spacious"` | Looser controls.                                            |

Platform is declared by the app and put on `<html>` — the type scale keys off
the root font size. It is deliberately not a media query: `1920px wide`
describes a desk monitor as often as a television, and no media feature
separates them.

## Responding to size

In the order to reach for them:

1. **Intrinsic sizing.** `AutoGrid`, `Inline`, truncation. No query at all, and
   it works in a sidebar as well as in a window.
2. **Container queries.** `@container` on a component that must respond to the
   column it was dropped into. A `Stat` tile in a 320px rail and the same tile
   in a 900px column are the same viewport.
3. **Viewport breakpoints.** The page skeleton only — where navigation lives,
   whether a rail is beside or below.
4. **Input and platform.** `touch:`, `tv:`. Neither is a width.

Safe-area insets are spacing tokens (`pb-safe-bottom`, `ps-safe-left`), zero on
every device that has none, so they are never conditional.

Foundations → Responsive in Storybook holds the device matrix and a live
readout of which of these is currently answering.

## Layouts

`src/components/page-layout` holds the page skeletons, as named slots —
`header`, `banner`, `sidebar`, `aside`, `footer`, `bottomBar`, content — behind
five presets (`stacked`, `sidebar`, `sidebar-aside`, `focused`, `canvas`).

The slots are props rather than children matched by `displayName`: a prop is
type-checked, cannot be nested in the wrong place, and cannot be silently
dropped when someone wraps it in a fragment.

Two navigation shapes sit beside it:

| Component    | Shape                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ListDetail` | Hierarchical. Two panes when they fit; below the split the detail _pushes_ over the list, with focus moved and the hidden pane marked `inert`. |
| `ModalPage`  | A whole page over the one behind it. A route in the app; a focus-trapped dialog in the DOM.                                                    |

Browse them under **Layouts** in Storybook.

## Charts

`src/components/chart` holds eight shapes, hand-drawn in SVG and CSS — see
**Charts** in Storybook for which to reach for.

Two rules hold for every one of them. **Every chart renders its numbers
twice**: once visually, once as a real `<table>` in the accessibility tree. And
**nothing is measured in JavaScript** — bars are percentage widths, lines are a
stretched `viewBox` with `vector-effect="non-scaling-stroke"`. A chart that
needs a `ResizeObserver` to be correct is a chart that is wrong for one frame
on every resize.

## Icons

`src/icons` maps **meanings** to glyphs — `icons.delete`, `icons.person`. The
name is the contract; which lucide component sits behind it can change in one
commit. All ~1,500 lucide icons remain importable directly, but anything used
twice belongs in the registry: given free choice, three modules pick three
glyphs for "delete" and a fourth uses the one that means "archive".

An icon is a word. It is never the only signal, decorative icons are
`aria-hidden`, and icon-only controls carry an `aria-label`.

## Adding a component

1. `src/components/<name>/<name>.tsx`, with the reasoning in the docblock. Not
   what it does — that is readable — but which decision it encodes.
2. Reach for a Radix primitive before hand-rolling behaviour. Focus traps,
   typeahead and `aria-activedescendant` are not worth re-deriving, and the
   hand-rolled version is always subtly wrong.
3. `<name>.stories.tsx` next to it: every prop in `argTypes` with a
   description, and a story per state worth arguing about.
4. `<name>.test.tsx` for behaviour a story cannot assert — the ARIA wiring, the
   defaults, the guard rails.
5. Export it from `src/index.ts`.

## Rules that keep coming up

- **Colour is never the only signal.** Roughly one man in twelve cannot
  separate the success and danger washes.
- **Focus is never removed, only replaced.** The ring is drawn outside the
  control so it survives an `overflow: hidden` ancestor.
- **Money is never a float.** `Money` takes minor units and formats the decimal
  string exactly. See `money.tsx` for what `Number()` does to a large amount.
- **`new Date()` has no business here either.** Format what you are given; the
  caller owns the clock. `Calendar` takes `today` as a prop for exactly this
  reason.
- **A calendar date is a string, never a `Date`.** `YYYY-MM-DD`, all the way to
  the Postgres `date` column. A `Date` carries the browser's zone, and a leave
  day booked as the 1st in Madrid is the 31st for whoever renders it in São
  Paulo.
- **A chart renders its numbers twice** — once as SVG, once as a `<table>` in
  the accessibility tree. `aria-label="line chart"` tells a blind user only
  that they are missing something.
- **Paste is never blocked, anywhere.** Blocking it in a password field
  defeats password managers, which pushes people onto passwords they can type.
  `PinInput` goes further and _splits_ a pasted code across its boxes.
- **`autoComplete` is a security setting, not a convenience.** `PasswordField`
  requires it and has no default: `current-password` and `new-password` are
  not interchangeable, and the wrong one silently breaks every manager.
- **Client-side validation is guidance, never a gate.** A password meter, a
  file type check, an email shape check — all of them advise. The server
  decides.
- **The 44px target is a pseudo-element, not a bigger control.** A 44px radio
  is a visual error; a 20px one is unhittable. See `radio-group.tsx`.
- **A gesture is never the only way to do something.** Every card on the
  Kanban board carries a "Move to" menu, and every command in a `ContextMenu`
  must also exist somewhere discoverable. Both are the primary path for a
  screen-reader user, a switch user and anyone with a tremor — not fallbacks.
- **A dropzone is decoration; the `<input type="file">` is the control.** A div
  with `onDrop` is invisible to a keyboard and to a screen reader.
- **Client-side file validation is not a security control.** `accept` is a
  hint, the extension lies, and `File.type` comes from the client. The server
  re-derives the type from the magic bytes, stores the file outside the web
  root under a generated name, and serves it back as an attachment.
- **A displayed filename is stripped of its path.** `../../etc/passwd` renders
  as `passwd`; the `File` is untouched, because naming the stored file is the
  server's decision.
- **Every `createObjectURL` is revoked.** It pins the whole file in memory
  until it is, and a form where someone swaps a photo eight times leaks eight
  files.
- **Rich text is stored as ProseMirror JSON, rendered as HTML.** A schema
  migration can rewrite JSON; it cannot reliably re-parse a decade of
  hand-edited HTML. `RichTextContent` renders stored content without loading an
  editor, and it does not sanitise — that happens on the server, because a
  sanitiser running in the browser is one an attacker controls.
