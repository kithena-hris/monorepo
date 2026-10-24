import type { JSX, SVGProps } from 'react';

import { cn } from '../lib/cn';

/**
 * The Kithena mark.
 *
 * ### What it is
 *
 * Three rings, woven. Each one passes over one neighbour and under the other,
 * alternating the whole way round, so no ring sits flat on top and none sits
 * flat underneath.
 *
 * This particular weave is the Borromean rings, and it has a property that no
 * other arrangement of three loops has: **no two of the rings are linked to
 * each other.** Lift any one away and the remaining two fall apart in your
 * hand, unlinked, because they never touched. Yet all three together cannot be
 * separated. The whole is held by a relationship that exists between none of
 * the pairs.
 *
 * ### Why this, for this product
 *
 * It is the rule in `CLAUDE.md`, drawn.
 *
 * No module here may import another. A module reaches its neighbours through
 * events and `packages/contracts`, never directly, and
 * `.dependency-cruiser.cjs` fails the build if it tries. Every module has to
 * boot alone and pass its acceptance suite with no siblings present. So: no
 * two are linked. And yet the thing you sell is the suite, which is real, and
 * which is held together by exactly nothing that a dependency graph can show
 * you.
 *
 * That is the Borromean property stated in Typescript instead of in rope. The
 * mark is not a metaphor for the architecture; it is the same fact in a
 * different notation.
 *
 * The word carries it too. `Kith` is Old English for the people you belong
 * among — the surviving half of *kith and kin*, and the half that is chosen
 * rather than inherited. An organisation is not a shape you can point at. It
 * is what holds when no two people in it are bound to each other by anything
 * but the arrangement.
 *
 * ### Why it is drawn hard
 *
 * The weave is the point, so the crossings cannot be faked. Each ring is cut
 * into arcs and a gap of 0.30 radians is opened at every crossing where it
 * passes underneath — six breaks in total, at coordinates derived from the
 * actual circle-circle intersections rather than nudged by eye. Move a ring
 * and every break has to be recomputed; the geometry is generated, not drawn.
 *
 * The stroke is 2.2 against the 2.6 the icon set uses. Anything heavier closes
 * the six windows the weave opens and the mark reverts to three overlapping
 * circles, which is a different and much worse logo.
 *
 * ### Where it stops working
 *
 * This is an intricate mark and it is honest to say so. It is at its best from
 * 32px up. `compact` thickens the stroke to 2.8 and widens the breaks so the
 * weave survives further down, but at 16px the windows close and it reads as a
 * dense trefoil rather than as three woven rings. A favicon is the worst case
 * for anything with real detail in it, and this has more detail than most.
 *
 * ### Contrast
 *
 * The mark carries meaning rather than decorating, so it is held to WCAG
 * 1.4.11 at 3:1 against its background rather than to a text ratio. Inheriting
 * `currentColor` means it is correct wherever the surrounding text already is.
 * The six breaks are background showing through, so they inherit the surface
 * and need no ratio of their own.
 */

export interface KithenaMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /**
   * Thickens the stroke and widens the breaks for small sizes. Below about
   * 32px the standard weave begins to close.
   */
  compact?: boolean;
  /** Names the mark where it is the only thing identifying the product. */
  title?: string;
}

/**
 * Three circles of radius 7, centred 4.3 from the middle of the box at -90°,
 * 30° and 150°. Each is cut into two arcs, with 0.30 radians removed at each
 * of the two crossings where it passes under a neighbour.
 *
 * The numbers are generated from the circle-circle intersections, not hand
 * placed. Changing a radius or a centre invalidates all six paths at once.
 */
const REGULAR = [
  'M13.30 14.58 A7 7 0 0 1 5.39 10.02',
  'M5.24 5.88 A7 7 0 1 1 16.95 12.65',
  'M9.12 11.83 A7 7 0 0 1 17.02 7.27',
  'M20.68 9.20 A7 7 0 1 1 8.96 15.97',
  'M6.98 7.27 A7 7 0 0 1 14.88 11.83',
  'M15.04 15.97 A7 7 0 1 1 3.32 9.20',
] as const;

/** Radius 6.4, centres 3.9 out, 0.38 radians removed at each crossing. */
const COMPACT = [
  'M12.71 14.46 A6.4 6.4 0 0 1 6.14 10.66',
  'M5.98 5.92 A6.4 6.4 0 1 1 16.90 12.22',
  'M9.51 11.39 A6.4 6.4 0 0 1 16.09 7.59',
  'M20.27 9.83 A6.4 6.4 0 1 1 9.36 16.13',
  'M7.91 7.59 A6.4 6.4 0 0 1 14.49 11.39',
  'M14.64 16.13 A6.4 6.4 0 1 1 3.73 9.83',
] as const;

const STROKE = 2.2;
const STROKE_COMPACT = 2.8;

export function KithenaMark({
  compact = false,
  title,
  className,
  ...props
}: KithenaMarkProps): JSX.Element {
  const arcs = compact ? COMPACT : REGULAR;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={compact ? STROKE_COMPACT : STROKE}
      strokeLinecap="round"
      // Decorative unless the caller names it: a mark beside a wordmark is
      // decoration, the same mark alone in a header is the product's name.
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img' })}
      className={cn('size-6 shrink-0', className)}
      {...props}
    >
      {title === undefined ? null : <title>{title}</title>}
      {arcs.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export interface KithenaWordmarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  title?: string;
}

/**
 * The word, set in the system's own typeface.
 *
 * Lowercase for the same reason Reach is: a tool rather than an institution.
 * It is set plainly and quietly, because the mark beside it is already doing a
 * great deal of work and two loud things in one lockup is one too many.
 *
 * This is live text rather than outlined paths, the one compromise here: a
 * machine without Inter falls down the stack and the word changes width. That
 * is fine inside the app, where Inter is loaded, and is why `assets/` also
 * carries fixed SVGs of the mark for everywhere else.
 */
export function KithenaWordmark({ title, className, ...props }: KithenaWordmarkProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 132 32"
      fill="currentColor"
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img' })}
      className={cn('h-6 w-auto', className)}
      {...props}
    >
      {title === undefined ? null : <title>{title}</title>}
      <text
        x="0"
        y="24"
        fontFamily="InterVariable, Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="26"
        fontWeight="600"
        letterSpacing="-0.9"
      >
        kithena
      </text>
    </svg>
  );
}

export interface KithenaLogoProps {
  /** `full` is the mark and the word. `mark` is the mark on its own. */
  variant?: 'full' | 'mark';
  /** Adds the line that says what it is. */
  showSubtitle?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * The lockup.
 *
 * The gap between mark and word is a quarter of the mark's height, the same
 * relationship a button keeps between icon and label. Clear space is half the
 * mark's height on every side.
 *
 * The mark may not be recoloured ring by ring. Three colours would say the
 * three rings are three different things, and the whole argument is that they
 * are identical and interchangeable — which of them is on top at any crossing
 * is an accident of drawing, not a statement about rank.
 */
export function KithenaLogo({
  variant = 'full',
  showSubtitle = false,
  compact = false,
  className,
}: KithenaLogoProps): JSX.Element {
  if (variant === 'mark') {
    return <KithenaMark compact={compact} title="Kithena" className={cn('size-8', className)} />;
  }

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <KithenaMark compact={compact} className="size-8" />
      <div className="flex flex-col justify-center">
        <KithenaWordmark title="Kithena" className="h-6" />
        {showSubtitle ? (
          <span className="text-2xs font-medium tracking-[0.14em] text-fg-subtle uppercase">
            People operations
          </span>
        ) : null}
      </div>
    </div>
  );
}
