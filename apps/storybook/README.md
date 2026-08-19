# @reach/storybook

The host for the Reach UI docs. It owns the theming, the accessibility
gate and the build; it owns no component of its own.

```bash
just storybook       # http://localhost:6006
just test-stories    # render every story in Chromium and run axe over it
pnpm storybook:build # static site in apps/storybook/storybook-static
```

## Where the stories live

Next to the components they document, in `packages/ui/src/**`. A story that
sits in a separate app drifts from the component within a release; a story in
the same directory gets edited in the same commit.

## The accessibility gate

`@storybook/addon-a11y` runs axe on every story render, with
`parameters.a11y.test = 'error'`. Under `test:stories` — which CI runs — a
violation fails the build.

This is the only mechanism that keeps an accessibility rule true six months
after someone wrote it down. A checklist in a document does not.

## The toolbars

Four, and each one writes to `<html>` exactly as an application would. Nothing
here is a Storybook-only mechanism, so a story that looks right in the canvas
cannot look wrong in production for these reasons.

| Toolbar  | Writes                                 | Use it to check                           |
| -------- | -------------------------------------- | ----------------------------------------- |
| Theme    | `.dark`                                | Both themes on every story                |
| Viewport | Canvas size                            | iPhone SE → 4K, portrait and landscape    |
| Platform | `data-platform="tv"`                   | The 10-foot UI: 1.5× scale, 52px controls |
| Density  | `data-density="compact" \| "spacious"` | Row density, independent of the tap floor |

Platform and density go on the root element rather than on a wrapper because
the type scale keys off the root font size — a wrapper would show the control
heights change and the type stay put, the one combination that never ships.

## The pages worth reading first

- **Foundations → Tokens** — the two token layers, read live from the document.
- **Foundations → Motion** — every duration and easing, played on demand and
  side by side. Comparing them is the only way to tell 140ms from 200ms.
- **Foundations → Responsive** — the device matrix, and a live readout of which
  mechanism is currently answering.
- **Foundations → Patterns** — whole screens, all of them functional: the
  filters filter, the infinite list fetches, the charts drill down.
- **Layouts → Presets** — the five page skeletons, as named slots.
- **Layouts → Hierarchical** — one component that is a split view on a desktop
  and a push navigation on a phone, with the focus management that makes the
  second one announce itself.
- **Layouts → Modal page** — a whole page over the one behind it.
- **Forms** — every input in the system, from `Field` to the rich text editor.
- **Charts** — eight shapes, with the argument for each one and the
  accessibility contract they all share.
- **Icons** — the semantic set, and a searchable view of the whole library.
