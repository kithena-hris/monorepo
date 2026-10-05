# Tech stack

Why each piece of the stack is the piece it is. `CLAUDE.md` carries the
decisions in a line each; this is the reasoning behind them, written as each
decision is taken.

## Reach on a phone

Reach Mobile is `@reach/ui-native` (`packages/ui-native`), documented in
`apps/storybook-mobile` and proven natively by `apps/mobile`. It is the same
design system as `@reach/ui`, not a sibling of it: the same component names,
the same props wherever the platform allows, the same tokens and the same
motion. It ships TypeScript source, as `packages/ui` does, compiled by Metro in
the app and by Vite in Storybook. It is presentational only and never learns
that Kithena exists, under the same dependency-cruiser rules and the same
`pnpm docs:brand-leak` gate as the web library.

### The stack

| Concern              | Web Reach                 | Reach Mobile                                              |
| -------------------- | ------------------------- | --------------------------------------------------------- |
| Styling, tokens      | Tailwind v4, `@theme`     | NativeWind 5 (Tailwind v4), the same `tokens.css`         |
| Behaviour primitives | Radix                     | `@rn-primitives/*` (Radix's API on native)                |
| Variants             | CVA, `cn`                 | CVA, `cn`                                                 |
| Icons                | `lucide-react`            | `lucide-react-native`                                     |
| Motion               | CSS, `@reach/ui/motion`   | Reanimated 4 + Worklets, reading `@reach/ui/motion`       |
| Gestures             | pointer events            | `react-native-gesture-handler`                            |
| Long lists           | `@tanstack/react-virtual` | `@shopify/flash-list` 2                                   |
| Drag and drop        | `@dnd-kit`                | `react-native-sortables` (Reanimated + Gesture Handler)   |
| Rich text            | Tiptap                    | TenTap (`@10play/tentap-editor`, Tiptap underneath)       |
| Sheets               | Radix Dialog              | `@gorhom/bottom-sheet`                                    |
| Charts               | hand-drawn SVG            | hand-drawn SVG on `react-native-svg`                      |
| Images               | `<img>`                   | `expo-image`                                              |
| Haptics              | —                         | `expo-haptics`                                            |
| Docs and a11y gate   | Storybook 10.6 + axe      | Storybook 10.6 (`@storybook/react-native-web-vite`) + axe |

Each library in the right-hand column replaces something nobody should
hand-roll, for the same reason `@dnd-kit` and Tiptap are on the web side:

- **`@rn-primitives`** is Radix's API on React Native. A menu, a select or a
  dialog has focus order, dismissal, accessibility roles and portalling to get
  right; Radix already settled those questions for the web library, and
  keeping its shape means a lane porting a component ports props, not
  behaviour.
- **Reanimated 4** runs animation on the UI thread. A JavaScript-driven press
  or sheet drops frames exactly when the JS thread is busy rendering the
  screen behind it, which is when people notice.
- **Gesture Handler** recognises gestures natively. A swipe to dismiss, a long
  press or a drag that competes with a scroll view cannot be arbitrated from
  the JS responder system without lag and stolen touches.
- **FlashList** recycles rows. A `ScrollView` renders every row, and a 20,000
  row directory is a dead app.
- **`react-native-sortables`** is drag and drop with the keyboard and screen
  reader story that `@dnd-kit` gives the web, built on the two libraries above.
- **TenTap** is Tiptap in a web view, so the HTML the phone stores is the HTML
  the web editor stores, which is the whole reason the web chose Tiptap.
- **`@gorhom/bottom-sheet`** is the gesture-driven sheet with keyboard
  avoidance and snap points, the one overlay a phone has that the web does not.
- **`react-native-svg`** carries the hand-drawn charts across unchanged in
  approach: the same few hundred lines, no charting library, one colour source.

### What was rejected

- **Tamagui.** It is a styling system with its own token model and compiler.
  Using it would give Reach a second source for every colour, size and radius,
  and a drift check between them forever. NativeWind reads the `tokens.css`
  the web already ships.
- **gluestack, React Native Paper.** Finished component libraries with
  someone else's look. Reach would spend its effort overriding them, and the
  overrides would be the design system.
- **Moti.** A friendlier API over Reanimated. Reanimated 4's own CSS-style
  animations cover what Moti added, and one fewer layer is one fewer thing to
  upgrade in lockstep with Expo.

### What the spike found (RMB-001)

NativeWind 5 is a release candidate, so the decision to use it was made on a
spike rather than on its changelog: `Text` and `Button` in `packages/ui-native`,
a story with the axe run in `apps/storybook-mobile`, and an `expo export` of
`apps/mobile` for iOS and Android. It held, on react-native-web inside
Storybook with axe passing, and natively in both themes on the iOS simulator.

- **Tokens are shared, not copied.** `packages/ui-native/src/global.css`
  imports `packages/ui/src/styles/tokens.css`. At build time on native, a
  literal `oklch()` becomes sRGB and `var()` chains stay live, so there is no
  generated copy and no drift check. One limit: `oklch(… var(--r-hue))` is
  dropped on native, so the hue stays a literal in `tokens.css`.
- **Dark mode is the `dark` class on an ancestor**, on both platforms, reading
  the existing `.dark` block. The same mechanism the web uses on `<html>`.
- **Density** needs no media query on native: a phone is always a coarse
  pointer, so the mobile sizes (`--r-m-*`) are the only sizes. `platform="tv"`
  is declared by the app, never sniffed, as on the web.

Four workarounds are the debt of a release candidate, and each is re-tested on
every NativeWind or Expo bump:

1. **`lightningcss` is held at 1.30.1** under `@expo/metro-config` (the root
   `pnpm.overrides`). `react-native-css` 3.1.0-rc.0 fails to compile any
   Tailwind output on 1.31 and later.
2. **Metro resolves the singletons from the app root**: react, react-native,
   react-native-css, nativewind, Reanimated and Worklets
   (`apps/mobile/metro.config.js`). pnpm gave `ui-native` its own
   `react-native-css`, which rewrites any `react-native` import that is not in
   its own copy, and the second copy recursed into itself until the stack
   overflowed. Since RMB-007 the redirect applies to every importer and also
   covers Gesture Handler, Safe Area and SVG: the workspace holds a
   `react-native` per React it uses, and a library resolving its peer to the
   Storybook's copy (lucide-react-native did) overflowed the same way.
3. **Line heights are unitless ratios** (`calc(22 / 17)`), never px.
   `react-native-css` multiplies a line height reached through a variable by
   the font size, so `22px` drew as 374pt on a device.
4. **The press scale sits on a bare `Animated.View`**, with the classes on a
   `View` inside it. `styled(Animated.View)` made `react-native-css` read
   shared values during render.

### Versions

Newest each platform supports. The native app runs Expo SDK 57's set: React
Native 0.86.3, React 19.2.3, Reanimated 4.5.1, Worklets 0.10.1. Storybook
renders with the repo's React 19.3, because react-native-web runs on whatever
React the page has and the rest of the repository is on 19.3. Pinned exactly,
because a release candidate's patch can break the build: `nativewind`
5.0.0-rc.0, `react-native-css` 3.1.0-rc.0, `lightningcss` 1.30.1.

### Motion, one module

`packages/ui/src/lib/motion.ts`, exported as `@reach/ui/motion`, holds every
duration, easing, the press scale, the popover's travel and the hover timings;
`spring.ts` beside it holds the springs. Both are pure TypeScript with no DOM
and no React, which is what lets `@reach/ui-native` import them: the
dependency-cruiser rule that keeps `packages/ui` out of the native library
allows exactly those two files. The web reads the same numbers as CSS
custom properties, and `motion.test.ts` fails when `theme.css` and the module
disagree, the same trade `spring.test.ts` already makes for the baked springs.

On the phone, `packages/ui-native/src/lib/motion.ts` turns those numbers into
presets, and nothing else: the press (0.97 at `instant`), the popover in and out
(the web flyout: 8px out of the side it opens from, a hair of scale, in at
`normal` on the entrance curve and out at `fast` on the exit), the sheet (in on
the gentle spring, which is the web's `drawer`, out at `fast`), fade and rise,
and a layout change on the `move` spring. Under reduced motion, slides and
sheets become cross-fades, the press becomes a colour change and a layout change
jumps; spinners stay, because they are meaning. `animate.ts` hands a preset to
Reanimated (`usePress`, `animateTo`, `useLayoutTransition`), and
`ReachProvider` decides whether motion is reduced, from the system unless an
app or a story says otherwise.

The design's own duration scale (`--r-dur-1…4`, 120 to 480ms) was never
shipped on the web, which runs on 80, 140, 200 and 320. The phone runs on what
ships, because the alternative is two libraries that move at different speeds.
