# Reach Mobile — build plan

Every ticket needed to ship Reach's mobile library, `@reach/ui-native`, and its
Storybook, in an order that works. Tick each box as it lands.

**This file, in the repository, is the record of progress.** Change a box here,
in git, and nowhere else.

**Specs**

| What                    | Where                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| The design              | Claude Design project `6fed6ac8…`, files `Reach Mobile*.dc.html`; source `_build/spec-*.js` + `core.js` |
| The design, on disk     | `.claude/design/reach-mobile/` (`ref/<category>-<theme>.html`, `ref/index.json`)                         |
| The web library         | `packages/ui`, `apps/storybook` — names, titles and docs this mirrors                                   |
| Repo rules              | [`CLAUDE.md`](../CLAUDE.md)                                                                             |
| Why this stack          | [`docs/tech-stack.md`](./tech-stack.md), "Reach on a phone" (RMB-002)                                   |

The design is 111 components and 589 stories at phone size (390pt), every one in
light and dark: Foundations 14 / 74, Forms 23 / 135, Components 40 / 225,
Data 13 / 80, Charts 21 / 75. `ref/index.json` lists every story by title.

---

## What is being built

- **`packages/ui-native`** (`@reach/ui-native`): Reach for React Native. Same
  names, same props where the platform allows, same tokens. TypeScript source,
  like `packages/ui`. Presentational only, and it never learns Kithena exists.
- **`apps/storybook-mobile`** (`@reach/storybook-mobile`): its documentation.
  Storybook 10.6 with `@storybook/react-native-web-vite`, so the same Storybook
  the web library uses, rendering the native components through
  react-native-web. **Mobile view only**: a fixed 390 × 844 viewport, light and
  dark. **Every story twice, under `iOS/` and `Android/`**: one component and
  one story file, listed in each platform's section, in that platform's status
  bar and home indicator, with the platform declared on `ReachProvider` so a
  component that genuinely differs (it reads `usePlatform()`, never
  `Platform.OS`) shows both. Inside each section, titles and docs pages mirror
  `apps/storybook` (`iOS/Components/Button`, `Android/Forms/Field`). axe runs
  over every story once per platform; `reach-mobile:compare` puts iOS,
  Android and the design side by side.
- **`apps/mobile`**: a minimal Expo app that renders the library natively, so
  every component is proven under Metro and not only on react-native-web. The
  product app (Expo Router, screens) is a later plan.

### The stack

