# Contrast gate

`contrast-sweep.mjs` renders every story in both themes and both pointer
profiles, measures the composited colour of everything a person has to see, and
exits non-zero if any of it is below its WCAG threshold.

It exists because axe cannot cover this on its own. Its colour-contrast rule
returns `incomplete` rather than a violation whenever it cannot be sure what it
is looking at, and short text is one of those cases:

    Element content is too short to determine if it is actual text content

Incomplete results do not fail a build, so step numbers, badge counts,
pagination digits and avatar initials were never checked. A stepper marker
shipped at 1.31:1 with the whole suite green.

## Running it

```bash
pnpm --filter @reach/storybook dev      # in one shell
pnpm a11y:contrast                      # in another
```

`STORY_FILTER=stepper pnpm a11y:contrast` narrows the run to story ids
containing a substring. Use it when triaging one component, or when checking
that the gate still fails on a bug you have deliberately reintroduced. CI never
sets it.

## What it measures

| Pass         | Threshold        | Criterion   |
| ------------ | ---------------- | ----------- |
| Text         | 4.5:1, 3:1 large | WCAG 1.4.3  |
| Icons        | 3:1              | WCAG 1.4.11 |
| Focus rings  | 3:1              | WCAG 1.4.11 |
| Chart series | 3:1              | WCAG 1.4.11 |

Two details are worth knowing before changing any of it.

**Focus rings only exist while focused,** so the pass focuses each control and
reads the ring that appears. `:focus-visible` matches on keyboard input only,
which is why the runner presses Tab once per page: without it every ring
measures as absent and the pass reports a confident zero. The run prints how
many rings it measured, and treats zero as a failure for that reason.

**Chart colour is checked at the palette,** not on the rendered marks.
`ChartTone` is a closed union of six names and every series in every chart
resolves to one of them, so six readings against each surface cover every mark
that can be drawn, including ones no story happens to render. Reading the marks
instead would mean reading a multi-colour SVG's root, which reports a number
about no part of the picture.

## What it exempts

- Text inside a disabled control, per WCAG 1.4.3. Dimming an inactive field is
  correct, and raising it to 4.5:1 would make disabled look enabled.
- Anything marked `data-decorative`. That is a component declaring a shape
  carries no information: a tooltip tail or a popover arrow shares its bubble's
  fill by design, and measuring it as an icon asks the wrong question.

## What it does not cover

Each story is measured in its default state. Hover, active, selected and
invalid colours are never driven, and anything behind an interaction is only
seen if the story itself opens it. A clean run is not a claim about those.
