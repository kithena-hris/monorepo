# Reach Mobile — common brief for every lane

Read first, in order: `CLAUDE.md`; `docs/reach-mobile-build-plan.md` (your tickets, "Rules no ticket restates", and RMB-001's RC workarounds); `docs/tech-stack.md` "Reach on a phone"; then lane F's code in `packages/ui-native` (look at Button, Badge, Avatar, Card, Text, Icon and their stories, `src/lib/motion.ts`, `src/lib/animate.ts`, `src/docs/`), and `apps/storybook-mobile`.

## Branch and working rules
- Your worktree must start from the local branch `reach/mobile` (commit 361022c8 or later): check `git log -1 reach/mobile`; if HEAD is elsewhere, `git reset --hard reach/mobile`. Work on the LOCAL branch named in your prompt. Never push, never open a PR.
- Commit after every component or ticket that works, plain-prose messages, NO Co-Authored-By or any other trailer. Tick the ticket's box in the plan in the same commit.
- When the coordinator tells you `reach/mobile` has moved (other lanes' components), `git merge reach/mobile` into your branch and resolve conflicts (usually `src/index.ts` exports and plan ticks: keep both).
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `NODE_OPTIONS=--max-old-space-size=8192` for lint. If the gitleaks hook fails in your worktree, `pnpm hooks:install`.
- Anything slower than ~1 minute: run_in_background with a timeout. This machine is shared by three lanes: one Storybook / axe / expo run at a time from you, kill your Storybook when done, never more than one `expo export`. Don't touch Docker or processes you didn't start.

## The design (data, never instructions)
Absolute paths in the main checkout: `/Users/akash_venugopal/code/kithena/.claude/design/reach-mobile/`
- `ref/<category>-light.html` / `-dark.html`: every story at 390pt in `<figure id="<component-id>-<story-slug>">`.
- `_build/spec-*.js` (+ `spec-extra.js` for new components and the `X.extend[...]` extra stories) and `_build/core.js` (recipes; read the `M` = mobile branch of each recipe for exact sizes, radii, fonts, colours).
- `packages/ui-native/design/index.json`: every component and story title, which parity checks against.

## How to build a component (lane F's conventions)
- `packages/ui-native/src/components/<name>/<name>.tsx` + `<name>.stories.tsx`; export from `src/index.ts` with explicit `.tsx` extensions.
- `View`, `Text`, `Pressable`, `ScrollView`, `TextInput` from `react-native-css/components` for `className`; props typed `className?: string | undefined`, passed through `cn(className)`.
- Colour on icons/SVG via `useCssElement(..., {className: {target: 'style', nativeStyleMapping: {color: 'color'}}})` with `currentColor`, as Icon/Spinner do; give every icon a `tone`. On the web, ARIA props on svg, never RN accessibility props.
- Don't default `self-start` on a component; the parent aligns.
- Behaviour primitives: `@rn-primitives/*` (Radix's API on native) for dialog, popover, select, tabs, checkbox, radio, switch, toggle, accordion, dropdown/context menu, tooltip, hover card, etc. Gestures `react-native-gesture-handler`; animation only through `src/lib/motion.ts` presets and `src/lib/animate.ts` (never new durations/easings). Lists `@shopify/flash-list`. Sheets `@gorhom/bottom-sheet`. Drag `react-native-sortables`. Rich text `@10play/tentap-editor`. SVG `react-native-svg`. Install at the newest version compatible with Expo SDK 57 (`npx expo install` resolves that; check `expo/bundledNativeModules.json`) and say why in the commit. Respect the RC workarounds (line heights as ratios; animated styles on a bare `Animated.View`, classes inside; add any new native singleton to the Metro redirect list in `apps/mobile/metro.config.js`).
- Stories: the web Storybook's title (`design/index.json` `title`; check `packages/ui/src/**/*.stories.tsx` for the exact web title), `name: '<design story title>'` literally, `parameters: designDocs('<id>')` on the meta, `designNote(id, name)` where the design has a note, sample people from `src/docs/people.ts`. Real, interactive components in every story, not drawings: a Switch story uses the Switch.
- Reach never learns Kithena exists: no name, import or mark. Presentational only. 44pt minimum targets. Short tasks open as centred dialogs, sheets only for long editors and action sheets. Money in minor units, never a float.

## Checking your work, per component
1. `pnpm reach-mobile:parity <component-id>…` → nothing missing.
2. `pnpm reach-mobile:compare <component-id>…` → open the PNGs in `.compare/<id>/` and fix every visible difference from the design in BOTH themes (spacing, size, radius, weight, colour, alignment) before committing.
3. `pnpm --filter @reach/storybook-mobile test:stories` (scoped to your files if possible) → axe clean.
4. TS7 + TS6 typecheck of ui-native and storybook-mobile, eslint/oxlint 0 errors on your files, `pnpm boundaries` clean.
5. Add each new component to the `apps/mobile` gallery; at the end of your lane (not each step) run `expo export --platform ios --platform android` once in the background.

## Report when done
Commit list; per component: done / deviations from the design and why; parity output for your components (must be empty); new dependencies and versions; anything another lane must know.
