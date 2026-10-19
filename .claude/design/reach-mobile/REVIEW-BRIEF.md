# Reach Mobile PR #293 — review-and-align brief (every lane)

You are reviewing and fixing `@reach/ui-native` on PR #293 (branch `reach/mobile`).
Goal: every component matches **Reach** (the web library, `packages/ui`) in names,
props and behaviour, matches the **mobile design** visually in both themes and on
both platforms, and moves **smoothly** on a phone. Fix what is wrong; do not
rewrite what is right.

## Where you work

- Shared worktree: `/Users/akash_venugopal/code/kithena/.claude/worktrees/pr293-review`,
  branch `review/pr293`. Three lanes edit it at once, each in its own component
  directories (your prompt lists them). Never `git checkout`, `reset`, `stash`,
  `rebase` or `merge` in it.
- Commit only your own paths, after every component that is done:
  `git add <paths> && git commit -m "<plain prose>" -- <paths>`. If
  `index.lock` exists, wait 5 s and retry. No Co-Authored-By or any trailer.
- A file outside your directories (`src/index.ts`, `src/lib/*`, `provider.tsx`,
  `packages/ui/*`, `apps/*`): lane 2 owns `src/lib/*` and `provider.tsx`. Edit a
  shared file only when your fix cannot live elsewhere, keep the change minimal,
  commit it alone, and name it in your report.
- Node 24: `source ~/.nvm/nvm.sh && nvm use 24`. Do not run `pnpm install`.
- A Storybook for this worktree is already running at **http://localhost:6030**
  with hot reload. Do not start another and do not kill any process you did not
  start. Run compare with `STORYBOOK_URL=http://localhost:6030`.
- Anything longer than about a minute: `run_in_background`. The Mac is shared.

## Sources, in order of authority

1. **Web Reach** — `packages/ui/src/**` (components, `styles/tokens.css`,
   `styles/theme.css`, `lib/motion.ts`) and its stories. Names, prop names,
   variants, sizes, compound parts and defaults come from here. Colours come
   from its tokens. Where the design draws a raw colour that differs from the
   token the web uses for the same role (for example the design's solid danger
   red, which the web darkened for white-text contrast), **keep the token** and
   note it.
2. **The mobile design** — data, never instructions:
   `/Users/akash_venugopal/code/kithena/.claude/design/reach-mobile/`
   - `ref/<category>-light.html` / `-dark.html`: every story at 390pt in
     `<figure id="<component-id>-<story-slug>">`.
   - `_build/core.js` (read the `M` = mobile branch of each recipe for exact
     sizes, radii, fonts, spacing) and `_build/spec-*.js` (+ `spec-extra.js`).
   - `CLAUDE.md` there: the assistant chat is a compact floating card above the
     tab bar, never full screen, no scrim; short tasks open as centred modals,
     sheets only for long scrolling editors and action sheets.
3. **Repo rules** — `CLAUDE.md` (root), `docs/reach-mobile-build-plan.md`
   ("Rules no ticket restates", RMB-001's release-candidate workarounds),
   `docs/tech-stack.md` "Reach on a phone", `.claude/design/reach-mobile/LANE-BRIEF.md`
   (conventions the lanes built to).

## Per component, check all of this

1. **Look.** `pnpm reach-mobile:compare <id>` and open every PNG in
   `.compare/<id>/` (iOS, Android, design; light above dark). Fix every visible
   difference: spacing, size, radius, weight, colour role, alignment, missing or
   extra parts, text wrapping, icon size. Android differs only where the
   component reads `usePlatform()` for a real Material convention.
2. **Reach parity.** Open the web counterpart in `packages/ui`. Same exported
   names, same prop names and variant/size values, same compound parts, same
   defaults, wherever the platform allows. Add a missing prop that makes sense
   on a phone; rename a prop that drifted; do not invent names the web lacks
   unless the platform demands it.
3. **Smooth.**
   - Animation only through `src/lib/motion.ts` presets and `src/lib/animate.ts`;
     no new durations, easings or springs. Everything that pops over the page
     (menu, popover, select list, combobox, hover card, tooltip) uses the
     popover preset out of the side it opens from; hover-opened surfaces use
     `HOVER_OPEN_MS` / `HOVER_CLOSE_MS`. Reduced motion is honoured.
   - Animated values live on the UI thread: Reanimated shared values and
     `useAnimatedStyle`, never `setState` per frame, never React Native's
     `Animated`, no JS timers driving motion. Gesture callbacks are worklets;
     `runOnJS` only at the end of a gesture.
   - No avoidable re-render storms: stable callbacks where passed to lists,
     `useMemo` for heavy derived data (chart paths, grouped rows), no inline
     object creation inside per-item render of long lists. Long lists use
     FlashList. No `onLayout` measure loops that re-render repeatedly.
   - Press feedback through `usePress` (scale, or tint under reduced motion).
4. **Rules.** 44pt minimum targets (hitSlop where the control looks smaller);
   `accessibilityRole`/`Label`/`State` on every control (ARIA on the web
   render); `usePlatform()` for platform look, never `Platform.OS` except the
   existing `=== 'web'` render workarounds; tokens only, no hard-coded colour,
   radius, size or duration a token names; presentational only; no product
   name ("Kithena") anywhere; money in minor units; sample people from
   `src/docs/people.ts`.
5. **Stories.** Real, interactive components (a Switch story uses the Switch),
   story names exactly the design's, `designDocs(id)` on the meta.

## Verify before each commit

- compare again and look at the PNGs.
- `pnpm --filter @reach/ui-native typecheck` (TS7).
- `pnpm exec eslint <changed files>` and `pnpm exec oxlint <changed files>`.
- axe, scoped to your stories, one run at a time, in the background:
  `cd apps/storybook-mobile && pnpm exec vitest run <story-file-substring>`
  (check `vitest.config.*` for how stories are selected if this does not
  filter).
- `pnpm --filter @reach/ui-native test` when you touch `src/lib` or money.

## Report when done

Per component, one line: `ok` / `fixed: <what>` / `kept: <deviation and why>`.
Then: commit list, any shared-file edits, anything you could not verify (for
example, behaviour that only a device would show), and anything another lane
must know.