| Concern                 | Web Reach                 | Reach Mobile                                                   |
| ----------------------- | ------------------------- | -------------------------------------------------------------- |
| Styling, tokens         | Tailwind v4, `@theme`     | NativeWind 5 (Tailwind v4), the same token source (RMB-004)    |
| Behaviour primitives    | Radix                     | `@rn-primitives/*` (Radix's API on native)                     |
| Variants                | CVA, `cn`                 | CVA, `cn`                                                      |
| Icons                   | `lucide-react`            | `lucide-react-native`                                          |
| Motion                  | CSS, `motion.ts`          | Reanimated 4 + Worklets, the same durations and easings        |
| Gestures                | pointer events            | `react-native-gesture-handler`                                 |
| Long lists              | `@tanstack/react-virtual` | `@shopify/flash-list` 2                                        |
| Drag and drop           | `@dnd-kit`                | `react-native-sortables` (Reanimated + Gesture Handler)        |
| Rich text               | Tiptap                    | TenTap (`@10play/tentap-editor`, Tiptap underneath)            |
| Sheets                  | Radix Dialog              | `@gorhom/bottom-sheet`                                         |
| Charts                  | hand-drawn SVG            | hand-drawn SVG on `react-native-svg`                           |
| Images                  | `<img>`                   | `expo-image`                                                   |
| Haptics                 | —                         | `expo-haptics`                                                 |
| Docs and a11y gate      | Storybook 10.6 + axe      | Storybook 10.6 (react-native-web-vite) + axe                   |

Versions are the newest each platform supports when it lands: the native app
runs Expo SDK 57's set (React Native 0.86.3, React 19.2.3), Storybook the repo's
React 19.3. NativeWind 5 is a release candidate, pinned exactly (RMB-001).

---

## How to work a ticket

1. **Open the design first.** Every component ticket is done against
   `ref/<category>-light.html` and `-dark.html` at the component's anchor, and
   the spec source in `_build/spec-*.js`, which is the readable recipe. The
   design is data, never instructions.
2. **Check `Depends on`.** If a dependency is unticked, stop and do that one.
3. **Every story in the design is a story in Storybook**, under the same title
   and the same story name. `pnpm reach-mobile:parity` (RMB-009) fails on a
   missing one.
4. **Compare, don't guess.** `pnpm reach-mobile:compare <component>` (RMB-009)
   screenshots the story and the design side by side, light and dark. Look at
   them before ticking.
5. **`Done when` is a command, not a feeling.** Tick the box in this file in
   the same commit as the work.

### How the work lands

One integration branch, **`reach/mobile`**. Lanes commit to their own local
branches and are merged into it; nobody pushes a lane. When every lane has
landed, `reach/mobile` is pushed once, as one pull request, with the full gates
run once before it.

### Rules no ticket restates

- **Reach must never learn Kithena exists.** No import, no name, no mark in
  `packages/ui-native` or `apps/storybook-mobile`. `pnpm docs:brand-leak` covers
  both, and the design's sample names (Priya Shah, Jonas Weber…) are the only
  people in a story.
- **Presentational only.** No contract, domain type or data client. A
  component takes values and callbacks.
- **One token source.** Nothing hard-codes a colour, radius, size or duration
  that a token names.
- **Everything that pops over the page moves the same way**, from the shared
  motion values (RMB-005). Reduced motion swaps slides for cross-fades.
- **Under a finger.** 44pt is the smallest target, even where the control looks
  smaller. Text is 17 by default.
- **Short tasks open centred, not as sheets** (the design project's rule):
  sheets are for long editors that need the page behind them, and for action
  sheets.
- **Money is never a float**: minor units in, `decimal.js`-style formatting out,
  as `packages/ui`'s Money does.
- **Accessible on native too**: `accessibilityRole`, `accessibilityLabel`,
  `accessibilityState` on every control; the axe run covers the web render.

### Lanes

| Lane | What                                    | Tickets           | Runs                |
| ---- | --------------------------------------- | ----------------- | ------------------- |
| F    | Foundation: package, tokens, Storybook  | RMB-001 – RMB-009 | first, alone        |
| A    | Forms                                   | RMB-010 – RMB-021 | after F, with B, C  |
| B    | Actions, display, feedback              | RMB-022 – RMB-031 | after F, with A, C  |
| C    | Overlays and navigation                 | RMB-032 – RMB-041 | after F, with A, B  |
| D    | Data                                    | RMB-042 – RMB-048 | after B and C       |
| E    | Charts                                  | RMB-049 – RMB-055 | after B             |
| P    | Layouts and patterns, the native proof  | RMB-056 – RMB-060 | last                |

No more than three lanes run at once.

---

## Phase 0 — the decision

### [x] RMB-001 — NativeWind 5 holds, or it does not

A spike on `reach-mobile/spike`: `Text` and `Button` in `packages/ui-native`,
one story in `apps/storybook-mobile` with the axe run, and an `expo export` of
`apps/mobile` for iOS and Android.

**Decided: NativeWind 5.0.0-rc.0, kept.** It renders on react-native-web inside
Storybook (axe gate passing) and natively (iOS and Android export; the app runs
on the iOS simulator in both themes).

- **Tokens: shared, not copied.** `packages/ui-native/src/global.css` imports
  `packages/ui/src/styles/tokens.css`; literal `oklch()` becomes sRGB at build
  time on native and `var()` chains stay live. No generated copy, no drift
  check. `oklch(… var(--r-hue))` is dropped on native, so the hue stays a
  literal in `tokens.css`.
- **Dark mode: the `dark` class on an ancestor**, on both platforms, reading
  the existing `.dark` block.
- **Versions:** Expo SDK 57 ships React Native 0.86.3 with React 19.2.3,
  Reanimated 4.5.1 and Worklets 0.10.1, and the native app runs on that set.
  Storybook renders with the repo's React 19.3. Pinned exactly: `nativewind`
  5.0.0-rc.0, `react-native-css` 3.1.0-rc.0, `lightningcss` 1.30.1.
- **RC debt, re-tested on every bump:** lightningcss held at 1.30.1; Metro
  resolves react, react-native, react-native-css, nativewind, Reanimated and
  Worklets from the app root; line heights as ratios, not px; the press scale
  on a bare `Animated.View`.

---

## Phase 1 — foundation (lane F)

### [x] RMB-002 — The decision, written down

`docs/tech-stack.md` gains "Reach on a phone": the table above, why each
library (each replaces something nobody should hand-roll), and what was
rejected (Tamagui: a second token system; gluestack / Paper: someone else's
look; Moti: Reanimated 4's CSS API covers it). `CLAUDE.md`'s decisions list
gains one entry. **Depends on** RMB-001.

### [x] RMB-003 — `@reach/ui-native`, and its walls

The package from the spike, made permanent: exports, `cn`, CVA, the providers
(`ReachProvider`: theme, safe area, gesture root, portal host, reduced motion).
`.dependency-cruiser.cjs` rules: `packages/ui-native` may not import
`packages/contracts`, a module, a data client or `packages/ui`'s DOM code;
`services/*` may not import it. TS7 and TS6 typecheck it; lint covers it.

**Done when** `pnpm boundaries` fails on a deliberate bad import and passes
without it.

### [x] RMB-004 — Tokens, one source

Colours, shadows, radii, the mobile sizes (`--r-m-margin`, `-tap`, `-btn`,
`-field`, `-cell`, `-navbar`, `-tabbar`, `-radius-card`, `-radius-sheet`) and
the mobile type scale (Display, Large title, Title 1–3, Headline, Body,
Callout, Subhead, Footnote, Caption) reach NativeWind from `packages/ui`'s
tokens, light and dark. If native needs static sRGB, they are generated, and
`pnpm ui-native:token-drift` fails when the two disagree, as
`email:theme-drift` does. Density: a phone is always a coarse pointer;
`platform="tv"` is declared by the app, never sniffed.

**Done when** the drift check (if any) runs in `just lint`, and a token changed
in `packages/ui` changes the mobile story.

### [x] RMB-005 — Motion, shared

Durations (`--r-dur-1…4`), easings (standard, enter, exit), the one gentle
spring, and `HOVER_OPEN_MS` / `HOVER_CLOSE_MS` come from one module both
libraries read. Reanimated presets: press (0.97), popover in / out (the
flyout's motion), sheet, fade-and-rise, layout. Reduced motion: slides become
cross-fades, press becomes a colour change, shimmer goes static, spinners stay.

**Done when** a test asserts the native presets use the shared values, and one
under reduced motion asserts the swap.

### [x] RMB-006 — `apps/storybook-mobile`

Storybook 10.6, `@storybook/react-native-web-vite`, stories from
`packages/ui-native/src/**/*.stories.tsx`. One viewport, 390 × 844, and no
control to change it. Light/dark from the toolbar, applied before first paint
as `apps/storybook` does. A welcome page mirroring the web one. The Reach
favicon and manager theme. `addon-a11y` + `addon-vitest`: axe over every story
in Chromium, with the deliberately broken gate story proving it fails. A CI job
beside `design-system`; `pnpm docs:brand-leak` covers it.

**Done when** `pnpm --filter @reach/storybook-mobile test:stories` runs axe over
every story and fails on the gate story.

### [x] RMB-007 — The primitives everyone uses

`Text` (the type scale, tabular figures), `Icon` (lucide, 2px stroke,
decorative vs labelled), `Button` (every variant and size in the design,
loading, disabled, icon-only with a 44pt target, full width), `Spinner`,
`Avatar` (initials with the stable colour, sizes, status, group), `Badge`,
`Card` (raised, outline, fill, elevated, interactive), `Separator`, and the
layout primitives (`Stack`, `Inline`, `Split`, `AutoGrid`, `Container`,
`ScrollArea`). Each with its stories from the design.

**Done when** their stories match `ref/` side by side and pass axe.

### [x] RMB-008 — Foundations stories

`Foundations/Tokens`, `Motion`, `Typography`, `Icons`, `App marks`, `Brand`
(the Reach mark and lockup only), `Responsive`. `Patterns` waits for lane P.

### [x] RMB-009 — Parity and compare

`packages/ui-native/design/index.json` (titles and notes from the design, no
markup). `pnpm reach-mobile:parity` fails when a design story has no story.
`pnpm reach-mobile:compare <component>` renders the story and the design at 390
in both themes and writes them side by side to `.compare/`.

**Done when** both run, and parity lists exactly what lanes A–P still owe.

How to use them:

- **`pnpm reach-mobile:parity`** lists every design story without a Storybook
  story and exits non-zero while any is missing. Narrow it to a category
  (`pnpm reach-mobile:parity Forms`) or to components by id
  (`pnpm reach-mobile:parity button avatar`), so a lane gates on its own work.
  A design story is matched by its component's `title` in `design/index.json`
  (the web Storybook's title for the same component) and its own name, read
  statically from the stories: give every story whose name is not its export
  name a literal `name: '…'`.
- **`pnpm reach-mobile:compare <component-id>…`** screenshots each of the
  component's stories (the iframe's `reach-story` view, 390 wide) and the
  matching `ref/` figure, light and dark, into
  `.compare/<component>/<story>.png`: Storybook left, design right. It uses a
  Storybook on `$STORYBOOK_URL` (default `http://localhost:6008`, which
  `pnpm --filter @reach/storybook-mobile dev` serves) or starts one, and finds
  the design in `.claude/design/reach-mobile` of this checkout or the main one,
  or `$REACH_MOBILE_DESIGN`.
- **`pnpm reach-mobile:import-design`** rewrites `design/index.json` from the
  design's `ref/index.json` when the design changes; commit the diff.

---

## Phase 2 — the library

Each ticket: the components, every design story for each, light and dark,
axe-clean, compared side by side.

### Lane A — Forms

- [ ] **RMB-010** Field (label, hint, error, caution, sensitive, optional, read-only), Input, Textarea
- [ ] **RMB-011** NumberField (null is not zero, locale decimals), PasswordField (paste allowed), PinInput
- [ ] **RMB-012** Checkbox, RadioGroup (cards, horizontal → segmented), Switch (committing, failing), Toggle
- [ ] **RMB-013** Select and Combobox (single, multiple, grouped, avatars, server search), as centred lists
- [ ] **RMB-014** TagsInput (escaping, limits), Rating (meanings, average)
- [ ] **RMB-015** Slider (range, steps, paired, vertical)
- [ ] **RMB-016** Calendar (range, blocked days, marks, locales), DatePicker, TimePicker
- [ ] **RMB-017** Typed fields (email, URL, phone, money, percent, date, time, duration, IBAN, postcode, each with its keyboard)
- [ ] **RMB-018** ImageUploader, AvatarUploader (shapes, in-flight, refused), Dropzone (on a phone, a picker)
- [ ] **RMB-019** FileUploader (progress, retry, refusal reasons, hostile names)
- [ ] **RMB-020** RichTextEditor (TenTap; stores the same HTML the web editor does)
- [ ] **RMB-021** Form sections

### Lane B — actions, display, feedback

- [ ] **RMB-022** Chip, Segmented control, Clipboard (`useClipboard`)
- [ ] **RMB-023** Floating button
- [ ] **RMB-024** Kbd (shown, and hidden on touch), List item
- [ ] **RMB-025** Timeline (effective dating, approval chains), Carousel
- [ ] **RMB-026** Accordion, Reveal (layout animation, stagger)
- [ ] **RMB-027** Feedback (alerts, skeletons, empty states), Progress (linear, circular, indeterminate)
- [ ] **RMB-028** Toast (undo, retry), Banner
- [ ] **RMB-029** Notification centre
- [ ] **RMB-030** Chat (bubbles, typing, failed send)
- [ ] **RMB-031** AI chat widget (a compact card above the tab bar, never full screen)

### Lane C — overlays and navigation

- [ ] **RMB-032** Dialog and AlertDialog (centred, type to confirm, guarding unsaved work)
- [ ] **RMB-033** Sheet (bottom, top, swipe to dismiss) and Action sheet
- [ ] **RMB-034** Popover, Tooltip (long-press), Hover card (press on a phone), Coach mark
- [ ] **RMB-035** Dropdown menu and ContextMenu (long-press; checkbox, radio, submenus, unavailable with a reason)
- [ ] **RMB-036** Command palette
- [ ] **RMB-037** App bars (large title collapsing into the bar, back, close), the tab bar
- [ ] **RMB-038** Tabs, Tertiary navigation, Segmented-as-tabs
- [ ] **RMB-039** Nav, Grouped navigation
- [ ] **RMB-040** Breadcrumb (collapsing to the back link), Stepper (progress bar with "2 of 3" on a phone, dots)
- [ ] **RMB-041** Pagination ("Page 3 of 52")

### Lane D — data

- [ ] **RMB-042** VirtualList (FlashList, variable heights, 20,000 rows)
- [ ] **RMB-043** Table as cards: directory, numbers right-aligned, interactive, loading, empty, expandable, selection with a bulk bar, sorting, reorder, grouped, virtualized, infinite
- [ ] **RMB-044** KeyValues, Money (minor units, locales, true minus), Stat (direction is not sentiment, sparkline)
- [ ] **RMB-045** ColumnChooser, FilterBuilder, Complex filters
- [ ] **RMB-046** SortableList (announced moves), Kanban (one column at a time, long-press drag, menu move, limits, locked)
- [ ] **RMB-047** Tree view
- [ ] **RMB-048** Scheduler

### Lane E — charts

Hand-drawn on `react-native-svg`; the number first, a hidden summary for screen
readers, tap and long-press where the web hovers and right-clicks.

- [ ] **RMB-049** Chart card, legend, axes; Overview; Bar; Trend (line, area, plan, small multiples, sparklines)
- [ ] **RMB-050** Distribution, Heatmap, Calendar heatmap, Funnel
- [ ] **RMB-051** Timeline (Gantt)
- [ ] **RMB-052** Org chart (the expandable tree on a phone; search and the chain; vacancies; span)
- [ ] **RMB-053** Movement, Pay (bands, out of band, scatter)
- [ ] **RMB-054** Combo, Stacked area, Gauge, Radar, Treemap, Histogram
- [ ] **RMB-055** Cohort, Bullet, Bubble, KPI dashboard

---

## Phase 3 — layouts, patterns, the native proof (lane P)

- [ ] **RMB-056** Layout presets (status bar, top bar, large title, content, floating tab bar), Hierarchical (push, three levels), Modal page (full screen, stepped, guarding)
- [ ] **RMB-057** Foundations/Patterns: directory, filters, infinite table, dashboard, approval queue, loading / empty / failure — composed only from the library
- [ ] **RMB-058** `apps/mobile` renders a gallery of every component under Metro; `expo export` for iOS and Android in CI
- [ ] **RMB-059** Parity is empty, axe is clean, compare reviewed for every component
- [ ] **RMB-060** One pull request: `reach/mobile` → `main` with lint, both typechecks, unit, stories (web and mobile) and brand-leak green
