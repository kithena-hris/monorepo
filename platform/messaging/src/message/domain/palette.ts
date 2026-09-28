/**
 * Reach's colours, resolved, for a medium that cannot resolve them itself.
 *
 * ### Why this file exists at all
 *
 * An email has no stylesheet to load, no custom properties to reference, and no
 * `oklch()` — Outlook renders through Word, which has none of the three, and
 * Gmail rewrites what it does not understand. So the template carries concrete
 * sRGB values.
 *
 * This is the same problem Storybook's manager has, and the same answer:
 * `apps/storybook/.storybook/reach-tokens.json` is a snapshot of resolved
 * tokens for exactly this reason. `packages/ui/src/brand/kithena-mark-data-uri.ts`
 * makes the same trade for the mark. In all three cases a value is written out
 * where it is needed and a drift check stops the copy going stale — here that
 * is `pnpm email:theme-drift`, which reads `tokens.css`, resolves the `var()`
 * chain, converts, and fails if any line below has moved.
 *
 * It is a copy rather than an import because `.dependency-cruiser.cjs` forbids
 * `platform/*` from importing `packages/ui`, and correctly: a service has no
 * user interface, and an email is the one exception that cannot be anywhere
 * else. The rule stands and the drift check pays for it.
 *
 * **Do not hand-edit.** Change the token in `packages/ui/src/styles/tokens.css`
 * and run `pnpm email:theme-drift`, which reports what these should be.
 */
export interface Palette {
  /** The page behind the card. */
  readonly canvas: string;
  readonly surface: string;
  readonly 'surface-sunken': string;
  readonly fg: string;
  readonly 'fg-muted': string;
  /** Label colour on a solid accent fill. */
  readonly 'fg-on-accent': string;
  readonly border: string;
  readonly 'border-strong': string;
  /** The accent as a link colour. */
  readonly accent: string;
  /** The accent as a button fill. Not the same token: white on the lighter
   *  one is 3.54:1, which is why Reach separates them. */
  readonly 'accent-solid': string;
  readonly 'accent-fg': string;
  readonly 'accent-subtle': string;
}

export const light: Palette = {
  canvas: '#f5f6f8',
  surface: '#ffffff',
  'surface-sunken': '#eeeff2',
  fg: '#0c0d11',
  'fg-muted': '#505259',
  'fg-on-accent': '#ffffff',
  border: '#e2e3e6',
  'border-strong': '#cfd1d6',
  accent: '#4d53f0',
  'accent-solid': '#4d53f0',
  'accent-fg': '#4043d3',
  'accent-subtle': '#e8eeff',
};

/**
 * Not an inversion, which is the whole point of Reach having a second set
 * rather than a filter. Dark surfaces lift as they come forward and the accent
 * shifts lighter to hold AA on them — except `accent-solid`, which stays put
 * because it is the one with a label on top of it.
 */
export const dark: Palette = {
  canvas: '#000000',
  surface: '#0f0f11',
  'surface-sunken': '#1c1d1f',
  fg: '#f4f4f6',
  'fg-muted': '#afb1b6',
  'fg-on-accent': '#ffffff',
  border: '#28292b',
  'border-strong': '#3c3d40',
  accent: '#5966f3',
  'accent-solid': '#4d53f0',
  'accent-fg': '#9eb1ff',
  'accent-subtle': '#191f4a',
};

/**
 * The rest of the design system the email borrows, in the units email uses.
 *
 * Pixels rather than rem throughout. Reach sizes in rem so that everything
 * scales with the root font size and with `--reach-font-scale`; an email has no
 * root to scale from and Outlook resolves rem unpredictably, so the scale is
 * flattened here at its default. The comment beside each value names the token
 * it came from, so the drift is visible to a reader even though only the
 * colours are checked mechanically.
 */
export const scale = {
  /** `--font-sans`, minus the variable cut nobody has installed in a mail client. */
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  /** `--text-xl` / 1.375rem, tracking -0.015em. The one heading. */
  heading: { size: '22px', lineHeight: '30px', tracking: '-0.34px' },
  /** `--text-md` / 1rem. Body copy in an email is 16px, not the 14px a dense
   *  HRIS screen uses — nobody reads a message in a data grid. */
  body: { size: '16px', lineHeight: '24px', tracking: '0' },
  /** `--text-sm` / 0.8125rem, tracking 0.004em. Fine print. */
  small: { size: '13px', lineHeight: '20px', tracking: '0.05px' },
  /** `--text-xs` / 0.75rem, tracking 0.006em. The footer and the wordmark. */
  tiny: { size: '12px', lineHeight: '18px', tracking: '0.07px' },
  /** `--radius-lg`, what `Card` uses. */
  radiusCard: '12px',
  /** `--radius-md`, what `Button` uses at `md` and `lg`. */
  radiusControl: '8px',
  /** `--radius-sm`, for the inset panel. */
  radiusInset: '6px',
  /** `--reach-control-lg`, the 44px that is also the WCAG 2.2 target floor. */
  controlHeight: '44px',
  /** `Card`'s `p-5`. */
  cardPadding: '20px',
} as const;
